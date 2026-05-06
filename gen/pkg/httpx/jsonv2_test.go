package httpx

import (
	"encoding/json/v2"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestDecodeJSON_RejectsUnknownFields verifies that DecodeJSON with
// RejectUnknownMembers rejects payloads with unknown fields.
func TestDecodeJSON_RejectsUnknownFields(t *testing.T) {
	type Target struct {
		Name string `json:"name"`
	}

	input := `{"name":"alice","unknown_field":"surprise"}`
	var v Target
	err := DecodeJSON(strings.NewReader(input), &v)
	if err == nil {
		t.Fatal("expected error for unknown field, got nil")
	}
}

// TestDecodeJSON_AcceptsValidPayload verifies that DecodeJSON successfully
// decodes a valid JSON payload.
func TestDecodeJSON_AcceptsValidPayload(t *testing.T) {
	type Target struct {
		Name string `json:"name"`
		Age  int    `json:"age"`
	}

	input := `{"name":"bob","age":30}`
	var v Target
	if err := DecodeJSON(strings.NewReader(input), &v); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if v.Name != "bob" || v.Age != 30 {
		t.Errorf("got %+v, want {Name:bob Age:30}", v)
	}
}

// TestMarshalWrite_ValidJSON verifies that MarshalWrite produces valid JSON
// HTTP responses.
func TestMarshalWrite_ValidJSON(t *testing.T) {
	type Resp struct {
		Status string `json:"status"`
		Count  int    `json:"count"`
	}

	w := httptest.NewRecorder()
	w.Header().Set("Content-Type", "application/json")
	if err := json.MarshalWrite(w, &Resp{Status: "ok", Count: 42}); err != nil {
		t.Fatalf("MarshalWrite: %v", err)
	}

	body := w.Body.String()
	var got Resp
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatalf("response is not valid JSON: %v\nbody: %q", err, body)
	}
	if got.Status != "ok" || got.Count != 42 {
		t.Errorf("got %+v, want {Status:ok Count:42}", got)
	}
}
