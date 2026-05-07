package gqlx

import (
	"context"
	"encoding/binary"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"

	"geodedb.com/geode-ui/gen/pkg/gen"
)

const maxWSFrameBytes int64 = 1 << 20 // 1 MiB per frame

// ErrWSFrameTooLarge is returned by the in-package WebSocket frame
// reader when an inbound frame exceeds [maxWSFrameBytes]. The reader
// is independent of pkg/wsx's framing, so the sentinel lives here to
// keep gqlx self-contained.
var ErrWSFrameTooLarge = errors.New("gqlx: websocket frame exceeds configured size")

// wsMessage represents a graphql-transport-ws protocol message.
type wsMessage struct {
	Type    string         `json:"type"`
	ID      string         `json:"id,omitempty"`
	Payload jsontext.Value `json:"payload,omitempty"`
}

// subscribePayload is the payload of a "subscribe" message.
type subscribePayload struct {
	Query         string         `json:"query"`
	Variables     map[string]any `json:"variables,omitempty"`
	OperationName string         `json:"operationName,omitempty"`
}

// SubscriptionOptions configures the subscription handler.
type SubscriptionOptions struct {
	MaxSubscriptions int
	ValidateOptions  ValidateOptions
}

// activeSub tracks a single running subscription.
type activeSub struct {
	cancel context.CancelFunc
}

// SubscriptionHandler manages subscription lifecycle over WebSocket using
// the graphql-transport-ws protocol (https://github.com/enisdenjo/graphql-ws).
type SubscriptionHandler struct {
	schema *Schema
	opts   SubscriptionOptions

	mu   sync.Mutex
	subs map[string]*activeSub
	conn net.Conn
	base context.Context
}

// NewSubscriptionHandler creates a subscription handler.
func NewSubscriptionHandler(schema *Schema, opts SubscriptionOptions) *SubscriptionHandler {
	if opts.MaxSubscriptions <= 0 {
		opts.MaxSubscriptions = 10
	}
	return &SubscriptionHandler{schema: schema, opts: opts, base: context.Background()}
}

// HandleConn runs the graphql-transport-ws protocol over a raw net.Conn.
// The caller is responsible for completing the HTTP-to-WebSocket upgrade
// before passing the connection. HandleConn blocks until the connection
// is closed or an unrecoverable error occurs.
func (h *SubscriptionHandler) HandleConn(c net.Conn, req *http.Request) {
	h.mu.Lock()
	h.conn = c
	h.subs = make(map[string]*activeSub)
	if req != nil {
		h.base = ContextWithRequest(req.Context(), req)
	} else {
		h.base = context.Background()
	}
	h.mu.Unlock()

	defer h.cleanup(c)

	for {
		data, err := readWSFrame(c)
		if err != nil {
			return
		}

		var msg wsMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			return
		}

		switch msg.Type {
		case "connection_init":
			h.handleInit(c)
		case "subscribe":
			h.handleSubscribe(c, msg)
		case "complete":
			h.handleComplete(msg.ID)
		case "ping":
			h.handlePing(c)
		}
	}
}

// handleInit responds to connection_init with connection_ack.
func (h *SubscriptionHandler) handleInit(c net.Conn) {
	ack := wsMessage{Type: "connection_ack"}
	_ = h.writeMessage(c, ack)
}

// handlePing responds to ping with pong.
func (h *SubscriptionHandler) handlePing(c net.Conn) {
	pong := wsMessage{Type: "pong"}
	_ = h.writeMessage(c, pong)
}

// handleSubscribe processes a subscribe message: parses and validates the
// query, finds the subscription field, calls SubscribeFunc, and starts a
// goroutine to read values from the channel and send next messages.
func (h *SubscriptionHandler) handleSubscribe(c net.Conn, msg wsMessage) {
	// Check max subscriptions limit.
	h.mu.Lock()
	if len(h.subs) >= h.opts.MaxSubscriptions {
		h.mu.Unlock()
		h.sendError(c, msg.ID, "max subscriptions exceeded")
		return
	}
	h.mu.Unlock()

	// Parse the subscribe payload.
	var payload subscribePayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		h.sendError(c, msg.ID, fmt.Sprintf("invalid payload: %v", err))
		return
	}

	// Parse the GraphQL query.
	doc, err := Parse(payload.Query)
	if err != nil {
		h.sendError(c, msg.ID, fmt.Sprintf("parse error: %v", err))
		return
	}

	// Validate against the schema.
	vopts := h.opts.ValidateOptions
	if vopts.MaxDepth == 0 {
		vopts.MaxDepth = 10
	}
	if vopts.MaxComplexity == 0 {
		vopts.MaxComplexity = 100
	}
	if vopts.MaxAliases == 0 {
		vopts.MaxAliases = 10
	}
	if err := Validate(doc, h.schema, vopts); err != nil {
		h.sendError(c, msg.ID, fmt.Sprintf("validation error: %v", err))
		return
	}

	// Select the operation.
	exec := &executor{
		schema:    h.schema,
		variables: payload.Variables,
		fragments: make(map[string]*FragmentDef, len(doc.Fragments)),
	}
	for _, frag := range doc.Fragments {
		exec.fragments[frag.Name] = frag
	}

	op, gqlErr := exec.selectOperation(doc, payload.OperationName)
	if gqlErr != nil {
		h.sendError(c, msg.ID, gqlErr.Message)
		return
	}

	if op.Type != OperationSubscription {
		h.sendError(c, msg.ID, "operation is not a subscription")
		return
	}

	// Find the subscription field. Per the GraphQL spec, a subscription
	// operation must have exactly one root field.
	if len(op.Selections) == 0 {
		h.sendError(c, msg.ID, "subscription has no fields")
		return
	}

	field, ok := op.Selections[0].(*Field)
	if !ok {
		h.sendError(c, msg.ID, "invalid subscription selection")
		return
	}

	fieldDef, ok := h.schema.Subscription.Field(field.Name)
	if !ok {
		h.sendError(c, msg.ID, fmt.Sprintf("field %q not found on Subscription", field.Name))
		return
	}

	if fieldDef.Subscribe == nil {
		h.sendError(c, msg.ID, fmt.Sprintf("field %q has no subscribe function", field.Name))
		return
	}

	// Coerce arguments.
	args := exec.coerceArgs(field.Arguments)

	// Create a cancellable context for this subscription.
	ctx, cancel := context.WithCancel(h.base)

	// Register the subscription.
	h.mu.Lock()
	// Double-check limit under lock (race with concurrent subscribe messages).
	if len(h.subs) >= h.opts.MaxSubscriptions {
		h.mu.Unlock()
		cancel()
		h.sendError(c, msg.ID, "max subscriptions exceeded")
		return
	}
	h.subs[msg.ID] = &activeSub{cancel: cancel}
	h.mu.Unlock()

	// Call the subscribe function.
	ch, err := fieldDef.Subscribe(ctx, args)
	if err != nil {
		h.mu.Lock()
		delete(h.subs, msg.ID)
		h.mu.Unlock()
		cancel()
		h.sendError(c, msg.ID, fmt.Sprintf("subscribe error: %v", err))
		return
	}

	// Start a goroutine to read values and send next messages.
	gen.SafeGo("gql-subscription-stream", func() {
		h.streamSubscription(c, msg.ID, field.Name, ch, cancel)
	})
}

// streamSubscription reads values from the subscription channel and sends
// "next" messages. When the channel closes, it sends a "complete" message
// and cleans up.
func (h *SubscriptionHandler) streamSubscription(c net.Conn, id, fieldName string, ch <-chan any, cancel context.CancelFunc) {
	defer func() {
		cancel()
		h.mu.Lock()
		delete(h.subs, id)
		h.mu.Unlock()
	}()

	for val := range ch {
		// The subscription channel should yield a map with the field
		// data already keyed. If the value is already a map, wrap it
		// in a Response. Otherwise, construct the map.
		var data any
		if m, ok := val.(map[string]any); ok {
			if _, keyed := m[fieldName]; keyed {
				data = m
			} else {
				data = map[string]any{fieldName: m}
			}
		} else {
			data = map[string]any{fieldName: val}
		}

		resp := Response{Data: data}
		respBytes, err := json.Marshal(resp)
		if err != nil {
			continue
		}

		next := wsMessage{
			Type:    "next",
			ID:      id,
			Payload: jsontext.Value(respBytes),
		}
		if err := h.writeMessage(c, next); err != nil {
			return
		}
	}

	// Channel closed — send complete.
	complete := wsMessage{
		Type: "complete",
		ID:   id,
	}
	_ = h.writeMessage(c, complete)
}

// handleComplete cancels a subscription by ID.
func (h *SubscriptionHandler) handleComplete(id string) {
	h.mu.Lock()
	sub, ok := h.subs[id]
	if ok {
		delete(h.subs, id)
	}
	h.mu.Unlock()
	if ok {
		sub.cancel()
	}
}

// cleanup cancels all active subscriptions and closes the connection.
func (h *SubscriptionHandler) cleanup(c net.Conn) {
	h.mu.Lock()
	for id, sub := range h.subs {
		sub.cancel()
		delete(h.subs, id)
	}
	h.mu.Unlock()
	_ = c.Close()
}

// sendError sends an error message for a given subscription ID.
func (h *SubscriptionHandler) sendError(c net.Conn, id, message string) {
	errPayload, _ := json.Marshal([]*GQLError{{Message: message}})
	msg := wsMessage{
		Type:    "error",
		ID:      id,
		Payload: jsontext.Value(errPayload),
	}
	_ = h.writeMessage(c, msg)
}

// writeMessage marshals and sends a wsMessage as a WebSocket frame.
// It is safe for concurrent use.
func (h *SubscriptionHandler) writeMessage(c net.Conn, msg wsMessage) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	return writeWSFrame(c, data)
}

// writeWSFrame writes an unmasked text WebSocket frame (FIN=1, opcode=1).
func writeWSFrame(c net.Conn, data []byte) error {
	length := len(data)
	var header []byte

	switch {
	case length < 126:
		header = []byte{0x81, byte(length)}
	case length <= 65535:
		header = make([]byte, 4)
		header[0] = 0x81
		header[1] = 126
		binary.BigEndian.PutUint16(header[2:4], uint16(length))
	default:
		header = make([]byte, 10)
		header[0] = 0x81
		header[1] = 127
		binary.BigEndian.PutUint64(header[2:10], uint64(length))
	}

	frame := make([]byte, 0, len(header)+length)
	frame = append(frame, header...)
	frame = append(frame, data...)
	_, err := c.Write(frame)
	return err
}

// readWSFrame reads a single WebSocket frame. It handles both masked and
// unmasked frames.
func readWSFrame(c net.Conn) ([]byte, error) {
	hdr := make([]byte, 2)
	if _, err := readFull(c, hdr); err != nil {
		return nil, err
	}

	masked := hdr[1]&0x80 != 0
	length := int64(hdr[1] & 0x7F)

	switch length {
	case 126:
		ext := make([]byte, 2)
		if _, err := readFull(c, ext); err != nil {
			return nil, err
		}
		length = int64(binary.BigEndian.Uint16(ext))
	case 127:
		ext := make([]byte, 8)
		if _, err := readFull(c, ext); err != nil {
			return nil, err
		}
		length = int64(binary.BigEndian.Uint64(ext)) //nolint:gosec // G115: bounded by maxWSFrameBytes check below
	}
	if length < 0 || length > maxWSFrameBytes {
		return nil, ErrWSFrameTooLarge
	}

	var maskKey []byte
	if masked {
		maskKey = make([]byte, 4)
		if _, err := readFull(c, maskKey); err != nil {
			return nil, err
		}
	}

	payload := make([]byte, length)
	if length > 0 {
		if _, err := readFull(c, payload); err != nil {
			return nil, err
		}
	}

	if masked {
		for i := range payload {
			payload[i] ^= maskKey[i%4]
		}
	}

	return payload, nil
}

// readFull reads exactly len(buf) bytes from the connection.
func readFull(c net.Conn, buf []byte) (int, error) {
	return io.ReadFull(c, buf)
}
