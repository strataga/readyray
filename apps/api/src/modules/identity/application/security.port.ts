export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
export const SESSION_TOKENS = Symbol('SESSION_TOKENS');

export class PasswordHashCapacityError extends Error {
  constructor() {
    super('Password hashing capacity is temporarily exhausted.');
    this.name = 'PasswordHashCapacityError';
  }
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encodedHash: string): Promise<boolean>;
  verifyDummy(password: string): Promise<void>;
}

export interface SessionTokens {
  issue(): { readonly token: string; readonly digest: string };
  digest(token: string): string;
}
