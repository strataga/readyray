import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { SessionGuard } from './http/session.guard.js';
import { USER_REPOSITORY } from './modules/identity/application/user-repository.port.js';
import { SESSION_REPOSITORY } from './modules/identity/application/session-repository.port.js';
import { PASSWORD_HASHER, SESSION_TOKENS } from './modules/identity/application/security.port.js';
import { RegisterUser } from './modules/identity/application/register-user.use-case.js';
import { CreateSession } from './modules/identity/application/create-session.use-case.js';
import { ResolveSession } from './modules/identity/application/resolve-session.use-case.js';
import { RevokeSession } from './modules/identity/application/revoke-session.use-case.js';
import { IdentityController } from './modules/identity/http/identity.controller.js';
import { WORKSPACE_REPOSITORY } from './modules/workspaces/application/workspace-repository.port.js';
import { CreateWorkspace } from './modules/workspaces/application/create-workspace.use-case.js';
import { ListWorkspaces } from './modules/workspaces/application/list-workspaces.use-case.js';
import { WorkspacesController } from './modules/workspaces/http/workspaces.controller.js';
import { EvidenceArchivesController } from './modules/evidence/http/evidence-archives.controller.js';
import { EVIDENCE_ARCHIVE_STORAGE, EVIDENCE_WORKSPACE_AUTHORIZATION } from './modules/evidence/http/evidence.tokens.js';
import { WorkspaceEvidenceAuthorizationAdapter } from './modules/evidence/adapters/workspace-evidence-authorization.adapter.js';
import { POSTGRES_POOL } from './persistence/postgres/postgres.tokens.js';
import { PostgresUserRepository } from './persistence/postgres/postgres-user.repository.js';
import { PostgresSessionRepository } from './persistence/postgres/postgres-session.repository.js';
import { PostgresWorkspaceRepository } from './persistence/postgres/postgres-workspace.repository.js';
import { PostgresEvidenceArchiveStorage } from './persistence/postgres/postgres-evidence-archive.storage.js';
import { ScryptPasswordHasher, NodeSessionTokens } from './security/node-crypto.adapter.js';
import { HealthController } from './operations/health.controller.js';
import { PostgresReadinessProbe } from './operations/postgres-readiness.adapter.js';
import { READINESS_PROBE } from './operations/readiness.port.js';
import { LoginRateLimitGuard } from './http/login-rate-limit.guard.js';
import { ReviewsController } from './modules/reviews/http/reviews.controller.js';
import { REVIEW_REPOSITORY } from './modules/reviews/application/reviews.port.js';
import { PostgresReviewRepository } from './persistence/postgres/postgres-review.repository.js';

@Module({
  controllers: [HealthController, IdentityController, WorkspacesController, EvidenceArchivesController, ReviewsController],
  providers: [
    {
      provide: POSTGRES_POOL,
      useFactory: (): Pool => {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
          throw new Error('DATABASE_URL is required');
        }
        const pool = new Pool({
          connectionString,
          max: 10,
          connectionTimeoutMillis: 1_000,
          query_timeout: 2_000,
          statement_timeout: 1_500,
        });
        pool.on('error', () => {
          process.stderr.write('{"level":"error","event":"postgres_pool_idle_client_error"}\n');
        });
        return pool;
      },
    },
    { provide: USER_REPOSITORY, useClass: PostgresUserRepository },
    { provide: SESSION_REPOSITORY, useClass: PostgresSessionRepository },
    { provide: WORKSPACE_REPOSITORY, useClass: PostgresWorkspaceRepository },
    { provide: EVIDENCE_WORKSPACE_AUTHORIZATION, useClass: WorkspaceEvidenceAuthorizationAdapter },
    { provide: EVIDENCE_ARCHIVE_STORAGE, useClass: PostgresEvidenceArchiveStorage },
    { provide: REVIEW_REPOSITORY, useClass: PostgresReviewRepository },
    { provide: PASSWORD_HASHER, useClass: ScryptPasswordHasher },
    { provide: SESSION_TOKENS, useClass: NodeSessionTokens },
    { provide: READINESS_PROBE, useClass: PostgresReadinessProbe },
    RegisterUser,
    CreateSession,
    ResolveSession,
    RevokeSession,
    CreateWorkspace,
    ListWorkspaces,
    SessionGuard,
    LoginRateLimitGuard,
  ],
})
export class AppModule {}
