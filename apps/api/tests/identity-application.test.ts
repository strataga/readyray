import { describe, expect, test } from "bun:test";
import { RegisterUser } from "../dist/modules/identity/application/register-user.use-case.js";
import { IdentityUseCaseError } from "../dist/modules/identity/application/identity-errors.js";
import type { PasswordHasher } from "../dist/modules/identity/application/security.port.js";
import type { UserRepository } from "../dist/modules/identity/application/user-repository.port.js";
import { IdentityInputError } from "../dist/modules/identity/domain/user.js";
import type { User, UserId } from "../dist/modules/identity/domain/user.js";

describe("RegisterUser", () => {
  test("normalizes email and persists only a password hash", async () => {
    const users = new MemoryUsers();
    const passwords = new FakePasswords();
    const register = new RegisterUser(users, passwords);

    const user = await register.execute("  Architect@Example.Test  ", "a-long-password-1");

    expect(user.email).toBe("architect@example.test");
    expect(users.created).toEqual([{
      email: "architect@example.test",
      passwordHash: "encoded:a-long-password-1",
    }]);
    expect(users.created[0]?.passwordHash).not.toBe("a-long-password-1");
  });

  test("rejects invalid password before hashing or repository writes", async () => {
    const users = new MemoryUsers();
    const passwords = new FakePasswords();
    const register = new RegisterUser(users, passwords);

    let thrown: unknown;
    try {
      await register.execute("architect@example.test", "short");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(IdentityInputError);
    expect((thrown as IdentityInputError).code).toBe("invalid_password");

    expect(passwords.hashCalls).toBe(0);
    expect(users.created).toHaveLength(0);
  });

  test("maps a database uniqueness conflict to the stable email conflict error", async () => {
    const users = new MemoryUsers();
    users.createFailure = Object.assign(new Error("duplicate"), { code: "23505" });
    const register = new RegisterUser(users, new FakePasswords());

    await expectIdentityError(
      () => register.execute("architect@example.test", "a-long-password-1"),
      "email_conflict",
    );
  });

  test("does not relabel unrelated repository failures as email conflicts", async () => {
    const users = new MemoryUsers();
    const storageFailure = new Error("connection interrupted");
    users.createFailure = storageFailure;
    const register = new RegisterUser(users, new FakePasswords());

    await expect(register.execute("architect@example.test", "a-long-password-1")).rejects.toBe(storageFailure);
  });
});

class MemoryUsers implements UserRepository {
  readonly created: Array<{ email: string; passwordHash: string }> = [];
  readonly records = new Map<string, User & { readonly passwordHash: string }>();
  createFailure?: unknown;

  async create(email: string, passwordHash: string): Promise<User> {
    this.created.push({ email, passwordHash });
    if (this.createFailure !== undefined) {
      throw this.createFailure;
    }
    const user = { id: `user-${this.records.size + 1}` as UserId, email, passwordHash, createdAt: new Date() };
    this.records.set(email, user);
    return user;
  }

  async findByEmail(email: string): Promise<(User & { readonly passwordHash: string }) | undefined> {
    return this.records.get(email);
  }

  async findById(id: UserId): Promise<User | undefined> {
    for (const user of this.records.values()) {
      if (user.id === id) {
        return user;
      }
    }
    return undefined;
  }
}

class FakePasswords implements PasswordHasher {
  hashCalls = 0;

  async hash(password: string): Promise<string> {
    this.hashCalls += 1;
    return `encoded:${password}`;
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    return encodedHash === `encoded:${password}`;
  }

  async verifyDummy(): Promise<void> {}
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
