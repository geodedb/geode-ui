package server

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"

	gentypes "geodedb.com/geode-ui/gen/types"
	"geodedb.com/geode-ui/internal/conn"
)

// BenchmarkPostProfile_SyncReloadBaseline is the PRE-F1 baseline: it
// measures handler latency when the (slow) PoolReloader.Reload runs
// SYNCHRONOUSLY in the request critical path, the way pre-fix
// maybeReload did.
//
// We can't simply swap maybeReload back without losing the post-fix
// implementation, so this benchmark drives a one-shot stand-in that
// (a) Puts the profile through the store and (b) immediately calls
// Reload on the same request goroutine. The wall-clock cost is the
// same as pre-fix maybeReload would charge.
//
// Run pair:
//
//	go test -bench BenchmarkPostProfile -benchtime=200x -count=5 \
//	  -run=NONE ./internal/server/
//
// Compare BenchmarkPostProfile_SyncReloadBaseline vs BenchmarkPostProfile
// (post-fix). The delta is the slow-Reload cost (5 ms here) that the
// post-fix handler no longer pays on the critical path.
func BenchmarkPostProfile_SyncReloadBaseline(b *testing.B) {
	silenceSlog(b)
	srv, _ := newBenchServer(b)
	stub := &slowPoolReloader{d: 5 * time.Millisecond}
	srv.cfg.PoolReloader = stub
	b.ReportAllocs()
	b.ResetTimer()
	for i := range b.N {
		r := reqWithActor("POST", "/api/v1/profiles", "alice")
		_, err := srv.PostProfiles(httptest.NewRecorder(), r, &gentypes.CreateProfileReq{
			Scope: string(conn.ProfileScopePersonal),
			Name:  "p" + atoiBenchKey(i),
			Dsn:   "quic://x:1",
		})
		if err != nil {
			b.Fatal(err)
		}
		// Pre-fix maybeReload was a synchronous call here. Drain the
		// async one to mimic that wall-clock cost.
		srv.awaitReloadIdle()
	}
}

// BenchmarkPatchProfile_SyncReloadBaseline mirrors the post-fix
// BenchmarkPatchProfile but synchronously waits for each Reload to
// complete after the handler returns -- the pre-fix wall-clock cost.
func BenchmarkPatchProfile_SyncReloadBaseline(b *testing.B) {
	silenceSlog(b)
	srv, st := newBenchServer(b)
	stub := &slowPoolReloader{d: 5 * time.Millisecond}
	srv.cfg.PoolReloader = stub
	const seed = 64
	ids := make([]string, seed)
	for i := range seed {
		saved, _ := st.Put(context.Background(), conn.Profile{
			Scope: conn.ProfileScopePersonal, OwnerUserID: "alice",
			Name: "p" + atoiBenchKey(i), DSN: "quic://x:1",
		})
		ids[i] = saved.ID
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := range b.N {
		id := ids[i%seed]
		r := reqWithActor("PATCH", "/api/v1/profiles/"+id, "alice")
		r.SetPathValue("profileId", id)
		desc := "tweak-" + atoiBenchKey(i)
		_, err := srv.PatchProfileid(httptest.NewRecorder(), r, &gentypes.UpdateProfileReq{
			Description: &desc,
		})
		if err != nil {
			b.Fatal(err)
		}
		srv.awaitReloadIdle()
	}
}
