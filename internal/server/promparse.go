// Package server — promparse.go
//
// Stdlib Prometheus text-exposition (v0.0.4) parser. Limited to the
// three metric families this codebase consumes today: counter, gauge,
// histogram. We do NOT pull github.com/prometheus/common/expfmt; that
// dependency is a ~2 MB transitive blob, and one line per metric is
// trivial to parse with bufio.Scanner. If the upstream metrics surface
// grows summaries or untyped families, extend the switch in
// parsePromLine rather than swapping in expfmt.
//
// Wire format reference: https://prometheus.io/docs/instrumenting/exposition_formats/
//
//   # HELP <name> <text>        — human-readable description of family
//   # TYPE <name> <type>        — declares the next family's kind
//   <name>{labels?} <value>     — sample line; labels are optional
//   <name>_bucket{le="<f>"} <v> — histogram bucket (le label REQUIRED)
//   <name>_sum <v>              — histogram sum
//   <name>_count <v>            — histogram count
//
// Parsing rules:
//
//   - Comments other than HELP / TYPE are skipped (untyped trailing
//     comments are allowed by the spec).
//   - Label sets are scanned for the `le` label only when the sample is
//     a `<name>_bucket` line — every other label is intentionally
//     discarded because the consumer projects per-family scalars
//     (the v1 dashboard does not need per-label cardinality).
//   - For gauges/counters with labels (e.g. server_health{component="server"} 1)
//     the parser takes the FIRST observed value as the family scalar.
//     That matches the single-component layout the geode build emits;
//     a multi-component gauge would need a different projection (out of
//     scope for v1, tracked in the plan's open questions).
//   - The `+Inf` bucket upper bound is encoded as math.Inf(+1) so
//     downstream percentile interpolation does not have to special-case it.
//
// The exported surface is intentionally small: a single ParseProm
// function returning a slice of MetricFamily plus the lookup helpers
// used by handlers_metrics.go's projection step.

package server

import (
	"bufio"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
)

// Bucket is a single histogram bucket: every observation whose value is
// <= UpperBound contributed to Count. Cumulative — Count of bucket N
// includes everything in buckets 0..N-1.
type Bucket struct {
	UpperBound float64 // +Inf is math.Inf(+1)
	Count      uint64
}

// Histogram captures one observed-during-window distribution. Sum is the
// total of all observed values; Count is the number of observations.
type Histogram struct {
	Sum     float64
	Count   uint64
	Buckets []Bucket
}

// MetricFamily is one named family from the exposition. Exactly one of
// Counter / Gauge / Hist is populated, matching Type. Help carries the
// `# HELP` line (may be empty if the upstream omitted it).
type MetricFamily struct {
	Name    string
	Help    string
	Type    string // "counter" | "gauge" | "histogram"
	Counter *float64
	Gauge   *float64
	Hist    *Histogram
}

// ParseProm reads a Prometheus text-exposition stream and returns one
// MetricFamily per `# TYPE`-declared family. Unknown / non-TYPE'd lines
// are skipped silently so a future Prometheus addition (untyped, summary)
// doesn't crash the proxy. The function never returns a partial result
// on error — either it parses cleanly or it returns nil + a wrapped
// scanner error.
func ParseProm(r io.Reader) ([]MetricFamily, error) {
	families := map[string]*MetricFamily{}
	order := []string{} // preserve TYPE-declaration order in output

	scanner := bufio.NewScanner(r)
	// A single metric exposition line is short, but the largest realistic
	// `# HELP` line in Prometheus's own server is well under 8 KiB; bump
	// the scanner buffer to 64 KiB so a verbose upstream HELP can't trip
	// bufio.ErrTooLong.
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "# HELP ") {
			parseHelpLine(line[len("# HELP "):], families, &order)
			continue
		}
		if strings.HasPrefix(line, "# TYPE ") {
			parseTypeLine(line[len("# TYPE "):], families, &order)
			continue
		}
		if strings.HasPrefix(line, "#") {
			continue
		}
		if err := parseSampleLine(line, families); err != nil {
			return nil, fmt.Errorf("promparse: %w", err)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("promparse: scan: %w", err)
	}

	out := make([]MetricFamily, 0, len(order))
	for _, name := range order {
		out = append(out, *families[name])
	}
	return out, nil
}

// ensureFamily returns the family bucket for name, creating it on first
// observation. We accept families that appear in sample lines without a
// preceding `# TYPE` declaration — Prometheus's own server emits them
// for `_sum`/`_count`/`_bucket` rows under one TYPE — but in that case
// the family's Type remains empty until a TYPE line lands.
func ensureFamily(name string, families map[string]*MetricFamily, order *[]string) *MetricFamily {
	if f, ok := families[name]; ok {
		return f
	}
	f := &MetricFamily{Name: name}
	families[name] = f
	*order = append(*order, name)
	return f
}

func parseHelpLine(body string, families map[string]*MetricFamily, order *[]string) {
	name, help, ok := splitFirstSpace(body)
	if !ok {
		return
	}
	ensureFamily(name, families, order).Help = help
}

func parseTypeLine(body string, families map[string]*MetricFamily, order *[]string) {
	name, t, ok := splitFirstSpace(body)
	if !ok {
		return
	}
	f := ensureFamily(name, families, order)
	f.Type = t
	if t == "histogram" && f.Hist == nil {
		f.Hist = &Histogram{}
	}
}

// parseSampleLine resolves one data line. The grammar is permissive:
// `<name>[{<labels>}] <value> [<timestamp>]`. We discard timestamps
// (the proxy already stamps its own) and read only the `le` label off
// histogram buckets — every other label is dropped per the rationale in
// the file header.
func parseSampleLine(line string, families map[string]*MetricFamily) error {
	name, labels, rest, err := splitNameLabelsValue(line)
	if err != nil {
		return err
	}
	value, err := parseFloat(rest)
	if err != nil {
		return fmt.Errorf("value %q on line %q: %w", rest, line, err)
	}

	// Histogram suffix dispatch — only fires if the parent family is
	// declared histogram. Without that gate, an arbitrary `_bucket`-
	// suffixed counter would be silently absorbed into the wrong family.
	for _, suffix := range []string{"_bucket", "_sum", "_count"} {
		if !strings.HasSuffix(name, suffix) {
			continue
		}
		parent, ok := families[strings.TrimSuffix(name, suffix)]
		if !ok || parent.Type != "histogram" {
			break // fall through to the generic gauge/counter path
		}
		if parent.Hist == nil {
			parent.Hist = &Histogram{}
		}
		switch suffix {
		case "_bucket":
			le, ok := labelValue(labels, "le")
			if !ok {
				return fmt.Errorf("histogram bucket missing le label: %q", line)
			}
			ub, err := parseBucketBound(le)
			if err != nil {
				return fmt.Errorf("bucket le=%q: %w", le, err)
			}
			parent.Hist.Buckets = append(parent.Hist.Buckets, Bucket{
				UpperBound: ub,
				Count:      uint64(value),
			})
		case "_sum":
			parent.Hist.Sum = value
		case "_count":
			parent.Hist.Count = uint64(value)
		}
		return nil
	}

	// Counter / gauge dispatch. The family may not have a declared TYPE
	// yet (HELP / TYPE order is not guaranteed by Prom's spec, just
	// observed); in that case we store the value provisionally and the
	// later TYPE line claims it. Per the file header rationale, first-
	// wins for labeled scalars: a multi-labeled gauge collapses to its
	// first observation rather than fanning out.
	f := families[name]
	if f == nil {
		// Sample without a leading HELP/TYPE — store as gauge until a
		// later TYPE line overwrites. Unlikely in real geode output but
		// allowed by the spec.
		f = &MetricFamily{Name: name}
		families[name] = f
	}
	v := value
	switch f.Type {
	case "counter":
		if f.Counter == nil {
			f.Counter = &v
		}
	case "histogram":
		// Already handled above; reaching here means a bare <name>
		// line collided with a histogram family — ignore (Prometheus
		// histograms never emit a bare-name sample).
	default:
		if f.Gauge == nil {
			f.Gauge = &v
		}
	}
	return nil
}

// splitNameLabelsValue cleaves a sample line into (name, labelsRaw, valueRaw).
// labelsRaw is the substring between `{` and `}` exclusive, or empty.
// valueRaw is the first whitespace-separated token after the labels (or
// after the name if there are no labels). Trailing timestamps are
// discarded.
func splitNameLabelsValue(line string) (name, labels, value string, err error) {
	openBrace := strings.IndexByte(line, '{')
	if openBrace >= 0 {
		closeBrace := strings.IndexByte(line[openBrace:], '}')
		if closeBrace < 0 {
			return "", "", "", fmt.Errorf("unterminated labels in %q", line)
		}
		closeBrace += openBrace
		name = strings.TrimSpace(line[:openBrace])
		labels = line[openBrace+1 : closeBrace]
		rest := strings.TrimSpace(line[closeBrace+1:])
		value, _, _ = splitFirstSpace(rest)
		if value == "" {
			value = rest
		}
		return name, labels, value, nil
	}
	first, rest, ok := splitFirstSpace(line)
	if !ok {
		return "", "", "", fmt.Errorf("no value on line %q", line)
	}
	value, _, _ = splitFirstSpace(rest)
	if value == "" {
		value = rest
	}
	return first, "", value, nil
}

// labelValue returns the value of label `key` from the raw label
// fragment, e.g. `le="0.005",quantile="0.5"`. Values are
// double-quoted per the spec; we strip them on the way out. The lookup
// is linear since label sets are tiny (typically 1-3 entries).
func labelValue(raw, key string) (string, bool) {
	for _, part := range splitCSVRespectingQuotes(raw) {
		eq := strings.IndexByte(part, '=')
		if eq < 0 {
			continue
		}
		k := strings.TrimSpace(part[:eq])
		v := strings.TrimSpace(part[eq+1:])
		if k != key {
			continue
		}
		if len(v) >= 2 && v[0] == '"' && v[len(v)-1] == '"' {
			v = v[1 : len(v)-1]
		}
		return v, true
	}
	return "", false
}

// splitCSVRespectingQuotes splits on commas that are NOT inside a
// double-quoted segment. Necessary because label values can themselves
// contain commas, e.g. `path="/a,/b"`.
func splitCSVRespectingQuotes(s string) []string {
	out := []string{}
	depth := 0
	start := 0
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '"':
			depth ^= 1 // toggle quote depth (escapes not handled — labels rarely escape)
		case ',':
			if depth == 0 {
				out = append(out, s[start:i])
				start = i + 1
			}
		}
	}
	if start <= len(s) {
		out = append(out, s[start:])
	}
	return out
}

// splitFirstSpace returns the substring before the first run of
// whitespace and the substring after, both trimmed. The third return is
// false when the input has no whitespace at all.
func splitFirstSpace(s string) (first, rest string, ok bool) {
	for i := 0; i < len(s); i++ {
		if s[i] == ' ' || s[i] == '\t' {
			return strings.TrimSpace(s[:i]), strings.TrimSpace(s[i+1:]), true
		}
	}
	return strings.TrimSpace(s), "", false
}

func parseFloat(s string) (float64, error) {
	switch s {
	case "+Inf", "Inf":
		return math.Inf(+1), nil
	case "-Inf":
		return math.Inf(-1), nil
	case "NaN":
		return math.NaN(), nil
	}
	return strconv.ParseFloat(s, 64)
}

func parseBucketBound(s string) (float64, error) { return parseFloat(s) }

// FindFamily returns the family with the given name, or nil. Used by
// the handler's projection step and the test helpers; preserves the
// "no implicit zero" contract — a missing family stays nil rather than
// collapsing to a zero-valued family that confuses downstream callers.
func FindFamily(fams []MetricFamily, name string) *MetricFamily {
	for i := range fams {
		if fams[i].Name == name {
			return &fams[i]
		}
	}
	return nil
}
