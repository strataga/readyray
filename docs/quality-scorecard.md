# Quality Scorecard

| Area | Current | Required before first prerelease |
|---|---|---|
| Product scope | Documented: PRD and v1 boundaries exist; success evidence is pending | Current docs and PRD success evidence |
| Architecture | Partial: overview/ADR and API domain/application/adapters exist; boundary verification is pending | Code-map and boundary tests |
| Security | Partial: threat model, API controls, hostile ZIP tests, and an upload intake path that scans before persistence exist; PostgreSQL-backed end-to-end proof and full security review are pending | ASVS/API/LLM tests and review |
| Tests/coverage | Partial: 179 API/domain/archive/scanner tests pass; Bun reports 91.85% lines for loaded modules. PostgreSQL integration and full application coverage are unverified | At least 80% across application code and critical hostile paths |
| Accessibility | Not started: no UI or WCAG verification artifacts found | WCAG 2.2 AA checks |
| API contract | Partial: OpenAPI 3.1 and Postman cover identity, workspaces, health, and archive upload; focused HTTP contract tests pass, but full static/runtime parity and endpoint coverage are unverified | Complete OpenAPI 3.1 and Postman |
| Operations/recovery | Partial: liveness/readiness, PostgreSQL migration probe, request IDs, and request-completion logs exist; recovery proof is absent | Observability, backup/restore/upgrade/rollback proof |
| Supply chain | Partial: CI, CodeQL, dependency-review, secret-scanning workflows, and Dependabot config exist; SBOM/signature/attestation artifacts are absent | SBOM, signing, scanning, attestations pass |
| Release | Partial: release policy is documented; versioned release notes and immutable artifacts are absent | SemVer notes and immutable artifacts |

This scorecard records repository evidence, not aspiration. A documented policy or workflow does not establish that its PRD gate has passed.
