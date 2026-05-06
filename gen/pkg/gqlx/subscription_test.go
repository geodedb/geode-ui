package gqlx

import (
	"context"
	"encoding/binary"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"io"
	"net"
	"sync/atomic"
	"testing"
	"time"
)

func TestSubscriptionMessageParse(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{`{"type":"connection_init"}`, "connection_init"},
		{`{"type":"subscribe","id":"1","payload":{"query":"subscription { msg }"}}`, "subscribe"},
		{`{"type":"complete","id":"1"}`, "complete"},
	}
	for _, tt := range tests {
		var msg wsMessage
		if err := json.Unmarshal([]byte(tt.input), &msg); err != nil {
			t.Fatalf("unmarshal %s: %v", tt.input, err)
		}
		if msg.Type != tt.want {
			t.Errorf("got type %q, want %q", msg.Type, tt.want)
		}
	}
}

func TestSubscriptionConnectionAck(t *testing.T) {
	ack := wsMessage{Type: "connection_ack"}
	b, err := json.Marshal(ack)
	if err != nil {
		t.Fatal(err)
	}
	if string(b) == "" {
		t.Error("empty marshal")
	}
}

func TestSubscriptionNext(t *testing.T) {
	msg := wsMessage{
		Type:    "next",
		ID:      "1",
		Payload: jsontext.Value(`{"data":{"msg":"hello"}}`),
	}
	b, err := json.Marshal(msg)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	if out["type"] != "next" {
		t.Errorf("got type %v", out["type"])
	}
}

func TestSubscriptionPayloadParse(t *testing.T) {
	raw := `{"query":"subscription { events { type data } }","variables":{"limit":10}}`
	var payload subscribePayload
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Query == "" {
		t.Error("expected non-empty query")
	}
	if payload.Variables["limit"] == nil {
		t.Error("expected limit variable")
	}
}

func TestSubscriptionHandlerCreation(t *testing.T) {
	s := NewSchema()
	s.Subscription.AddField("events", FieldDef{Type: TypeString})
	handler := NewSubscriptionHandler(s, SubscriptionOptions{MaxSubscriptions: 5})
	if handler == nil {
		t.Fatal("expected non-nil handler")
	}
}

func TestSubscriptionHandlerDefaults(t *testing.T) {
	s := NewSchema()
	handler := NewSubscriptionHandler(s, SubscriptionOptions{})
	if handler.opts.MaxSubscriptions != 10 {
		t.Errorf("expected default max subscriptions 10, got %d", handler.opts.MaxSubscriptions)
	}
}

// wsClient is a minimal WebSocket frame writer/reader for testing.
type wsClient struct {
	conn net.Conn
}

func (c *wsClient) send(msg wsMessage) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	// Write as unmasked WebSocket text frame.
	frame := make([]byte, 0, 2+len(data))
	frame = append(frame, 0x81) // FIN + text opcode
	if len(data) < 126 {
		frame = append(frame, byte(len(data)))
	} else {
		frame = append(frame, 126, byte(len(data)>>8), byte(len(data)))
	}
	frame = append(frame, data...)
	_, err = c.conn.Write(frame)
	return err
}

func (c *wsClient) recv() (wsMessage, error) {
	// Read frame header (2 bytes).
	hdr := make([]byte, 2)
	if _, err := io.ReadFull(c.conn, hdr); err != nil {
		return wsMessage{}, err
	}
	masked := hdr[1]&0x80 != 0
	length := int(hdr[1] & 0x7F)
	if length == 126 {
		ext := make([]byte, 2)
		if _, err := io.ReadFull(c.conn, ext); err != nil {
			return wsMessage{}, err
		}
		length = int(ext[0])<<8 | int(ext[1])
	}
	var maskKey []byte
	if masked {
		maskKey = make([]byte, 4)
		if _, err := io.ReadFull(c.conn, maskKey); err != nil {
			return wsMessage{}, err
		}
	}
	payload := make([]byte, length)
	if length > 0 {
		if _, err := io.ReadFull(c.conn, payload); err != nil {
			return wsMessage{}, err
		}
	}
	if masked {
		for i := range payload {
			payload[i] ^= maskKey[i%4]
		}
	}
	var msg wsMessage
	if err := json.Unmarshal(payload, &msg); err != nil {
		return wsMessage{}, err
	}
	return msg, nil
}

func TestSubscriptionHandlerFullLifecycle(t *testing.T) {
	s := NewSchema()
	s.Subscription.AddField("counter", FieldDef{
		Type: TypeInt,
		Subscribe: func(ctx context.Context, args map[string]any) (<-chan any, error) {
			ch := make(chan any, 3)
			go func() {
				defer close(ch)
				for i := 1; i <= 3; i++ {
					select {
					case ch <- map[string]any{"counter": i}:
					case <-ctx.Done():
						return
					}
				}
			}()
			return ch, nil
		},
	})

	handler := NewSubscriptionHandler(s, SubscriptionOptions{
		MaxSubscriptions: 10,
		ValidateOptions: ValidateOptions{
			MaxDepth:      10,
			MaxComplexity: 100,
			MaxAliases:    10,
		},
	})

	serverConn, clientConn := net.Pipe()
	defer func() { _ = clientConn.Close() }()

	client := &wsClient{conn: clientConn}

	// Run handler in background.
	done := make(chan struct{})
	go func() {
		defer close(done)
		handler.HandleConn(serverConn, nil)
	}()

	// Step 1: connection_init -> connection_ack
	if err := client.send(wsMessage{Type: "connection_init"}); err != nil {
		t.Fatalf("send connection_init: %v", err)
	}
	ack, err := client.recv()
	if err != nil {
		t.Fatalf("recv connection_ack: %v", err)
	}
	if ack.Type != "connection_ack" {
		t.Fatalf("expected connection_ack, got %q", ack.Type)
	}

	// Step 2: subscribe
	payload, _ := json.Marshal(subscribePayload{
		Query: `subscription { counter }`,
	})
	if err := client.send(wsMessage{
		Type:    "subscribe",
		ID:      "sub-1",
		Payload: jsontext.Value(payload),
	}); err != nil {
		t.Fatalf("send subscribe: %v", err)
	}

	// Step 3: expect 3 "next" messages.
	for i := 1; i <= 3; i++ {
		msg, err := client.recv()
		if err != nil {
			t.Fatalf("recv next #%d: %v", i, err)
		}
		if msg.Type != "next" {
			t.Fatalf("expected next, got %q", msg.Type)
		}
		if msg.ID != "sub-1" {
			t.Fatalf("expected ID sub-1, got %q", msg.ID)
		}
		// Verify payload contains counter value.
		var resp Response
		if err := json.Unmarshal(msg.Payload, &resp); err != nil {
			t.Fatalf("unmarshal next payload: %v", err)
		}
		data, ok := resp.Data.(map[string]any)
		if !ok {
			t.Fatalf("expected map data, got %T", resp.Data)
		}
		// JSON unmarshals numbers as float64.
		got, ok := data["counter"].(float64)
		if !ok {
			t.Fatalf("expected float64 counter, got %T", data["counter"])
		}
		if int(got) != i {
			t.Errorf("counter: got %d, want %d", int(got), i)
		}
	}

	// Step 4: expect "complete" when channel closes.
	complete, err := client.recv()
	if err != nil {
		t.Fatalf("recv complete: %v", err)
	}
	if complete.Type != "complete" {
		t.Fatalf("expected complete, got %q", complete.Type)
	}
	if complete.ID != "sub-1" {
		t.Fatalf("expected ID sub-1, got %q", complete.ID)
	}

	// Close the client connection to stop the handler.
	_ = clientConn.Close()
	<-done
}

func TestSubscriptionHandlerWrapsObjectPayloadUnderFieldName(t *testing.T) {
	s := NewSchema()
	s.Subscription.AddField("events", FieldDef{
		Type: TypeString,
		Subscribe: func(ctx context.Context, args map[string]any) (<-chan any, error) {
			ch := make(chan any, 1)
			go func() {
				defer close(ch)
				select {
				case ch <- map[string]any{"actor": "tester"}:
				case <-ctx.Done():
				}
			}()
			return ch, nil
		},
	})

	handler := NewSubscriptionHandler(s, SubscriptionOptions{})
	serverConn, clientConn := net.Pipe()
	defer func() { _ = clientConn.Close() }()

	client := &wsClient{conn: clientConn}
	go handler.HandleConn(serverConn, nil)

	if err := client.send(wsMessage{Type: "connection_init"}); err != nil {
		t.Fatalf("send connection_init: %v", err)
	}
	if _, err := client.recv(); err != nil {
		t.Fatalf("recv connection_ack: %v", err)
	}

	payload, _ := json.Marshal(subscribePayload{Query: `subscription { events }`})
	if err := client.send(wsMessage{
		Type:    "subscribe",
		ID:      "sub-events",
		Payload: jsontext.Value(payload),
	}); err != nil {
		t.Fatalf("send subscribe: %v", err)
	}

	msg, err := client.recv()
	if err != nil {
		t.Fatalf("recv next: %v", err)
	}
	if msg.Type != "next" {
		t.Fatalf("expected next, got %q", msg.Type)
	}
	var resp Response
	if err := json.Unmarshal(msg.Payload, &resp); err != nil {
		t.Fatalf("unmarshal next payload: %v", err)
	}
	data, ok := resp.Data.(map[string]any)
	if !ok {
		t.Fatalf("expected map data, got %T", resp.Data)
	}
	event, ok := data["events"].(map[string]any)
	if !ok {
		t.Fatalf("expected wrapped events payload, got %T", data["events"])
	}
	if event["actor"] != "tester" {
		t.Fatalf("actor: got %v, want tester", event["actor"])
	}
}

func TestSubscriptionHandlerMaxSubscriptions(t *testing.T) {
	s := NewSchema()
	s.Subscription.AddField("tick", FieldDef{
		Type: TypeInt,
		Subscribe: func(ctx context.Context, args map[string]any) (<-chan any, error) {
			ch := make(chan any)
			// Block until context is cancelled.
			go func() {
				<-ctx.Done()
				close(ch)
			}()
			return ch, nil
		},
	})

	handler := NewSubscriptionHandler(s, SubscriptionOptions{
		MaxSubscriptions: 2,
		ValidateOptions: ValidateOptions{
			MaxDepth:      10,
			MaxComplexity: 100,
			MaxAliases:    10,
		},
	})

	serverConn, clientConn := net.Pipe()
	defer func() { _ = clientConn.Close() }()

	client := &wsClient{conn: clientConn}

	done := make(chan struct{})
	go func() {
		defer close(done)
		handler.HandleConn(serverConn, nil)
	}()

	// connection_init
	if err := client.send(wsMessage{Type: "connection_init"}); err != nil {
		t.Fatalf("send connection_init: %v", err)
	}
	ack, err := client.recv()
	if err != nil {
		t.Fatalf("recv connection_ack: %v", err)
	}
	if ack.Type != "connection_ack" {
		t.Fatalf("expected connection_ack, got %q", ack.Type)
	}

	payload, _ := json.Marshal(subscribePayload{
		Query: `subscription { tick }`,
	})

	// Subscribe #1 (OK).
	if err := client.send(wsMessage{
		Type:    "subscribe",
		ID:      "s1",
		Payload: jsontext.Value(payload),
	}); err != nil {
		t.Fatalf("send subscribe s1: %v", err)
	}

	// Subscribe #2 (OK).
	if err := client.send(wsMessage{
		Type:    "subscribe",
		ID:      "s2",
		Payload: jsontext.Value(payload),
	}); err != nil {
		t.Fatalf("send subscribe s2: %v", err)
	}

	// Small delay to let the handler process the first two subscriptions.
	time.Sleep(50 * time.Millisecond)

	// Subscribe #3 (should get error).
	if err := client.send(wsMessage{
		Type:    "subscribe",
		ID:      "s3",
		Payload: jsontext.Value(payload),
	}); err != nil {
		t.Fatalf("send subscribe s3: %v", err)
	}

	errMsg, err := client.recv()
	if err != nil {
		t.Fatalf("recv error for s3: %v", err)
	}
	if errMsg.Type != "error" {
		t.Fatalf("expected error, got %q", errMsg.Type)
	}
	if errMsg.ID != "s3" {
		t.Fatalf("expected ID s3, got %q", errMsg.ID)
	}

	// Clean up.
	_ = clientConn.Close()
	<-done
}

func TestReadWSFrameRejectsOversizedLength(t *testing.T) {
	serverConn, clientConn := net.Pipe()
	defer func() { _ = serverConn.Close() }()
	defer func() { _ = clientConn.Close() }()

	done := make(chan error, 1)
	go func() {
		_, err := readWSFrame(serverConn)
		done <- err
	}()

	// FIN+text, length=127 (extended 64-bit length)
	frame := make([]byte, 10)
	frame[0] = 0x81
	frame[1] = 127
	binary.BigEndian.PutUint64(frame[2:], uint64(maxWSFrameBytes+1))
	if _, err := clientConn.Write(frame); err != nil {
		t.Fatalf("write frame: %v", err)
	}

	select {
	case err := <-done:
		if !errors.Is(err, errWSFrameTooLarge) {
			t.Fatalf("expected errWSFrameTooLarge, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for oversized frame rejection")
	}
}

func TestSubscriptionHandlerClientComplete(t *testing.T) {
	var cancelled atomic.Bool

	s := NewSchema()
	s.Subscription.AddField("watch", FieldDef{
		Type: TypeString,
		Subscribe: func(ctx context.Context, args map[string]any) (<-chan any, error) {
			ch := make(chan any)
			go func() {
				<-ctx.Done()
				cancelled.Store(true)
				close(ch)
			}()
			return ch, nil
		},
	})

	handler := NewSubscriptionHandler(s, SubscriptionOptions{
		MaxSubscriptions: 10,
		ValidateOptions: ValidateOptions{
			MaxDepth:      10,
			MaxComplexity: 100,
			MaxAliases:    10,
		},
	})

	serverConn, clientConn := net.Pipe()
	defer func() { _ = clientConn.Close() }()

	client := &wsClient{conn: clientConn}

	done := make(chan struct{})
	go func() {
		defer close(done)
		handler.HandleConn(serverConn, nil)
	}()

	// connection_init
	if err := client.send(wsMessage{Type: "connection_init"}); err != nil {
		t.Fatalf("send connection_init: %v", err)
	}
	ack, err := client.recv()
	if err != nil {
		t.Fatalf("recv connection_ack: %v", err)
	}
	if ack.Type != "connection_ack" {
		t.Fatalf("expected connection_ack, got %q", ack.Type)
	}

	// Subscribe.
	payload, _ := json.Marshal(subscribePayload{
		Query: `subscription { watch }`,
	})
	if err := client.send(wsMessage{
		Type:    "subscribe",
		ID:      "w1",
		Payload: jsontext.Value(payload),
	}); err != nil {
		t.Fatalf("send subscribe: %v", err)
	}

	// Let the subscription start.
	time.Sleep(50 * time.Millisecond)

	// Send complete.
	if err := client.send(wsMessage{
		Type: "complete",
		ID:   "w1",
	}); err != nil {
		t.Fatalf("send complete: %v", err)
	}

	// Wait for the context cancellation to propagate.
	deadline := time.After(2 * time.Second)
	for !cancelled.Load() {
		select {
		case <-deadline:
			t.Fatal("timed out waiting for subscription context cancellation")
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}

	if !cancelled.Load() {
		t.Error("subscription context was not cancelled")
	}

	// Clean up.
	_ = clientConn.Close()
	<-done
}
