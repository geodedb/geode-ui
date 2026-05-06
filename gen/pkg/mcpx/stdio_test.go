package mcpx

import (
	"bufio"
	"bytes"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"io"
	"sync"
	"testing"
	"time"
)

func TestSTDIO_BackpressureAndBatch(t *testing.T) {
	// Tools registry with echo
	tools := map[string]Tool{
		"echo": func(p jsontext.Value) (jsontext.Value, error) { return p, nil },
	}

	inR, inW := io.Pipe()
	outR, outW := io.Pipe()

	// Start server loop
	var wg sync.WaitGroup
	wg.Go(func() {
		_ = serveSTDIOWith(inR, outW, tools)
	})

	// Writer goroutine: write a burst of requests to exercise backpressure
	const numRequests = 10
	go func() {
		for i := range numRequests {
			req := map[string]any{
				"jsonrpc": "2.0",
				"id":      i + 1,
				"method":  "tools/call",
				"params": map[string]any{
					"name":   "echo",
					"params": map[string]any{"msg": "hi"},
				},
			}
			_ = json.MarshalWrite(inW, req)
			_, _ = inW.Write([]byte("\n"))
			// small delay to simulate producer pace
			time.Sleep(5 * time.Millisecond)
		}
		_ = inW.Close()
	}()

	// Reader: consume responses slowly to apply backpressure
	sc := bufio.NewScanner(outR)
	count := 0
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && count < numRequests {
		if sc.Scan() {
			line := sc.Bytes()
			if !bytes.Contains(line, []byte("\"jsonrpc\":\"2.0\"")) {
				t.Fatalf("bad line: %q", string(line))
			}
			count++
			// slow consumer
			time.Sleep(10 * time.Millisecond)
		} else if err := sc.Err(); err != nil {
			break
		}
	}
	if count != numRequests {
		t.Fatalf("expected %d responses, got %d", numRequests, count)
	}
	_ = outR.Close()
	wg.Wait()
}
