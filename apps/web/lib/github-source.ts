export interface GithubRepositoryRef {
  readonly owner: string;
  readonly repository: string;
}

/** Accept only an origin-only public github.com repository URL. */
export function parseGithubRepositoryUrl(input: unknown): GithubRepositoryRef | undefined {
  if (typeof input !== 'string' || input.length > 300) {
    return undefined;
  }
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash) {
      return undefined;
    }
    const [owner, rawRepository, ...extra] = url.pathname.split('/').filter(Boolean);
    if (extra.length > 0 || !owner || !rawRepository ||
      !/^[A-Za-z0-9_.-]{1,100}$/u.test(owner) || !/^[A-Za-z0-9_.-]{1,104}$/u.test(rawRepository)) {
      return undefined;
    }
    const repository = rawRepository.replace(/\.git$/iu, '');
    return repository ? { owner, repository } : undefined;
  } catch {
    return undefined;
  }
}

export function isGithubCommitSha(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{40}$/iu.test(value);
}
