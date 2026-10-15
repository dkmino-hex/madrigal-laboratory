package domain

import "errors"

var (
	ErrNotFound           = errors.New("resource not found")
	ErrConflict           = errors.New("idempotency key was used with a different request")
	ErrCaptureUnavailable = errors.New("capture unavailable")
)
