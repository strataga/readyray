export type UserId = string & { readonly __brand: 'UserId' };

export class IdentityInputError extends Error {
  constructor(readonly code: 'invalid_email' | 'invalid_password') {
    super(code);
    this.name = 'IdentityInputError';
  }
}

export function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  if (email.length === 0 || email.length > 254) {
    throw new IdentityInputError('invalid_email');
  }
  return email;
}

export function validatePassword(password: string): void {
  const length = [...password].length;
  if (length < 12 || length > 128) {
    throw new IdentityInputError('invalid_password');
  }
}

export interface User {
  readonly id: UserId;
  readonly email: string;
  readonly createdAt: Date;
}
