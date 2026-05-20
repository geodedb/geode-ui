package server

import (
	"bytes"
	"math"
	"os"
	"strings"
	"testing"
)

func TestParseProm_Counter(t *testing.T) {
	const in = `# HELP geode_queries_total Total queries executed
# TYPE geode_queries_total counter
geode_queries_total 42
`
	fams, err := ParseProm(strings.NewReader(in))
	if err != nil {
		t.Fatalf("ParseProm: %v", err)
	}
	f := FindFamily(fams, "geode_queries_total")
	if f == nil {
		t.Fatal("geode_queries_total family not found")
	}
	if f.Type != "counter" {
		t.Fatalf("type: want counter, got %q", f.Type)
	}
	if f.Counter == nil || *f.Counter != 42 {
		t.Fatalf("counter: want 42, got %v", f.Counter)
	}
	if f.Help != "Total queries executed" {
		t.Fatalf("help: %q", f.Help)
	}
}

func TestParseProm_Gauge(t *testing.T) {
	const in = `# TYPE geode_connections_active gauge
geode_connections_active 5
`
	fams, _ := ParseProm(strings.NewReader(in))
	f := FindFamily(fams, "geode_connections_active")
	if f == nil || f.Gauge == nil || *f.Gauge != 5 {
		t.Fatalf("gauge: %+v", f)
	}
}

func TestParseProm_LabeledGauge(t *testing.T) {
	// Labels on a gauge/counter collapse to the FIRST observed value
	// per the projection rule documented in promparse.go's header.
	const in = `# TYPE geode_server_health gauge
geode_server_health{geode_component="server"} 1
`
	fams, _ := ParseProm(strings.NewReader(in))
	f := FindFamily(fams, "geode_server_health")
	if f == nil || f.Gauge == nil || *f.Gauge != 1 {
		t.Fatalf("labeled gauge: %+v", f)
	}
}

func TestParseProm_Histogram(t *testing.T) {
	const in = `# TYPE geode_query_duration_seconds histogram
geode_query_duration_seconds_bucket{le="0.005"} 10
geode_query_duration_seconds_bucket{le="0.01"} 25
geode_query_duration_seconds_bucket{le="+Inf"} 42
geode_query_duration_seconds_sum 0.184
geode_query_duration_seconds_count 42
`
	fams, err := ParseProm(strings.NewReader(in))
	if err != nil {
		t.Fatal(err)
	}
	f := FindFamily(fams, "geode_query_duration_seconds")
	if f == nil || f.Hist == nil {
		t.Fatalf("histogram missing: %+v", f)
	}
	if f.Hist.Count != 42 {
		t.Fatalf("count: want 42, got %d", f.Hist.Count)
	}
	if f.Hist.Sum != 0.184 {
		t.Fatalf("sum: want 0.184, got %v", f.Hist.Sum)
	}
	if len(f.Hist.Buckets) != 3 {
		t.Fatalf("buckets: want 3, got %d", len(f.Hist.Buckets))
	}
	if f.Hist.Buckets[0].UpperBound != 0.005 || f.Hist.Buckets[0].Count != 10 {
		t.Fatalf("bucket[0]: %+v", f.Hist.Buckets[0])
	}
	last := f.Hist.Buckets[len(f.Hist.Buckets)-1]
	if !math.IsInf(last.UpperBound, +1) || last.Count != 42 {
		t.Fatalf("+Inf bucket: %+v", last)
	}
}

func TestParseProm_FixtureFile(t *testing.T) {
	data, err := os.ReadFile("testdata/prom-sample.txt")
	if err != nil {
		t.Fatal(err)
	}
	fams, err := ParseProm(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}

	// Spot-check every family the dashboard cards consume so a future
	// upstream rename trips this test before it ships.
	checkCounter(t, fams, "geode_queries_total", 42)
	checkCounter(t, fams, "geode_queries_failed_total", 3)
	checkGauge(t, fams, "geode_connections_active", 5)
	checkGauge(t, fams, "geode_nodes_total", 1500)
	checkGauge(t, fams, "geode_edges_total", 3200)
	checkGauge(t, fams, "geode_memory_bytes", 134217728)

	h := FindFamily(fams, "geode_query_duration_seconds")
	if h == nil || h.Hist == nil || h.Hist.Count != 42 || h.Hist.Sum != 0.184 {
		t.Fatalf("histogram: %+v", h)
	}
	if len(h.Hist.Buckets) != 4 {
		t.Fatalf("buckets: want 4, got %d", len(h.Hist.Buckets))
	}
}

func TestParseProm_RealGeodeSample(t *testing.T) {
	// The captured-from-running-geode fixture is here as a regression
	// gate — if the upstream renames a metric or changes the wire
	// shape, this fails before the dashboard ships a broken card.
	data, err := os.ReadFile("testdata/prom-geode-sample.txt")
	if err != nil {
		t.Skip("no captured geode sample; run scripts to recapture")
	}
	fams, err := ParseProm(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("ParseProm: %v", err)
	}
	want := []string{
		"geode_queries_total",
		"geode_connections_active",
		"geode_nodes_total",
		"geode_edges_total",
		"geode_memory_bytes",
		"geode_query_duration_seconds",
	}
	for _, name := range want {
		if FindFamily(fams, name) == nil {
			t.Errorf("expected family %q missing from real geode sample", name)
		}
	}
}

func TestParseProm_IgnoresUnknownComments(t *testing.T) {
	const in = `# This is a free-form comment.
# Not a HELP or TYPE line.
# TYPE x gauge
x 1
`
	fams, err := ParseProm(strings.NewReader(in))
	if err != nil {
		t.Fatal(err)
	}
	if len(fams) != 1 || fams[0].Name != "x" {
		t.Fatalf("families: %+v", fams)
	}
}

func TestParseProm_EmptyInput(t *testing.T) {
	fams, err := ParseProm(strings.NewReader(""))
	if err != nil {
		t.Fatal(err)
	}
	if len(fams) != 0 {
		t.Fatalf("want 0 families, got %d", len(fams))
	}
}

func TestParseProm_OrderPreserved(t *testing.T) {
	const in = `# TYPE a counter
a 1
# TYPE b gauge
b 2
# TYPE c counter
c 3
`
	fams, _ := ParseProm(strings.NewReader(in))
	got := []string{}
	for _, f := range fams {
		got = append(got, f.Name)
	}
	if strings.Join(got, ",") != "a,b,c" {
		t.Fatalf("order: %v", got)
	}
}

func checkCounter(t *testing.T, fams []MetricFamily, name string, want float64) {
	t.Helper()
	f := FindFamily(fams, name)
	if f == nil || f.Counter == nil {
		t.Fatalf("%s: missing counter", name)
	}
	if *f.Counter != want {
		t.Fatalf("%s: want %v, got %v", name, want, *f.Counter)
	}
}

func checkGauge(t *testing.T, fams []MetricFamily, name string, want float64) {
	t.Helper()
	f := FindFamily(fams, name)
	if f == nil || f.Gauge == nil {
		t.Fatalf("%s: missing gauge", name)
	}
	if *f.Gauge != want {
		t.Fatalf("%s: want %v, got %v", name, want, *f.Gauge)
	}
}
