package migrations

import "embed"

// Files contains the immutable migration history owned by this service.
//
//go:embed *.sql
var Files embed.FS
