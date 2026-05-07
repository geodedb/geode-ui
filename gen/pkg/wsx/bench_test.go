package wsx

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"net"
	"testing"
)

// writeMaskedFrame writes a single masked text frame to the writer (client-style frame).
func writeMaskedFrame(bw *bufio.Writer, op byte, payload []byte) error {
	if err := bw.WriteByte(0x80 | (op & 0x0F)); err != nil { // FIN + opcode
		return err
	}
	ln := len(payload)
	switch {
	case ln < 126:
		if err := bw.WriteByte(0x80 | byte(ln)); err != nil { // mask bit + length
			return err
		}
	case ln <= 0xFFFF:
		if err := bw.WriteByte(0x80 | 126); err != nil { // mask bit + 126
			return err
		}
		if err := bw.WriteByte(byte(ln >> 8)); err != nil {
			return err
		}
		if err := bw.WriteByte(byte(ln)); err != nil {
			return err
		}
	default:
		return ErrFrameTooLarge
	}
	// Use zero mask so payload is unchanged but still considered masked per RFC.
	mask := [4]byte{0, 0, 0, 0}
	if _, err := bw.Write(mask[:]); err != nil {
		return err
	}
	if ln > 0 {
		if _, err := bw.Write(payload); err != nil {
			return err
		}
	}
	return bw.Flush()
}

// BenchmarkWSRoundTrip measures frame encode/decode through the in-repo parser without deadlock.
func BenchmarkWSRoundTrip(b *testing.B) {
	payload := make([]byte, 1024)
	_, _ = rand.Read(payload)
	cClient, cServer := net.Pipe()
	defer func() { _ = cClient.Close() }()
	defer func() { _ = cServer.Close() }()
	bwClient := bufio.NewWriter(cClient) // client writes masked frames
	brServer := bufio.NewReader(cServer) // server reads masked frames
	scratch := make([]byte, 2048)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// Write in parallel so net.Pipe doesn't block.
		done := make(chan error, 1)
		go func() { done <- writeMaskedFrame(bwClient, 0x1, payload) }()
		fin, op, pl, err := readFrame(brServer, scratch, len(scratch), true, false)
		if err != nil || !fin || op != 0x1 {
			b.Fatalf("bad frame: fin=%v op=%x err=%v", fin, op, err)
		}
		if !bytes.Equal(pl, payload) {
			b.Fatal("payload mismatch")
		}
		if err := <-done; err != nil {
			b.Fatal(err)
		}
	}
}
