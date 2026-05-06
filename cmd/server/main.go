package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	genapi "geodedb.com/geode-ui/gen/api"
	"geodedb.com/geode-ui/gen/pkg/httpx"
	genws "geodedb.com/geode-ui/gen/ws"
	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/server"
	"geodedb.com/geode-ui/internal/ui"
)

func main() {
	var (
		listen       string
		profilesFile string
	)
	flag.StringVar(&listen, "listen", ":8080", "address to listen on")
	flag.StringVar(&profilesFile, "profiles", "", "path to JSON profiles config")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	profiles := []conn.Profile{{Name: "default", DSN: "quic://127.0.0.1:3141"}}
	if profilesFile != "" {
		raw, err := os.ReadFile(profilesFile)
		if err != nil {
			slog.Error("read profiles", "err", err)
			os.Exit(1)
		}
		if err := json.Unmarshal(raw, &profiles); err != nil {
			slog.Error("parse profiles", "err", err)
			os.Exit(1)
		}
	}
	pool, err := conn.NewPool(profiles)
	if err != nil {
		slog.Error("conn pool", "err", err)
		os.Exit(1)
	}
	defer func() { _ = pool.Close() }()

	mux := http.NewServeMux()

	srv := server.New(server.Config{
		Version: "v0.1.0",
		Pool:    pool,
	})
	genapi.RegisterGeneratedAPI(mux, srv, genapi.APIOptions{
		AuthJWT:     func(*http.Request) error { return errors.New("unimplemented") },
		GlobalRate:  2000,
		GlobalBurst: 400,
	})

	// /ws/* surface lives on a separate server type because the
	// generated WS interface emits "Query" for /ws/query, which would
	// collide with the API "Query" method on *GraphServer. Both
	// servers share the same Config (and therefore the same Pool)
	// and AuthJWT stub — B9 will replace both with srv.AuthJWT once
	// JWT verification lands.
	wsSrv := server.NewWSServer(server.Config{
		Version: "v0.1.0",
		Pool:    pool,
	})
	genws.RegisterGeneratedWS(mux, wsSrv, genws.WSOptions{
		AuthJWT: func(*http.Request) error { return errors.New("unimplemented") },
	})

	uiHandler, err := ui.Handler()
	if err != nil {
		slog.Error("ui handler", "err", err)
		os.Exit(1)
	}
	mux.Handle("/", uiHandler)

	hcfg := httpx.Config{
		ReadHeader:     5 * time.Second,
		ReadTimeout:    30 * time.Second,
		WriteTimeout:   60 * time.Second,
		IdleTimeout:    120 * time.Second,
		MaxHeaderBytes: 16384,
		MaxBodyBytes:   1 << 20,
	}
	handler := httpx.WrapHandler(hcfg, mux)

	httpSrv := &http.Server{
		Addr:              listen,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("listening", "addr", listen)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("listen", "err", err)
			os.Exit(1)
		}
	}()
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdownCtx)
}
