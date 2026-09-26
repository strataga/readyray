export class IdentityUseCaseError extends Error {
  constructor(readonly code: 'email_conflict' | 'invalid_credentials' | 'unauthorized') {
    super(code);
    this.name = 'IdentityUseCaseError';
  }
}
