#!/usr/bin/env bash
# QUALITY #233: image-pin staleness guard.
#
# Walks `.gitlab-ci.yml` and `deploy/Dockerfile` looking for the
# `# image-pin: <YYYY-MM-DD> @ <reason>` comment block we use to date
# every container/CI image reference. Warns (exit code 0) when a pin
# is older than 60 days; that's the cadence the team agreed to refresh
# the digests at. Fails loudly (exit code 1) when an image reference
# carries no pin comment at all.
#
# Sensible default: 60-day cadence per the planner spec. Override with
# `IMAGE_PIN_MAX_AGE_DAYS=<n>` if a different cadence ever applies.

set -euo pipefail

MAX_AGE_DAYS="${IMAGE_PIN_MAX_AGE_DAYS:-60}"
TODAY_EPOCH=$(date -u +%s)
WARN=0
FAIL=0

# Files to walk: GitLab CI + every Dockerfile under deploy/. Add more
# entries here when a new image-bearing config file is introduced.
FILES=(.gitlab-ci.yml)
while IFS= read -r -d '' f; do
  FILES+=("$f")
done < <(find deploy -maxdepth 2 -name 'Dockerfile*' -print0 2>/dev/null)

scan_file() {
  local file="$1"
  local last_pin_date=""
  local line_no=0
  while IFS= read -r line; do
    line_no=$((line_no + 1))

    # Capture the most recent `# image-pin: YYYY-MM-DD @ <reason>`
    # we see in the file. Each FROM / image: line is checked against
    # the most recently seen pin.
    if [[ "$line" =~ \#[[:space:]]*image-pin:[[:space:]]*([0-9]{4}-[0-9]{2}-[0-9]{2}) ]]; then
      last_pin_date="${BASH_REMATCH[1]}"
      pin_epoch=$(date -u -d "$last_pin_date" +%s 2>/dev/null || echo 0)
      if [ "$pin_epoch" -gt 0 ]; then
        age_days=$(( (TODAY_EPOCH - pin_epoch) / 86400 ))
        if [ "$age_days" -gt "$MAX_AGE_DAYS" ]; then
          echo "WARN: ${file}:${line_no} image-pin ${last_pin_date} is ${age_days} days old (> ${MAX_AGE_DAYS}d)"
          WARN=$((WARN + 1))
        fi
      fi
      continue
    fi

    # Image references: docker FROM, CI `image:` keys. Skip variable
    # substitutions ($X{...}) — those use a pin elsewhere via the
    # variables block.
    if [[ "$line" =~ ^[[:space:]]*FROM[[:space:]]+([^[:space:]]+) ]] \
      || [[ "$line" =~ ^[[:space:]]*image:[[:space:]]+([^[:space:]]+) ]]; then
      img="${BASH_REMATCH[1]}"
      # Skip variable substitutions and intra-stage refs ($X, --from=, scratch).
      if [[ "$img" =~ ^\$ || "$img" == "scratch" ]]; then
        continue
      fi
      if [ -z "$last_pin_date" ]; then
        echo "FAIL: ${file}:${line_no} image '${img}' has no preceding '# image-pin: YYYY-MM-DD @ <reason>' comment"
        FAIL=$((FAIL + 1))
      fi
      # Reset for the next image — each FROM / image: must carry its
      # own preceding pin comment (or share one with an immediately
      # adjacent neighbour).
      last_pin_date=""
    fi
  done < "$file"
}

for f in "${FILES[@]}"; do
  scan_file "$f"
done

if [ "$FAIL" -gt 0 ]; then
  echo
  echo "${FAIL} image reference(s) without a pin comment — failing."
  exit 1
fi

if [ "$WARN" -gt 0 ]; then
  echo
  echo "${WARN} stale image-pin(s) (> ${MAX_AGE_DAYS}d). Refresh the digests."
fi

echo "image-pin check: ${FAIL} fail, ${WARN} warn (max age: ${MAX_AGE_DAYS}d)"
exit 0
