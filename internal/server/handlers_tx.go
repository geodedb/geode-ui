package server

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"sync"
	"time"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// txEntry is the per-transaction record held in TxStore.
type txEntry struct {
	tx        *sql.Tx
	createdAt time.Time
	owner     string // username from the JWT subject claim
}

// TxStore is an in-memory map of open *sql.Tx handles keyed by opaque
// 128-bit hex txids returned to the client.
//
// Owner identity is sourced from userFromContext, which currently returns
// "" until the JWT middleware lands in B9. Until then EVERY transaction
// is owned by the empty string, so any caller can commit/rollback another
// caller's transaction by guessing the txid. The owner check is still
// invoked so that B9 picks up real isolation for free; until then the
// 128-bit random txid is the only barrier.
type TxStore struct {
	mu sync.Mutex
	m  map[string]*txEntry
}

// NewTxStore returns an empty store. Inject one into Config.TxStore so
// the handlers can find it.
func NewTxStore() *TxStore { return &TxStore{m: map[string]*txEntry{}} }

// put registers tx under a new random id and returns the id.
func (t *TxStore) put(tx *sql.Tx, owner string) string {
	id := newTxID()
	t.mu.Lock()
	t.m[id] = &txEntry{tx: tx, createdAt: time.Now(), owner: owner}
	t.mu.Unlock()
	return id
}

// take removes the entry for id and returns the underlying *sql.Tx if
// the caller owns it. Used by commit/rollback (one-shot terminators).
func (t *TxStore) take(id, owner string) (*sql.Tx, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	e, ok := t.m[id]
	if !ok {
		return nil, errors.New("tx not found")
	}
	if e.owner != owner {
		return nil, errors.New("tx owner mismatch")
	}
	delete(t.m, id)
	return e.tx, nil
}

// get reads the entry for id (does not remove) and verifies owner.
// Used by run, which keeps the tx alive after the call.
func (t *TxStore) get(id, owner string) (*sql.Tx, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	e, ok := t.m[id]
	if !ok {
		return nil, errors.New("tx not found")
	}
	if e.owner != owner {
		return nil, errors.New("tx owner mismatch")
	}
	return e.tx, nil
}

// newTxID returns a 32-character (128-bit) hex string.
func newTxID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// userFromContext extracts the authenticated subject (username) from ctx.
// AuthJWT (internal/server/auth.go) populates this from the JWT "sub"
// claim before any handler runs. Tests that call handlers without a
// JWT context will see "" and rely on the TxStore owner check still
// being invoked so multi-user isolation is preserved as soon as a real
// token shows up.
func userFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(userCtxKey).(string); ok {
		return v
	}
	return ""
}

// Tx implements POST /api/v1/tx — opens a new transaction on the
// caller's connection profile and returns an opaque txid.
func (s *GraphServer) Tx(
	w http.ResponseWriter, r *http.Request, req *gentypes.TxBeginReq,
) (*gentypes.TxBeginResp, error) {
	if s.cfg.Pool == nil || s.cfg.TxStore == nil {
		return nil, errors.New("server: tx subsystem not configured")
	}
	db, err := s.cfg.Pool.DB(profileFromContextOrDefault(r.Context()))
	if err != nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusBadGateway,
			code:        ErrCodeProfileUnreachable,
			description: err.Error(),
		})
		return responseWritten[gentypes.TxBeginResp]()
	}
	tx, err := db.BeginTx(r.Context(), &sql.TxOptions{ReadOnly: req.ReadOnly})
	if err != nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusUnprocessableEntity,
			code:        ErrCodeTxBeginFailed,
			description: err.Error(),
		})
		return responseWritten[gentypes.TxBeginResp]()
	}
	if req.Graph != "" {
		if _, err := tx.ExecContext(r.Context(), "USE GRAPH "+sanitizeGraphName(req.Graph)); err != nil {
			_ = tx.Rollback()
			writeEndpointError(w, &endpointError{
				status:      http.StatusUnprocessableEntity,
				code:        ErrCodeTxUseGraphFailed,
				description: err.Error(),
			})
			return responseWritten[gentypes.TxBeginResp]()
		}
	}
	id := s.cfg.TxStore.put(tx, userFromContext(r.Context()))
	emitAudit(auditEventTxBegun,
		"user", userFromContext(r.Context()),
		"profile", profileFromContextOrDefault(r.Context()),
		"txid", id,
		"graph", req.Graph,
		"read_only", req.ReadOnly,
	)
	return &gentypes.TxBeginResp{Txid: id}, nil
}

// PostTxidRun implements POST /api/v1/tx/{txid}/run — executes one
// statement on the open transaction and returns the row set in the
// same shape as the synchronous Query handler.
//
// Naming: genapi disambiguated this from the migrations `MIGRATE RUN`
// endpoint (POST /api/v1/migrations/run, method PostMigrationsRun) by
// folding the path-parameter token into the method name. The B7+B8
// regen rotated this from the simpler `Run` we had before that.
func (s *GraphServer) PostTxidRun(
	w http.ResponseWriter, r *http.Request, req *gentypes.TxRunReq,
) (*gentypes.QueryResp, error) {
	if s.cfg.TxStore == nil {
		return nil, errors.New("server: tx store not configured")
	}
	tx, err := s.cfg.TxStore.get(req.Txid, userFromContext(r.Context()))
	if err != nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusNotFound,
			code:        ErrCodeTxNotFound,
			description: err.Error(),
		})
		return responseWritten[gentypes.QueryResp]()
	}
	args, err := namedArgs(req.Params)
	if err != nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusBadRequest,
			code:        ErrCodeInvalidParams,
			description: "params field is not a valid JSON object: " + err.Error(),
		})
		return responseWritten[gentypes.QueryResp]()
	}
	start := time.Now()
	rows, err := tx.QueryContext(r.Context(), req.Statement, args...)
	if err != nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusUnprocessableEntity,
			code:        ErrCodeQueryError,
			description: err.Error(),
		})
		return responseWritten[gentypes.QueryResp]()
	}
	defer func() { _ = rows.Close() }()
	resp, err := scanQueryResult(rows, start)
	if err != nil {
		if rerr := rows.Err(); rerr != nil && errors.Is(err, rerr) {
			writeEndpointError(w, &endpointError{
				status:      http.StatusUnprocessableEntity,
				code:        ErrCodeQueryError,
				description: err.Error(),
			})
			return responseWritten[gentypes.QueryResp]()
		}
		return nil, err
	}
	return resp, nil
}

// Commit implements POST /api/v1/tx/{txid}/commit — finalises the
// transaction and removes it from the store.
func (s *GraphServer) Commit(w http.ResponseWriter, r *http.Request, req *gentypes.TxIDParam) (*gentypes.Empty, error) {
	return s.finishTx(w, r, req.Txid, (*sql.Tx).Commit, ErrCodeTxCommitFailed, auditEventTxCommitted)
}

// Rollback implements POST /api/v1/tx/{txid}/rollback — discards the
// transaction and removes it from the store.
func (s *GraphServer) Rollback(
	w http.ResponseWriter, r *http.Request, req *gentypes.TxIDParam,
) (*gentypes.Empty, error) {
	return s.finishTx(w, r, req.Txid, (*sql.Tx).Rollback, ErrCodeTxRollbackFailed, auditEventTxRollback)
}

// finishTx is the shared body of Commit and Rollback: it takes the
// caller-owned transaction out of the store, applies finish (Commit or
// Rollback), and emits auditEvent on success. A missing/foreign txid is
// a 404 tx_not_found; a finish error is a 422 carrying failCode.
func (s *GraphServer) finishTx(
	w http.ResponseWriter,
	r *http.Request,
	txid string,
	finish func(*sql.Tx) error,
	failCode, auditEvent string,
) (*gentypes.Empty, error) {
	if s.cfg.TxStore == nil {
		return nil, errors.New("server: tx store not configured")
	}
	tx, err := s.cfg.TxStore.take(txid, userFromContext(r.Context()))
	if err != nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusNotFound,
			code:        ErrCodeTxNotFound,
			description: err.Error(),
		})
		return responseWritten[gentypes.Empty]()
	}
	if err := finish(tx); err != nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusUnprocessableEntity,
			code:        failCode,
			description: err.Error(),
		})
		return responseWritten[gentypes.Empty]()
	}
	emitAudit(auditEvent,
		"user", userFromContext(r.Context()),
		"txid", txid,
	)
	return &gentypes.Empty{}, nil
}
