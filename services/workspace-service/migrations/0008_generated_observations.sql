ALTER TABLE observations ADD COLUMN generation_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(generation_json));
