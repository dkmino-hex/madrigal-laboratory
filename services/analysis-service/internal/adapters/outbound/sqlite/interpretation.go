package storage

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
)

type InterpretationRepository struct {
	db *sql.DB
}

func NewInterpretationRepository(db *sql.DB) *InterpretationRepository {
	return &InterpretationRepository{db: db}
}

func (r *InterpretationRepository) Create(ctx context.Context, interpretation *domain.Interpretation) error {
	const query = `

		INSERT INTO interpretations (id, project_id, name, description)
		VALUES (?, ?, ?, ?)
	`
	_, err := r.db.ExecContext(
		ctx,
		query,
		interpretation.ID,
		interpretation.ProjectID,
		interpretation.Name,
		interpretation.Description,
	)
	if err != nil {
		return fmt.Errorf("create interpretation: %w", err)
	}
	return nil
}

func (r *InterpretationRepository) GetByID(ctx context.Context, projectID string, id string) (*domain.Interpretation, error) {
	const query = `

		SELECT id, project_id, name, description, created_at
		FROM interpretations
		WHERE id = ? AND project_id = ?
	`
	var interpretation domain.Interpretation
	var createdAt string
	err := r.db.QueryRowContext(
		ctx,
		query,
		id,
		projectID,
	).Scan(
		&interpretation.ID,
		&interpretation.ProjectID,
		&interpretation.Name,
		&interpretation.Description,
		&createdAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get interpretation by id: %w", err)
	}
	interpretation.CreatedAt, err = time.Parse(
		"2006-01-02 15:04:05",
		createdAt,
	)
	if err != nil {
		return nil, fmt.Errorf("parse interpretation created_at: %w", err)
	}
	return &interpretation, nil
}

func (r *InterpretationRepository) CreateWithRevision(ctx context.Context, interpretation *domain.Interpretation, revision *domain.Revision) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}

	defer tx.Rollback()

	const interpretationQuery = `
		INSERT INTO interpretations (id, project_id, name, description)
		VALUES (?, ?, ?, ?)
	`

	_, err = tx.ExecContext(
		ctx,
		interpretationQuery,
		interpretation.ID,
		interpretation.ProjectID,
		interpretation.Name,
		interpretation.Description,
	)
	if err != nil {
		return fmt.Errorf("insert interpretation: %w", err)
	}

	const revisionQuery = `
		INSERT INTO revisions (id, interpretation_id, version, schema_json)
		VALUES (?, ?, ?, ?)
	`

	_, err = tx.ExecContext(
		ctx,
		revisionQuery,
		revision.ID,
		interpretation.ID,
		revision.Version,
		revision.SchemaJSON,
	)
	if err != nil {
		return fmt.Errorf("insert revision: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}

	var interpretationCreated, revisionCreated string
	if err := r.db.QueryRowContext(ctx, `SELECT created_at FROM interpretations WHERE id = ?`, interpretation.ID).Scan(&interpretationCreated); err != nil {
		return fmt.Errorf("read interpretation timestamp: %w", err)
	}
	if err := r.db.QueryRowContext(ctx, `SELECT created_at FROM revisions WHERE id = ?`, revision.ID).Scan(&revisionCreated); err != nil {
		return fmt.Errorf("read revision timestamp: %w", err)
	}
	interpretation.CreatedAt, err = parseSQLiteTime(interpretationCreated)
	if err != nil {
		return err
	}
	revision.CreatedAt, err = parseSQLiteTime(revisionCreated)
	if err != nil {
		return err
	}
	return nil
}

func (r *InterpretationRepository) ListByProject(ctx context.Context, projectID string) ([]domain.Interpretation, error) {
	rows, err := r.db.QueryContext(
		ctx,
		`SELECT id, project_id, name, description, created_at
		FROM interpretations
		WHERE project_id = ?
		ORDER BY created_at DESC, id DESC`,
		projectID,
	)
	if err != nil {
		return nil, fmt.Errorf("list interpretations: %w", err)
	}
	defer rows.Close()

	interpretations := make([]domain.Interpretation, 0)

	for rows.Next() {
		var interpretation domain.Interpretation
		var createdAt string

		err := rows.Scan(
			&interpretation.ID,
			&interpretation.ProjectID,
			&interpretation.Name,
			&interpretation.Description,
			&createdAt,
		)
		if err != nil {
			return nil, fmt.Errorf("scan interpretation: %w", err)
		}

		interpretation.CreatedAt, err = time.Parse(
			"2006-01-02 15:04:05",
			createdAt,
		)
		if err != nil {
			return nil, fmt.Errorf("parse created_at: %w", err)
		}

		interpretations = append(interpretations, interpretation)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate interpretations: %w", err)
	}

	return interpretations, nil
}
