package main

import (
	"context"
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
	"geodedb.com/geode-ui/internal/ui"
)

func main() {
	var listen string
	flag.StringVar(&listen, "listen", ":8080", "address to listen on")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	mux := http.NewServeMux()

	// Stub server — handlers will be implemented in Task A4+.
	srv := &stubServer{}
	genapi.RegisterGeneratedAPI(mux, srv, genapi.APIOptions{
		AuthJWT:     func(*http.Request) error { return errors.New("unimplemented") },
		GlobalRate:  2000,
		GlobalBurst: 400,
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

	server := &http.Server{
		Addr:              listen,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("listening", "addr", listen)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("listen", "err", err)
			os.Exit(1)
		}
	}()
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdownCtx)
}

// stubServer satisfies gen/api.ServerInterface with not-implemented stubs.
// Replaced by internal/server.GraphServer in Task A4.
type stubServer struct{ genapi.UnimplementedServer }
