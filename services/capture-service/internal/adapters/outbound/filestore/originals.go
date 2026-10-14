package originals

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"

	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/domain"
)

const MaxSize = domain.MaxCaptureSize

var ErrFormat = domain.ErrFormat
var ErrTooLarge = domain.ErrTooLarge
var pathPattern = regexp.MustCompile(`^objects/[0-9a-f]{2}/[0-9a-f]{64}$`)

type Store struct{ Root string }
type Object = domain.Original
type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}

func New(root string) (*Store, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Join(root, "staging"), 0700); err != nil {
		return nil, err
	}
	return &Store{Root: root}, nil
}

func (s *Store) Put(ctx context.Context, input io.Reader) (Object, error) {
	file, err := os.CreateTemp(filepath.Join(s.Root, "staging"), "capture-*")
	if err != nil {
		return Object{}, err
	}
	defer func() { file.Close(); os.Remove(file.Name()) }()
	hash := sha256.New()
	size, err := io.Copy(io.MultiWriter(file, hash), io.LimitReader(contextReader{ctx: ctx, reader: input}, MaxSize+1))
	if err != nil {
		return Object{}, err
	}
	if size > MaxSize {
		return Object{}, ErrTooLarge
	}
	var magic [4]byte
	if _, err = file.ReadAt(magic[:], 0); err != nil {
		return Object{}, ErrFormat
	}
	format, err := domain.DetectFormat(magic[:])
	if err != nil {
		return Object{}, err
	}
	if err = file.Sync(); err != nil {
		return Object{}, err
	}
	if err = file.Close(); err != nil {
		return Object{}, err
	}
	digest := hex.EncodeToString(hash.Sum(nil))
	obj := Object{SHA256: digest, RelativePath: "objects/" + digest[:2] + "/" + digest, Size: size, Format: format}
	target := filepath.Join(s.Root, filepath.FromSlash(obj.RelativePath))
	if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
		return Object{}, err
	}
	if err = os.Link(file.Name(), target); err != nil {
		if !errors.Is(err, os.ErrExist) {
			return Object{}, err
		}
		if err = s.Verify(ctx, obj); err != nil {
			return Object{}, err
		}
	}
	return obj, nil
}

func (s *Store) Open(obj Object) (*os.File, error) {
	if !pathPattern.MatchString(obj.RelativePath) || len(obj.SHA256) != 64 || obj.RelativePath != "objects/"+obj.SHA256[:2]+"/"+obj.SHA256 {
		return nil, errors.New("invalid original reference")
	}
	path := filepath.Join(s.Root, filepath.FromSlash(obj.RelativePath))
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("original is not a regular file")
	}
	return os.Open(path)
}

func (s *Store) Verify(ctx context.Context, obj Object) error {
	file, err := s.Open(obj)
	if err != nil {
		return err
	}
	defer file.Close()
	hash := sha256.New()
	size, err := io.Copy(hash, contextReader{ctx: ctx, reader: file})
	if err != nil {
		return err
	}
	if size != obj.Size || hex.EncodeToString(hash.Sum(nil)) != obj.SHA256 {
		return errors.New("original integrity check failed")
	}
	return nil
}
