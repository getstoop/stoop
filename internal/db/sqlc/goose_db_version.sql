-- goose creates and owns this table; it is listed here only so sqlc can
-- type the Diagnostics tab's schema_version read. Not a migration.
CREATE TABLE goose_db_version (
  id serial PRIMARY KEY,
  version_id bigint NOT NULL,
  is_applied boolean NOT NULL,
  tstamp timestamp DEFAULT now()
);
