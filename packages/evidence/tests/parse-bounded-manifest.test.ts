import { describe, expect, test } from "bun:test";
import { parseBoundedEvidenceManifest } from "../application/parse-bounded-manifest.js";
import { EvidenceManifestParseError, EvidenceManifestParseErrorCode } from "../application/errors.js";
import { EvidenceDomainError, EvidenceErrorCode } from "../domain/errors.js";
import type { EvidenceManifestParsePolicy } from "../application/parse-bounded-manifest.js";

const defaultPolicy: EvidenceManifestParsePolicy = {
  maxManifestBytes: 1_024,
  maxEntries: 4,
  maxTotalBytes: 100,
  maxPathCharacters: 100,
  maxMediaTypeCharacters: 80,
};

function encoded(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function parse(value: unknown, policy: EvidenceManifestParsePolicy = defaultPolicy) {
  return parseBoundedEvidenceManifest(encoded(JSON.stringify(value)), policy);
}

function expectCode(action: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect(thrown).toMatchObject({ code });
}

describe("parseBoundedEvidenceManifest", () => {
  test("accepts a manifest exactly at the byte limit", () => {
    const bytes = encoded('{"entries":[]}');
    expect(parseBoundedEvidenceManifest(bytes, { ...defaultPolicy, maxManifestBytes: bytes.byteLength }))
      .toEqual({ entries: [], totalBytes: 0 });
  });

  test("rejects a manifest one byte over the byte limit", () => {
    const bytes = encoded('{"entries":[]}');
    expectCode(
      () => parseBoundedEvidenceManifest(bytes, { ...defaultPolicy, maxManifestBytes: bytes.byteLength - 1 }),
      EvidenceManifestParseErrorCode.BYTE_LIMIT_EXCEEDED,
    );
  });

  test("rejects malformed UTF-8 rather than replacing invalid bytes", () => {
    expectCode(
      () => parseBoundedEvidenceManifest(new Uint8Array([0x7b, 0xc3, 0x28, 0x7d]), defaultPolicy),
      EvidenceManifestParseErrorCode.INVALID_UTF8,
    );
  });

  test("rejects malformed JSON and a leading UTF-8 BOM", () => {
    expectCode(
      () => parseBoundedEvidenceManifest(encoded('{"entries":'), defaultPolicy),
      EvidenceManifestParseErrorCode.MALFORMED_JSON,
    );
    expectCode(
      () => parseBoundedEvidenceManifest(new Uint8Array([0xef, 0xbb, 0xbf, ...encoded('{"entries":[]}')]), defaultPolicy),
      EvidenceManifestParseErrorCode.MALFORMED_JSON,
    );
  });

  test("rejects unknown top-level and entry fields", () => {
    expectCode(() => parse({ entries: [], version: 1 }), EvidenceManifestParseErrorCode.INVALID_SHAPE);
    expectCode(
      () => parse({ entries: [{ path: "a.txt", byteSize: 1, digest: "untrusted" }] }),
      EvidenceManifestParseErrorCode.INVALID_SHAPE,
    );
  });

  test("rejects missing required fields and non-array entries", () => {
    expectCode(() => parse({}), EvidenceManifestParseErrorCode.INVALID_SHAPE);
    expectCode(() => parse({ entries: "a.txt" }), EvidenceManifestParseErrorCode.INVALID_SHAPE);
    expectCode(() => parse({ entries: [{ path: "a.txt" }] }), EvidenceManifestParseErrorCode.INVALID_SHAPE);
  });

  test("enforces the entry count before mapping entries", () => {
    expectCode(
      () => parse({ entries: [{ path: "a", byteSize: 0 }, { path: "b", byteSize: 0 }] }, { ...defaultPolicy, maxEntries: 1 }),
      EvidenceErrorCode.MANIFEST_LIMIT_EXCEEDED,
    );
  });

  test("enforces aggregate byte limits and safe integer totals", () => {
    expectCode(
      () => parse({ entries: [{ path: "a", byteSize: 3 }, { path: "b", byteSize: 2 }] }, { ...defaultPolicy, maxTotalBytes: 4 }),
      EvidenceErrorCode.MANIFEST_LIMIT_EXCEEDED,
    );
    expectCode(
      () => parse({ entries: [{ path: "a", byteSize: Number.MAX_SAFE_INTEGER }, { path: "b", byteSize: 1 }] }),
      EvidenceErrorCode.MANIFEST_LIMIT_EXCEEDED,
    );
  });

  test("rejects invalid parser policy", () => {
    expectCode(
      () => parseBoundedEvidenceManifest(encoded('{"entries":[]}'), { ...defaultPolicy, maxEntries: -1 }),
      EvidenceManifestParseErrorCode.INVALID_POLICY,
    );
  });

  test("rejects a non-Uint8Array input at runtime", () => {
    expectCode(
      () => parseBoundedEvidenceManifest(null as unknown as Uint8Array, defaultPolicy),
      EvidenceManifestParseErrorCode.INVALID_INPUT,
    );
  });

  test("reports parser failures with their typed parser error", () => {
    let thrown: unknown;
    try {
      parseBoundedEvidenceManifest(encoded("no json"), defaultPolicy);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(EvidenceManifestParseError);
  });
});

test("domain failures are distinguishable from parser shape failures", () => {
  let thrown: unknown;
  try {
    parse({ entries: [{ path: "../secret", byteSize: 1 }] });
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(EvidenceDomainError);
  expect(thrown).toMatchObject({ code: EvidenceErrorCode.INVALID_RELATIVE_PATH });
});
