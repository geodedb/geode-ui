package profilestore

import "time"

// nsAsDuration converts a nanosecond count read from SQLite into a
// time.Duration. Zero stays zero so the caller can distinguish "no
// override" from a literal zero duration downstream.
func nsAsDuration(ns int64) time.Duration {
	if ns == 0 {
		return 0
	}
	return time.Duration(ns)
}

// durationAsNs converts a time.Duration to an int64 nanosecond count
// for SQLite storage.
func durationAsNs(d time.Duration) int64 { return int64(d) }
