//go:build smoke

// mint-token-smoke is a manual operator helper for the wire-level
// Bearer round-trip smoke test from Plan B Task 10. It mints an
// admin-scoped JWT bound to a hand-supplied secret. NOT compiled by
// default — guarded by the `smoke` build tag so a stray `go build
// ./cmd/...` cannot accidentally include it in a release image.
//
// Usage:
//
//	scripts/run-go.sh run -tags smoke ./cmd/mint-token-smoke -secret-hex "$HEX"
package main

import (
	"encoding/hex"
	"flag"
	"fmt"
	"os"
	"time"

	"geodedb.com/geode-ui/internal/jwt"
)

func main() {
	secretHex := flag.String("secret-hex", "", "hex-encoded HS256 secret")
	sub := flag.String("sub", "geode", "subject")
	profile := flag.String("profile", "default", "profile name")
	cid := flag.String("cid", "smoke-cid-12345", "connection id")
	flag.Parse()
	if *secretHex == "" {
		fmt.Fprintln(os.Stderr, "missing -secret-hex")
		os.Exit(2)
	}
	secret, err := hex.DecodeString(*secretHex)
	if err != nil {
		panic(err)
	}
	iss, err := jwt.NewIssuer(secret, time.Hour)
	if err != nil {
		panic(err)
	}
	tok, _, err := iss.Issue(*sub, *profile, []string{"admin"}, *cid)
	if err != nil {
		panic(err)
	}
	fmt.Print(tok)
}
