//go:build fuzz

package wsx

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"testing"
)

// FuzzWSFrame exercises readFrame with random but structured inputs.
func FuzzWSFrame(f *testing.F) {
	// Seed: valid small text, oversized length, invalid opcode, unmasked, ping
	{
		b := &bytes.Buffer{}
		bw := bufio.NewWriter(b)
		bw.WriteByte(0x81)
		bw.WriteByte(0x80 | 5)
		bw.Write([]byte{1, 2, 3, 4})
		for i := 0; i < 5; i++ {
			bw.WriteByte(byte('a') ^ byte([]byte{1, 2, 3, 4}[i%4]))
		}
		bw.Flush()
		f.Add(b.Bytes())
	}
	{
		b := &bytes.Buffer{}
		bw := bufio.NewWriter(b)
		bw.WriteByte(0x81)
		bw.WriteByte(0x80 | 126)
		bw.WriteByte(0xFF)
		bw.WriteByte(0xFF)
		bw.Write([]byte{1, 2, 3, 4})
		bw.Flush()
		f.Add(b.Bytes())
	}
	{
		b := &bytes.Buffer{}
		bw := bufio.NewWriter(b)
		bw.WriteByte(0x8F) // invalid opcode
		bw.WriteByte(0x80)
		bw.Write([]byte{1, 2, 3, 4})
		bw.Flush()
		f.Add(b.Bytes())
	}
	seed := make([]byte, 64)
	rand.Read(seed)
	f.Add(seed)
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) < 4 {
			return
		}
		br := bufio.NewReader(bytes.NewReader(data))
		_, _, _, _ = readFrame(br, make([]byte, 1024), 1024, true, false)
	})
}
