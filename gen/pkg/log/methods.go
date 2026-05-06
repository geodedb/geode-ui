package log

import (
	"context"
	"log/slog"
)

func (l *logger) DPanic(msg string, args ...any) {
	l.Log(l.ctx, DPanic, msg, args...)
	panic(msg)
}

func (l *logger) DTrace(msg string, args ...any) {
	l.Log(l.ctx, DTrace, msg, args...)
}

func (l *logger) Trace(msg string, args ...any) {
	l.Log(l.ctx, Trace, msg, args...)
}

func (l *logger) Debug(msg string, args ...any) {
	l.Log(l.ctx, Debug, msg, args...)
}

func (l *logger) Info(msg string, args ...any) {
	l.Log(l.ctx, Info, msg, args...)
}

func (l *logger) Warn(msg string, args ...any) {
	l.Log(l.ctx, Warn, msg, args...)
}

func (l *logger) Error(msg string, args ...any) {
	l.Log(l.ctx, Error, msg, args...)
}

func (l *logger) Fatal(msg string, args ...any) {
	l.Log(l.ctx, Fatal, msg, args...)
}

func (l *logger) Log(ctx context.Context, level Level, msg string, args ...any) {
	l.slogger.Log(ctx, slog.Level(level), msg, args...)
}

type Logger interface {
	SetDefault() Logger

	DPanic(msg string, args ...any)
	DTrace(msg string, args ...any)
	Trace(msg string, args ...any)
	Debug(msg string, args ...any)
	Info(msg string, args ...any)
	Warn(msg string, args ...any)
	Error(msg string, args ...any)
	Fatal(msg string, args ...any)

	Log(ctx context.Context, level Level, msg string, args ...any)
}
