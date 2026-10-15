package storage

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
)

func requestHash(input any) (string, error) {
	body, err := json.Marshal(input)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(body)
	return hex.EncodeToString(hash[:]), nil
}

func replay(ctx context.Context, tx *sql.Tx, scope, key, hash string, out any) (bool, error) {
	if key == "" {
		return false, nil
	}
	var oldHash, response string
	err := tx.QueryRowContext(ctx, `SELECT request_sha256,response_json FROM analysis_idempotency WHERE scope=? AND key=?`, scope, key).Scan(&oldHash, &response)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if hash != oldHash {
		return false, domain.ErrConflict
	}
	return true, json.Unmarshal([]byte(response), out)
}

func remember(ctx context.Context, tx *sql.Tx, scope, key, hash string, response any) error {
	if key == "" {
		return nil
	}
	body, err := json.Marshal(response)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO analysis_idempotency(scope,key,request_sha256,response_json) VALUES(?,?,?,?)`, scope, key, hash, string(body))
	return err
}

func optionalKey(keys []string) string {
	if len(keys) > 0 {
		return keys[0]
	}
	return ""
}
