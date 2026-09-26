CREATE TABLE reviews (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  evidence_intake_id uuid NOT NULL REFERENCES evidence_archives(intake_id),
  source_commit_sha char(40) CHECK (source_commit_sha IS NULL OR source_commit_sha ~ '^[0-9a-f]{40}$'),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'published')),
  published_at timestamptz,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  UNIQUE (workspace_id, id),
  CHECK ((status = 'draft' AND published_at IS NULL) OR (status = 'published' AND published_at IS NOT NULL))
);
CREATE INDEX reviews_workspace_created ON reviews(workspace_id, created_at, id);

CREATE TABLE review_findings (
  id uuid PRIMARY KEY,
  review_id uuid NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  classification text NOT NULL CHECK (classification IN ('fact', 'inference', 'assumption', 'insufficient_evidence')),
  title text NOT NULL,
  description text NOT NULL,
  citations jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected', 'published')),
  proposed_at timestamptz NOT NULL,
  reviewer_id uuid REFERENCES users(id),
  decided_at timestamptz,
  published_at timestamptz,
  UNIQUE (review_id, id), UNIQUE (review_id, ordinal),
  CHECK ((status = 'proposed' AND reviewer_id IS NULL AND decided_at IS NULL AND published_at IS NULL) OR
         (status IN ('approved', 'rejected') AND reviewer_id IS NOT NULL AND decided_at IS NOT NULL AND published_at IS NULL) OR
         (status = 'published' AND reviewer_id IS NOT NULL AND decided_at IS NOT NULL AND published_at IS NOT NULL))
);
CREATE INDEX review_findings_review_order ON review_findings(review_id, ordinal);
