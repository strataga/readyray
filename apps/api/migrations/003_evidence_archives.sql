CREATE TABLE evidence_archives (
  intake_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  archive_sha256 char(64) NOT NULL CHECK (archive_sha256 ~ '^[0-9a-f]{64}$'),
  archive_bytes bytea NOT NULL CHECK (octet_length(archive_bytes) BETWEEN 1 AND 52428800),
  accepted_metadata jsonb NOT NULL CHECK ((
    CASE
      WHEN jsonb_typeof(accepted_metadata) IS DISTINCT FROM 'object' THEN false
      ELSE accepted_metadata ->> 'status' = 'accepted'
        AND accepted_metadata ->> 'intakeId' = intake_id::text
        AND accepted_metadata ->> 'workspaceId' = workspace_id::text
        AND jsonb_typeof(accepted_metadata -> 'intake') = 'object'
        AND accepted_metadata -> 'intake' ->> 'status' = 'accepted'
        AND accepted_metadata -> 'intake' ->> 'id' = intake_id::text
        AND accepted_metadata -> 'intake' ->> 'createdAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
        AND accepted_metadata -> 'intake' ->> 'updatedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    END
  ) IS TRUE),
  manifest jsonb NOT NULL CHECK ((
    CASE
      WHEN jsonb_typeof(manifest) IS DISTINCT FROM 'object' THEN false
      WHEN jsonb_typeof(manifest -> 'entries') IS DISTINCT FROM 'array' THEN false
      WHEN jsonb_typeof(manifest -> 'totalBytes') IS DISTINCT FROM 'number' THEN false
      ELSE jsonb_array_length(manifest -> 'entries') BETWEEN 0 AND 5000
        AND (manifest ->> 'totalBytes')::numeric BETWEEN 0 AND 262144000
    END
  ) IS TRUE),
  digests jsonb NOT NULL CHECK ((
    CASE
      WHEN jsonb_typeof(digests) IS DISTINCT FROM 'array' THEN false
      ELSE jsonb_array_length(digests) BETWEEN 0 AND 5000
    END
  ) IS TRUE),
  accepted_at timestamptz NOT NULL,
  CHECK ((
    CASE
      WHEN jsonb_typeof(manifest -> 'entries') IS DISTINCT FROM 'array' THEN false
      WHEN jsonb_typeof(digests) IS DISTINCT FROM 'array' THEN false
      ELSE jsonb_array_length(manifest -> 'entries') = jsonb_array_length(digests)
    END
  ) IS TRUE)
);

CREATE INDEX evidence_archives_by_workspace ON evidence_archives (workspace_id, accepted_at, intake_id);
