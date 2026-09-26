import { describe, expect, test } from 'bun:test';
import { isGithubCommitSha, parseGithubRepositoryUrl } from '../lib/github-source.js';

describe('parseGithubRepositoryUrl', () => {
  test('accepts public repository URLs and optional .git suffixes', () => {
    expect(parseGithubRepositoryUrl('https://github.com/openai/archgauge')).toEqual({ owner: 'openai', repository: 'archgauge' });
    expect(parseGithubRepositoryUrl('https://github.com/openai/archgauge.git/')).toEqual({ owner: 'openai', repository: 'archgauge' });
  });

  test.each([
    'http://github.com/openai/archgauge',
    'https://github.com.evil.test/openai/archgauge',
    'https://user:pass@github.com/openai/archgauge',
    'https://github.com:8443/openai/archgauge',
    'https://github.com/openai/archgauge/tree/main',
    'https://github.com/openai/archgauge?token=secret',
    'https://github.com/openai/../private',
  ])('rejects unsupported or unsafe URL %s', (url) => {
    expect(parseGithubRepositoryUrl(url)).toBeUndefined();
  });
});

describe('isGithubCommitSha', () => {
  test('accepts only full 40 character commit identifiers', () => {
    expect(isGithubCommitSha('0123456789abcdef0123456789abcdef01234567')).toBe(true);
    expect(isGithubCommitSha('0123456789abcdef0123456789abcdef0123456g')).toBe(false);
    expect(isGithubCommitSha('0123456789abcdef')).toBe(false);
  });
});
