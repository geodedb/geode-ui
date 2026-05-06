package securex

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// mkRequest builds a request with the given RemoteAddr and optional headers.
func mkRequest(remoteAddr string, headers map[string]string) *http.Request {
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/x", nil)
	r.RemoteAddr = remoteAddr
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	return r
}

// TestAllowInsecureDev_NonLoopbackDenied proves that a non-loopback peer with
// the dev-bypass env variable set to a truthy value is still denied.
func TestAllowInsecureDev_NonLoopbackDenied(t *testing.T) {
	cases := []string{
		"8.8.8.8:12345",
		"203.0.113.5:1234",
		"1.2.3.4:80",
		"192.0.2.1:443",
	}
	t.Setenv("GENAPI_INSECURE_DEV", "1")
	for _, addr := range cases {
		t.Run(addr, func(t *testing.T) {
			r := mkRequest(addr, nil)
			if AllowInsecureDev(r, true) {
				t.Fatalf("expected deny for non-loopback peer %s, got allow", addr)
			}
		})
	}
}

// TestAllowInsecureDev_IgnoresXForwardedFor proves that X-Forwarded-For cannot
// be used to fake a loopback origin. The TCP peer must be the loopback.
func TestAllowInsecureDev_IgnoresXForwardedFor(t *testing.T) {
	t.Setenv("GENAPI_INSECURE_DEV", "1")
	r := mkRequest("8.8.8.8:1234", map[string]string{
		"X-Forwarded-For": "127.0.0.1",
	})
	if AllowInsecureDev(r, true) {
		t.Fatalf("expected deny: X-Forwarded-For must not influence loopback decision")
	}
}

// TestAllowInsecureDev_LoopbackDebugEnv_Allowed proves that when all three
// conditions hold (loopback TCP peer, debug mode, env=truthy) the bypass
// fires.
func TestAllowInsecureDev_LoopbackDebugEnv_Allowed(t *testing.T) {
	t.Setenv("GENAPI_INSECURE_DEV", "1")
	loopbacks := []string{
		"127.0.0.1:1234",
		"[::1]:1234",
	}
	for _, addr := range loopbacks {
		t.Run(addr, func(t *testing.T) {
			r := mkRequest(addr, nil)
			if !AllowInsecureDev(r, true) {
				t.Fatalf("expected allow for loopback peer %s in debug with env=1", addr)
			}
		})
	}
}

// TestAllowInsecureDev_LoopbackButNotDebug proves that loopback + env=1 without
// debug mode still denies.
func TestAllowInsecureDev_LoopbackButNotDebug(t *testing.T) {
	t.Setenv("GENAPI_INSECURE_DEV", "1")
	r := mkRequest("127.0.0.1:5555", nil)
	if AllowInsecureDev(r, false) {
		t.Fatalf("expected deny when debug mode is off")
	}
}

// TestAllowInsecureDev_LoopbackDebugButNoEnv proves that loopback + debug
// without the env variable still denies.
func TestAllowInsecureDev_LoopbackDebugButNoEnv(t *testing.T) {
	t.Setenv("GENAPI_INSECURE_DEV", "")
	r := mkRequest("127.0.0.1:5555", nil)
	if AllowInsecureDev(r, true) {
		t.Fatalf("expected deny when env variable is unset")
	}
}

// TestAllowInsecureDev_EnvParsingMatchesExisting proves that the function
// accepts the same set of truthy values as the existing parseBoolEnv.
func TestAllowInsecureDev_EnvParsingMatchesExisting(t *testing.T) {
	for _, truthy := range []string{"1", "true", "True", "TRUE", "yes", "y", "on", "Y", "YES", "ON"} {
		t.Run("truthy_"+truthy, func(t *testing.T) {
			t.Setenv("GENAPI_INSECURE_DEV", truthy)
			r := mkRequest("127.0.0.1:1", nil)
			if !AllowInsecureDev(r, true) {
				t.Fatalf("expected allow for truthy env %q", truthy)
			}
		})
	}
	for _, falsy := range []string{"", "0", "false", "no", "off", "random"} {
		t.Run("falsy_"+falsy, func(t *testing.T) {
			t.Setenv("GENAPI_INSECURE_DEV", falsy)
			r := mkRequest("127.0.0.1:1", nil)
			if AllowInsecureDev(r, true) {
				t.Fatalf("expected deny for falsy env %q", falsy)
			}
		})
	}
}

// TestAllowInsecureDev_EmptyRemoteAddr proves that a missing RemoteAddr is not
// trusted as loopback. If the TCP peer cannot be parsed, deny.
func TestAllowInsecureDev_EmptyRemoteAddr(t *testing.T) {
	t.Setenv("GENAPI_INSECURE_DEV", "1")
	r := mkRequest("", nil)
	if AllowInsecureDev(r, true) {
		t.Fatalf("expected deny when RemoteAddr is empty")
	}
}

// TestAllowInsecureDev_MalformedRemoteAddr proves that a malformed RemoteAddr
// is not trusted as loopback.
func TestAllowInsecureDev_MalformedRemoteAddr(t *testing.T) {
	t.Setenv("GENAPI_INSECURE_DEV", "1")
	cases := []string{"garbage", "127.0.0.1", "::1", "not:an:addr"}
	for _, addr := range cases {
		t.Run(addr, func(t *testing.T) {
			r := mkRequest(addr, nil)
			if AllowInsecureDev(r, true) {
				t.Fatalf("expected deny for malformed RemoteAddr %q", addr)
			}
		})
	}
}

// TestAllowInsecureDev_NilRequest guards against nil dereferences.
func TestAllowInsecureDev_NilRequest(t *testing.T) {
	t.Setenv("GENAPI_INSECURE_DEV", "1")
	if AllowInsecureDev(nil, true) {
		t.Fatalf("expected deny for nil request")
	}
}

// TestAllowInsecureDevAtStartup verifies setup-time variant: it only
// considers debug mode + env, with no request available.
func TestAllowInsecureDevAtStartup(t *testing.T) {
	t.Run("debug+env=allow", func(t *testing.T) {
		t.Setenv("GENAPI_INSECURE_DEV", "1")
		if !AllowInsecureDevAtStartup(true) {
			t.Fatalf("expected allow: debug + env=1")
		}
	})
	t.Run("no_debug=deny", func(t *testing.T) {
		t.Setenv("GENAPI_INSECURE_DEV", "1")
		if AllowInsecureDevAtStartup(false) {
			t.Fatalf("expected deny: not in debug mode")
		}
	})
	t.Run("no_env=deny", func(t *testing.T) {
		t.Setenv("GENAPI_INSECURE_DEV", "")
		if AllowInsecureDevAtStartup(true) {
			t.Fatalf("expected deny: env is unset")
		}
	})
}
