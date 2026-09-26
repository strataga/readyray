import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import type { ExecutionContext } from "@nestjs/common";
import { CreateSession } from "../dist/modules/identity/application/create-session.use-case.js";
import { IdentityUseCaseError } from "../dist/modules/identity/application/identity-errors.js";
import { ResolveSession } from "../dist/modules/identity/application/resolve-session.use-case.js";
import { RevokeSession } from "../dist/modules/identity/application/revoke-session.use-case.js";
import type { PasswordHasher, SessionTokens } from "../dist/modules/identity/application/security.port.js";
import type { SessionRepository } from "../dist/modules/identity/application/session-repository.port.js";
import type { UserRepository } from "../dist/modules/identity/application/user-repository.port.js";
import type { User, UserId } from "../dist/modules/identity/domain/user.js";
import { SessionGuard } from "../dist/http/session.guard.js";
import { NodeSessionTokens, ScryptPasswordHasher } from "../dist/security/node-crypto.adapter.js";

describe("NodeSessionTokens", () => {
  test("issues an opaque URL-safe token and exposes only its SHA-256 digest for storage", () => {
    const tokens = new NodeSessionTokens();
    const issued = tokens.issue();

    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(issued.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(issued.digest).not.toBe(issued.token);
    expect(tokens.digest(issued.token)).toBe(issued.digest);
  });
});

describe("CreateSession", () => {
  test("normalizes account lookup, verifies password, and stores only the token digest", async () => {
    const users = new SessionUsers();
    const user = { id: "user-1" as UserId, email: "architect@example.test", createdAt: new Date() };
    users.user = { ...user, passwordHash: "hash:correct-password" };
    const sessions = new MemorySessions();
    const passwords = new RecordingPasswords();
    const tokens = new FixedTokens();
    const createSession = new CreateSession(users, sessions, passwords, tokens);
    const before = Date.now();

    const result = await createSession.execute("  ARCHITECT@EXAMPLE.TEST ", "correct-password");

    expect(users.lookups).toEqual(["architect@example.test"]);
    expect(passwords.verified).toEqual([{
      password: "correct-password",
      encodedHash: "hash:correct-password",
    }]);
    expect(passwords.dummyVerifications).toBe(0);
    expect(result.token).toBe("visible-token-for-client");
    expect(sessions.created).toHaveLength(1);
    expect(sessions.created[0]).toEqual({
      userId: user.id,
      digest: "stored-token-digest",
      expiresAt: result.expiresAt,
    });
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 30 * 24 * 60 * 60 * 1000);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * 24 * 60 * 60 * 1000);
  });

  test("performs dummy password verification when the account does not exist", async () => {
    const users = new SessionUsers();
    const passwords = new RecordingPasswords();
    const sessions = new MemorySessions();
    const createSession = new CreateSession(users, sessions, passwords, new FixedTokens());

    await expectIdentityError(
      () => createSession.execute("unknown@example.test", "candidate-password"),
      "invalid_credentials",
    );

    expect(passwords.dummyVerifications).toBe(1);
    expect(passwords.verified).toHaveLength(0);
    expect(sessions.created).toHaveLength(0);
  });

  test("uses the same invalid-credentials result for an existing account with a wrong password", async () => {
    const users = new SessionUsers();
    users.user = {
      id: "user-1" as UserId,
      email: "architect@example.test",
      passwordHash: "expected-hash",
      createdAt: new Date(),
    };
    const passwords = new RecordingPasswords();
    const sessions = new MemorySessions();
    const createSession = new CreateSession(users, sessions, passwords, new FixedTokens());

    await expectIdentityError(
      () => createSession.execute("architect@example.test", "wrong-password"),
      "invalid_credentials",
    );

    expect(passwords.dummyVerifications).toBe(0);
    expect(sessions.created).toHaveLength(0);
  });
});

describe("ResolveSession", () => {
  test("hashes the presented token before repository lookup and returns the active user", async () => {
    const sessions = new MemorySessions();
    const tokens = new FixedTokens();
    const resolver = new ResolveSession(sessions, tokens);

    await expect(resolver.execute("visible-token-for-client")).resolves.toBe("user-1");

    expect(tokens.digested).toEqual(["visible-token-for-client"]);
    expect(sessions.lookups).toHaveLength(1);
    expect(sessions.lookups[0]?.digest).toBe("stored-token-digest");
    expect(sessions.lookups[0]?.at).toBeInstanceOf(Date);
  });

  test("returns no user for absent or expired repository sessions", async () => {
    const sessions = new MemorySessions();
    sessions.expired = true;
    const resolver = new ResolveSession(sessions, new FixedTokens());

    await expect(resolver.execute("expired-token")).resolves.toBeUndefined();
  });
});

describe("RevokeSession", () => {
  test("digests the raw token before revoking its stored session", async () => {
    const sessions = new MemorySessions();
    const tokens = new FixedTokens();
    const revoke = new RevokeSession(sessions, tokens);

    await revoke.execute("visible-token-for-client");

    expect(tokens.digested).toEqual(["visible-token-for-client"]);
    expect(sessions.revoked).toEqual(["stored-token-digest"]);
  });
});

describe("SessionGuard", () => {
  test.each([
    undefined,
    "token",
    "bearer " + "a".repeat(43),
    "Bearer " + "a".repeat(42),
    "Bearer " + "a".repeat(44),
    "Bearer " + "a".repeat(42) + "!",
    "Bearer  " + "a".repeat(43),
  ])("rejects malformed authorization credentials %p before session lookup", async (authorization) => {
    const resolver = new GuardResolver();
    const guard = new SessionGuard(resolver as never);
    const request = requestWithAuthorization(authorization);

    await expectGuardError(() => guard.canActivate(contextFor(request)), "unauthorized");

    expect(resolver.tokens).toHaveLength(0);
    expect(request.userId).toBeUndefined();
  });

  test("sets the authenticated user only when a syntactically valid token resolves", async () => {
    const resolver = new GuardResolver();
    const guard = new SessionGuard(resolver as never);
    const request = requestWithAuthorization(`Bearer ${"a".repeat(43)}`);

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(resolver.tokens).toEqual(["a".repeat(43)]);
    expect(request.userId).toBe("user-1");
  });

  test("does not attach identity when a syntactically valid token is expired or unknown", async () => {
    const resolver = new GuardResolver();
    resolver.result = undefined;
    const guard = new SessionGuard(resolver as never);
    const request = requestWithAuthorization(`Bearer ${"b".repeat(43)}`);

    await expectGuardError(() => guard.canActivate(contextFor(request)), "unauthorized");
    expect(request.userId).toBeUndefined();
  });
});

describe("ScryptPasswordHasher malformed stored hashes", () => {
  test("returns false for malformed algorithm and truncated digest records", async () => {
    const hasher = new ScryptPasswordHasher();

    await expect(hasher.verify("candidate", "bcrypt$16384$8$1$00$00")).resolves.toBe(false);
    await expect(hasher.verify("candidate", `scrypt$16384$8$1$${"a".repeat(32)}$${"b".repeat(127)}`)).resolves.toBe(false);
  });

  test("accepts its encoded scrypt output and rejects a wrong password", async () => {
    const hasher = new ScryptPasswordHasher();
    const encoded = await hasher.hash("correct-password");

    await expect(hasher.verify("correct-password", encoded)).resolves.toBe(true);
    await expect(hasher.verify("wrong-password", encoded)).resolves.toBe(false);
  });
});

class SessionUsers implements UserRepository {
  user?: User & { readonly passwordHash: string };
  readonly lookups: string[] = [];

  async create(): Promise<User> {
    throw new Error("unexpected create");
  }

  async findByEmail(email: string): Promise<(User & { readonly passwordHash: string }) | undefined> {
    this.lookups.push(email);
    return this.user;
  }

  async findById(): Promise<User | undefined> {
    return this.user;
  }
}

class MemorySessions implements SessionRepository {
  readonly created: Array<{ userId: UserId; digest: string; expiresAt: Date }> = [];
  readonly lookups: Array<{ digest: string; at: Date }> = [];
  expired = false;

  async create(userId: UserId, tokenDigest: string, expiresAt: Date): Promise<void> {
    this.created.push({ userId, digest: tokenDigest, expiresAt });
  }

  async findActiveUser(tokenDigest: string, at: Date): Promise<UserId | undefined> {
    this.lookups.push({ digest: tokenDigest, at });
    return this.expired || at.getTime() >= Date.now() + 60_000 ? undefined : "user-1" as UserId;
  }

  async revoke(tokenDigest: string): Promise<void> {
    this.revoked.push(tokenDigest);
  }
  readonly revoked: string[] = [];
}

class RecordingPasswords implements PasswordHasher {
  readonly verified: Array<{ password: string; encodedHash: string }> = [];
  dummyVerifications = 0;

  async hash(password: string): Promise<string> {
    return `hash:${password}`;
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    this.verified.push({ password, encodedHash });
    return encodedHash === `hash:${password}`;
  }

  async verifyDummy(): Promise<void> {
    this.dummyVerifications += 1;
  }
}

class FixedTokens implements SessionTokens {
  readonly digested: string[] = [];

  issue() {
    return { token: "visible-token-for-client", digest: "stored-token-digest" };
  }

  digest(token: string): string {
    this.digested.push(token);
    return "stored-token-digest";
  }
}

class GuardResolver {
  readonly tokens: string[] = [];
  result: UserId | undefined = "user-1" as UserId;

  async execute(token: string): Promise<UserId | undefined> {
    this.tokens.push(token);
    return this.result;
  }
}

function requestWithAuthorization(authorization: string | undefined): RequestLike {
  return {
    userId: undefined,
    header(name: string): string | undefined {
      return name.toLowerCase() === "authorization" ? authorization : undefined;
    },
  };
}

interface RequestLike {
  userId?: string;
  header(name: string): string | undefined;
}

function contextFor(request: RequestLike): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

async function expectIdentityError(
  action: () => Promise<unknown>,
  expectedCode: IdentityUseCaseError["code"],
): Promise<void> {
  let thrown: unknown;
  try {
    await action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(IdentityUseCaseError);
  expect((thrown as IdentityUseCaseError).code).toBe(expectedCode);
}

async function expectGuardError(action: () => Promise<unknown>, expectedCode: string): Promise<void> {
  await expectIdentityError(action, expectedCode as IdentityUseCaseError["code"]);
}
