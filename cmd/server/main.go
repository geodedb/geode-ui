// Command geode-ui is the Geode web UI + API server. The startup wiring
// — flag/env parsing, dependency-graph construction, the middleware
// chain, and the listener/graceful-shutdown loop — lives in app.go
// behind run/newApp/appConfig so it can be exercised by bootstrap unit
// tests (cmd/server/app_test.go); main here is the thin process shim.
package main

import "os"

func main() {
	os.Exit(run(os.Args, os.Getenv, os.Stdout, os.Stderr))
}
