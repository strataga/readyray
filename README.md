# ArchGauge

ArchGauge is an open-source architecture and production-readiness review platform for turning bounded repository evidence into cited findings, reproducible scores, explicit risks, and human-approved reports.

> Status: early implementation. The API and evidence domain foundations are being built; no end-to-end architecture review capability exists yet. Do not use this repository as evidence that ArchGauge is production-ready or deployable.

## Product principles

- Evidence before claims
- Deterministic checks before model-assisted review
- AI proposes; deterministic code scores; humans publish
- Safe, bounded ingestion that never executes submitted code
- One Apache-2.0 source and release stream for self-hosted and hosted use
- Production behavior needs tests, observability, recovery, and release proof

See [the PRD](docs/PRD.md), [architecture overview](docs/architecture/overview.md), [evidence ingestion status](docs/evidence-ingestion.md), [roadmap](docs/roadmap.md), and [quality scorecard](docs/quality-scorecard.md).

## Development

ArchGauge uses Bun for workspace commands and Node.js 24 LTS in production. PostgreSQL 18 is available locally through Docker Compose. Its credentials are for development only; do not reuse them outside a local workstation.

Create a local `.env` file (it is ignored by Git) and replace the example password with a long random alphanumeric value. Keep `DATABASE_URL`'s password and port in sync:

```bash
cp .env.example .env
# Edit .env and replace the POSTGRES_PASSWORD placeholder.
```

Load those values into the current shell and expose standard PostgreSQL client variables plus the API's `DATABASE_URL`:

```bash
set -a
. ./.env
set +a
export PGHOST=127.0.0.1
export PGPORT="$POSTGRES_PORT"
export PGDATABASE="$POSTGRES_DB"
export PGUSER="$POSTGRES_USER"
export PGPASSWORD="$POSTGRES_PASSWORD"
```

Start the local database and check its health:

```bash
docker compose up -d db
docker compose ps
docker compose exec db pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

Stop it while retaining the database container and data:

```bash
docker compose stop db
```

To remove the stopped container and Compose network while keeping the named database volume:

```bash
docker compose down
```

The database is published only on `127.0.0.1`. Its named volume persists across container restarts and `docker compose down`.

Install workspace dependencies, apply the database migrations, and start the API:

```bash
bun install
bun run --cwd apps/api db:migrate
bun run dev:api
```

Run the current code checks and focused tests:

```bash
bun run lint
bun run typecheck
bun run build
bun run test
bun run test:coverage
```

```bash
git diff --check # unstaged changes
git diff --cached --check # staged changes
git diff --check origin/main...HEAD # committed branch changes
actionlint
shellcheck .githooks/pre-commit
```

Install the local hook once:

```bash
git config core.hooksPath .githooks
```

The seed commit is the only direct-to-`main` exception. Every later change uses a signed branch commit and pull request. Releases use Semantic Versioning and human-readable release notes. The public source is [github.com/strataga/archgauge](https://github.com/strataga/archgauge); no deployed service exists yet.

## Security

Do not report vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md). ArchGauge is not a certification, compliance opinion, or substitute for professional judgment.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
