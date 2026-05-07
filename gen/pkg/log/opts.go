package log

import (
	"io"
	"log/slog"
)

type Option func(*logger) error

func WithConfig(c *Config) Option {
	return func(l *logger) error {
		return nil
	}
}

type Format int8

const (
	Text Format = iota
	JSON
)

func WithFormat(f Format) Option {
	return func(l *logger) error {
		l.handlerFn = TextHandler
		if f == JSON {
			l.handlerFn = JSONHandler
		}
		return nil
	}
}

func WithLevel(level Level) Option {
	return func(l *logger) error {
		l.level = level
		return nil
	}
}

type NewHandler func(io.Writer, *slog.HandlerOptions) slog.Handler

func TextHandler(w io.Writer, h *slog.HandlerOptions) slog.Handler {
	return slog.NewTextHandler(w, h)
}

func JSONHandler(w io.Writer, h *slog.HandlerOptions) slog.Handler {
	return slog.NewJSONHandler(w, h)
}

// NOTE: removing the source because it's not correct
// func WithSource() Option {
// 	return func(l *logger) error {
// 		l.addSource = true
// 		return nil
// 	}
// }

func WithGroup(group string) Option {
	return func(l *logger) error {
		l.group = group
		return nil
	}
}

func WithArgs(args ...slog.Attr) Option {
	return func(l *logger) error {
		l.args = append(l.args, args...)
		return nil
	}
}
