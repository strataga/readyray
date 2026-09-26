import { describe, expect, test } from "bun:test";
import {
  createEvidenceCitation,
  ReviewDomainError,
  ReviewErrorCode,
} from "../index.js";

const digest = "a".repeat(64);

describe("evidence citations", () => {
  test("canonicalizes relative paths and SHA-256 casing into immutable citations", () => {
    const citation = createEvidenceCitation({
      path: "src//./review.ts",
      startLine: 2,
      endLine: 4,
      sha256: digest.toUpperCase(),
    });

    expect(citation).toEqual({
      path: "src/review.ts",
      startLine: 2,
      endLine: 4,
      sha256: digest,
    });
    expect(Object.isFrozen(citation)).toBe(true);
  });

  test.each([
    ["empty path", ""],
    ["absolute POSIX path", "/etc/passwd"],
    ["Windows drive path", "C:\\repo\\secret.txt"],
    ["parent traversal", "src/../../secret.txt"],
    ["control character", "src/secret\u0000.txt"],
    ["unpaired high surrogate", "src/secret-\ud800.txt"],
    ["unpaired low surrogate", "src/secret-\udc00.txt"],
    ["separator-only path", "./\\//."],
  ])("rejects %s", (_label, path) => {
    expectReviewError(() => makeCitation({ path }), ReviewErrorCode.INVALID_CITATION);
  });

  test.each([
    [0, 1],
    [-1, 1],
    [1.5, 2],
    [2, 1],
    [1, Number.POSITIVE_INFINITY],
  ])("rejects invalid inclusive line range %p..%p", (startLine, endLine) => {
    expectReviewError(
      () => createEvidenceCitation({ path: "src/a.ts", startLine, endLine, sha256: digest }),
      ReviewErrorCode.INVALID_CITATION,
    );
  });

  test.each(["", "a".repeat(63), "g".repeat(64), "a".repeat(65)])("rejects invalid SHA-256 value %p", (sha256) => {
    expectReviewError(
      () => createEvidenceCitation({ path: "src/a.ts", startLine: 1, endLine: 1, sha256 }),
      ReviewErrorCode.INVALID_CITATION,
    );
  });

  test("rejects non-object and null citation inputs with a typed error", () => {
    expectReviewError(() => createEvidenceCitation(null as never), ReviewErrorCode.INVALID_CITATION);
    expectReviewError(() => createEvidenceCitation(undefined as never), ReviewErrorCode.INVALID_CITATION);
  });
});

function makeCitation(overrides: { readonly path?: string } = {}) {
  return createEvidenceCitation({
    path: overrides.path ?? "src/a.ts",
    startLine: 1,
    endLine: 1,
    sha256: digest,
  });
}

function expectReviewError(action: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ReviewDomainError);
  expect((thrown as ReviewDomainError).code).toBe(code);
}
