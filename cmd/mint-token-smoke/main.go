// Package main is a throw-away smoke helper that mints a JWT using the
// same internal/jwt package the server uses. Not shipped — only used by
// the B-Task 10 smoke test.
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
