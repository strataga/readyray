# API foundation

Requires Node.js 24 and Bun 1.4. Copy `.env.example` to `.env`, set a random
URL-safe local `POSTGRES_PASSWORD` and matching `DATABASE_URL`, load the values
into the current shell, then run:

```sh
cp .env.example .env
set -a
. ./.env
set +a
docker compose up -d db
bun install
bun --cwd apps/api run db:migrate
bun run dev:api
```

The versioned API is under `/v1`; liveness and readiness are `/v1/health/live`
and `/v1/health/ready`. OpenAPI JSON and its UI are at `/openapi.json` and
`/docs`. Register with `POST /v1/users`, create a bearer session with
`POST /v1/sessions`, create a workspace with `POST /v1/workspaces`, and list
only the current user's workspaces with authenticated `GET /v1/workspaces`.

Passwords use Node's scrypt and are never stored in plaintext. Sessions use
opaque bearer tokens stored only as SHA-256 digests, with a fixed 30-day expiry.
This foundation does not include email verification, password reset, session
revocation, distributed trace export, or production secret management. Login
requests are limited to 10 per source and 10 per normalized account email in a
15-minute window. Both maps store only process-keyed HMACs and are process-local,
so limits reset on restart and are not shared across API instances. If account
tracking reaches its 10,000-key cap, existing account limits remain enforced
and new account keys are temporarily untracked; the source limit still applies.
If the 10,000-key source map is full, new sources are rejected with 429 and a
bounded `Retry-After` until capacity can be reclaimed.
