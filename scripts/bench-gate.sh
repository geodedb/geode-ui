#!/usr/bin/env bash
# CI perf gate: run the curated benchmark set and fail if any benchmark
# regressed by more than $BENCH_GATE_THRESHOLD percent (default 10%) in
# ns/op, B/op, or allocs/op versus the committed `bench-baseline.txt`.
#
# This gate is *informational-leaning*: CI runners are shared and noisy, so
# benchstat's significance test plus a high -count is what keeps false
# positives down. It still ships as `allow_failure: true` in CI. Treat a
# red gate as "go look", not "you broke production".
#
# Usage:
#   scripts/bench-gate.sh                 # compare vs bench-baseline.txt, fail on regression
#   scripts/bench-gate.sh record          # (re)generate bench-baseline.txt from a clean run
#
# Environment:
#   GOEXPERIMENT, GOTOOLCHAIN  pinned to the repo's standard values if unset.
#   BENCH_GATE_THRESHOLD       regression threshold percent (default 10).
#   BENCH_GATE_COUNT           -count value for `go test -bench` (default 6).
#   BENCH_GATE_BENCHTIME       -benchtime value (default 100ms — bounds the
#                              cheap micro-benchmarks so the whole run is a
#                              couple of minutes, not twenty).
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export GOEXPERIMENT="${GOEXPERIMENT:-jsonv2}"
export GOTOOLCHAIN="${GOTOOLCHAIN:-go1.26.3}"

THRESHOLD="${BENCH_GATE_THRESHOLD:-10}"
COUNT="${BENCH_GATE_COUNT:-6}"
BENCHTIME="${BENCH_GATE_BENCHTIME:-100ms}"
BASELINE="bench-baseline.txt"

# Curated set of benchmark-bearing packages. A `./...` sweep is dominated by
# the cheap micro-benchmarks auto-scaling to a full second each, which is far
# too slow for CI; this list is the actually-meaningful hot-path coverage:
#   internal/conn      — driver pool parse/execute ratio (F11)
#   internal/server    — result codec scan, profile CRUD + sync-reload
#                        baseline, audit ring concurrent append/snapshot (#142),
#                        schema cache labels/edge-types
#   internal/jwt       — revocation reload under concurrent writes (#150)
#   gen/pkg/wsx        — WebSocket round-trip frame batching (F2)
#   gen/pkg/oidcx      — JWK cache hot path
#   gen/pkg/securex    — HMAC body signing (1/10/100 MiB)
#   gen/pkg/gen        — generated helper funcs (slices, channels)
BENCH_PKGS=(
  ./internal/conn/
  ./internal/server/
  ./internal/jwt/
  ./gen/pkg/wsx/
  ./gen/pkg/oidcx/
  ./gen/pkg/securex/
  ./gen/pkg/gen/
)

run_benches() {
  local out="$1"
  echo "==> running curated benchmarks (count=$COUNT, benchtime=$BENCHTIME) into $out" >&2
  # -run='^$' disables unit tests; we only want benchmarks here.
  go test -bench=. -benchmem -run='^$' -benchtime="$BENCHTIME" -count="$COUNT" \
    "${BENCH_PKGS[@]}" | tee "$out" >&2
}

ensure_benchstat() {
  if command -v benchstat >/dev/null 2>&1; then
    return 0
  fi
  echo "==> benchstat not on PATH; installing golang.org/x/perf/cmd/benchstat@latest" >&2
  go install golang.org/x/perf/cmd/benchstat@latest
  # `go install` drops binaries in $GOBIN or $(go env GOPATH)/bin.
  local gobin
  gobin="$(go env GOBIN)"
  [ -n "$gobin" ] || gobin="$(go env GOPATH)/bin"
  export PATH="$gobin:$PATH"
  command -v benchstat >/dev/null 2>&1
}

case "${1:-gate}" in
  record|baseline)
    ensure_benchstat || { echo "benchstat unavailable" >&2; exit 1; }
    run_benches "$BASELINE"
    echo "==> wrote $BASELINE — commit it" >&2
    exit 0
    ;;
  gate)
    : # fall through
    ;;
  *)
    echo "usage: $0 [gate|record]" >&2
    exit 2
    ;;
esac

if [ ! -f "$BASELINE" ]; then
  echo "ERROR: $BASELINE not found. Run '$0 record' and commit it." >&2
  exit 1
fi

ensure_benchstat || { echo "benchstat unavailable" >&2; exit 1; }

CURRENT="$(mktemp -t bench-current.XXXXXX.txt)"
trap 'rm -f "$CURRENT" "$CURRENT.cmp"' EXIT
run_benches "$CURRENT"

echo >&2
echo "==> benchstat $BASELINE -> current" >&2
benchstat "$BASELINE" "$CURRENT" || true
echo >&2

# Machine-readable comparison for the gate decision. CSV columns per data row:
#   name, base_value, base_CV, new_value, new_CV, vs_base, p_value
# vs_base is "~" when the delta is statistical noise, otherwise "+N.NN%" /
# "-N.NN%". A regression is a *positive* delta (slower / more bytes / more
# allocs) above the threshold. benchstat emits one section per metric
# (sec/op, B/op, allocs/op); the parser is metric-agnostic — column 6 is the
# delta in every section.
benchstat -format csv "$BASELINE" "$CURRENT" 2>/dev/null > "$CURRENT.cmp"

REGRESSIONS="$(
  awk -F, -v thr="$THRESHOLD" '
    # skip header/blank/section rows; data rows have >= 7 fields and a
    # non-empty first column that is not a column label. Also skip the
    # "geomean" summary row: benchstat only computes a meaningful geomean
    # delta when the baseline and current runs share the *same* set of
    # benchmark names — adding (or removing) a benchmark shifts the
    # geomean even when no individual benchmark moved, which is a false
    # positive for a per-benchmark regression gate. The later
    # `make bench-baseline` refresh re-aligns the two sets.
    NF >= 7 && $1 != "" && $1 != "geomean" && $1 !~ /^(goos|goarch|pkg|cpu)$/ {
      delta = $6
      # only flag explicit positive deltas above the threshold
      if (delta ~ /^\+[0-9.]+%$/) {
        v = delta
        gsub(/[+%]/, "", v)
        if (v + 0 > thr + 0) {
          print $1 "  " delta "  (" $7 ")"
        }
      }
    }
  ' "$CURRENT.cmp"
)"

if [ -n "$REGRESSIONS" ]; then
  echo "PERF GATE FAILED: the following benchmark(s) regressed > ${THRESHOLD}% vs $BASELINE:" >&2
  echo "$REGRESSIONS" >&2
  echo >&2
  echo "If this is an expected/accepted change, refresh the baseline:" >&2
  echo "  make bench-baseline   # then commit bench-baseline.txt" >&2
  echo "If it looks like CI noise, re-run the job (the gate is allow_failure)." >&2
  exit 1
fi

echo "PERF GATE OK: no benchmark regressed > ${THRESHOLD}% vs $BASELINE." >&2
exit 0
