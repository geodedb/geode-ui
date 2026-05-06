package log

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"

	"gopkg.in/natefinch/lumberjack.v2"
)

type Level int

func (t Level) String() string {
	switch t {
	case DTrace:
		return "deep-trace"
	case Trace:
		return "trace"
	case Debug:
		return "debug"
	case Info:
		return "info"
	case Warn:
		return "warn"
	case Error:
		return "error"
	case Fatal:
		return "fatal"
	default:
		return slog.Level(t).String()
	}
}

func (t Level) Level() slog.Level {
	return slog.Level(t)
}

const (
	DPanic Level = -20
	DTrace Level = -15
	Trace  Level = -6
	Debug  Level = -4
	Info   Level = 0
	Warn   Level = 4
	Error  Level = 8
	Crit   Level = 10
	Fatal  Level = 15
	Sec    Level = 20

	DefaultLevel Level = Error
)

func ParseLevel(level string) Level {
	level = strings.ToLower(strings.TrimSpace(level))

	switch level {
	case "debug-panic":
		return DPanic
	case "deep-trace":
		return DTrace
	case "trace":
		return Trace
	case "debug":
		return Debug
	case "info":
		return Info
	case "warn":
		return Warn
	case "error":
		return Error
	case "fatal":
		return Fatal
	default:
		return DefaultLevel
	}
}

type logger struct {
	ctx context.Context

	slogger *slog.Logger
	level   Level
	w       io.Writer
	group   string
	args    []slog.Attr

	addSource bool
	replAttr  func(groups []string, a slog.Attr) slog.Attr

	handlerFn NewHandler
}

func Default() Logger {
	return &logger{
		slogger: slog.Default(),
		ctx:     context.Background(),
		w:       os.Stderr,
	}
}

func New(ctx context.Context, opts ...Option) Logger {
	out := &logger{
		ctx:       ctx,
		level:     DefaultLevel,
		w:         os.Stderr,
		handlerFn: TextHandler,
		slogger:   slog.Default(),
	}

	for _, opt := range opts {
		err := opt(out)
		if err != nil {
			return out
		}
	}

	// Re-Initialize Logger with updated Options
	out.slogger = out.init()
	return out
}

func (l *logger) init() *slog.Logger {
	options := &slog.HandlerOptions{
		Level:       l.level,
		AddSource:   l.addSource,
		ReplaceAttr: l.replAttr,
	}

	h := l.handlerFn(l.w, options)

	if len(l.args) > 0 {
		h = h.WithAttrs(l.args)
	}

	if l.group != "" {
		h = h.WithGroup(l.group)
	}

	return slog.New(h)
}

// # Logger configures the log location and log rotation settings.
// # Uses configuration from https://github.com/natefinch/lumberjack/tree/v2.0
// logger:
//
//	# Path to log file or :stdout: for stdout # Leave empty to log to stderr
//	filename: "/var/log/appname/appname.log"
//	level: "error" # debug, info, warn, error, fatal
//	format: "json" # or "console"
//	maxage: 30
//	maxsize: 100 # MB
//	maxbackups: 10
//	localtime: true
//	compress: true
type Config lumberjack.Logger

func (l *logger) SetDefault() Logger {
	slog.SetDefault(l.slogger)
	return l
}

func TestLogger(ctx context.Context, t *testing.T) Logger {
	if !testing.Testing() {
		panic("not testing")
	}

	level := Error
	ll := os.Getenv("LOG_LEVEL")
	if testing.Verbose() || ll != "" {
		level = Debug
		if ll != "" {
			level = ParseLevel(ll)
		}
	}

	f := Text
	if os.Getenv("LOG_FORMAT") == "json" {
		f = JSON
	}

	logger := New(
		ctx,
		WithLevel(level),
		WithFormat(f),
	)

	logger.SetDefault()

	t.Cleanup(func() {
		slog.SetDefault(slog.Default())
	})

	return &testlogger{
		Logger: logger,
		t:      t,
	}
}

type testlogger struct {
	Logger
	t *testing.T
}

func (l *testlogger) Error(msg string, args ...any) {
	args = append([]any{slog.String("test", l.t.Name())}, args...)
	l.Logger.Error(msg, args...)
	l.t.FailNow()
}

func (l *testlogger) Fatal(msg string, args ...any) {
	args = append([]any{slog.String("test", l.t.Name())}, args...)
	l.Logger.Fatal(msg, args...)
	l.t.FailNow()
}
