ALTER TABLE imports ADD COLUMN result_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(result_json));
