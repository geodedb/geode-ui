package log

import (
	"context"
)

// NOOP is a no-operation logger that does nothing.
//
//nolint:gochecknoglobals // this is intentional
var NOOP Logger = &noop{}

type noop struct{}

func (s *noop) Debug(msg string, args ...any) {
}

func (s *noop) Info(msg string, args ...any) {
}

func (s *noop) Warn(msg string, args ...any) {
}

func (s *noop) Error(msg string, args ...any) {
}

func (s *noop) DPanic(msg string, args ...any) {
}

func (s *noop) Panic(msg string, args ...any) {
}

func (s *noop) Fatal(msg string, args ...any) {
}

func (s *noop) DTrace(msg string, args ...any) {
}

func (s *noop) Trace(msg string, args ...any) {
}

func (s *noop) Log(ctx context.Context, level Level, msg string, args ...any) {
}

func (s *noop) SetDefault() Logger {
	return s
}
