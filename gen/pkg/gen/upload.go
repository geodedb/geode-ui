package gen

import "io"

// FileUpload represents a parsed multipart file upload.
type FileUpload struct {
	Filename    string
	Size        int64
	ContentType string
	Reader      io.Reader
}
