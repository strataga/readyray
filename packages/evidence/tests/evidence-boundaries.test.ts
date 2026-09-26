import { describe, expect, test } from "bun:test";
import { createEvidenceDigestRecord } from "../domain/digest.js";
import { EvidenceDomainError, EvidenceErrorCode } from "../domain/errors.js";
import { createEvidenceIntake, transitionEvidenceIntake } from "../domain/intake.js";
import { createEvidenceManifest } from "../domain/manifest.js";
import { normalizeRelativeEvidencePath } from "../domain/relative-path.js";

function expectCode(action: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(EvidenceDomainError);
  expect(thrown).toMatchObject({ code });
}

const manifestLimits = {
  maxEntries: 3,
  maxTotalBytes: 20,
  maxPathCharacters: 30,
  maxMediaTypeCharacters: 40,
};

describe("relative evidence paths", () => {
  test("normalizes dot and repeated separators and treats backslashes as separators", () => {
    expect(normalizeRelativeEvidencePath("./src//lib\\module.ts")).toBe("src/lib/module.ts");
  });

  test.each(["../secret", "a/../secret", "/etc/passwd", "C:\\temp\\file", "\\\\server\\share", "", ".", "a\0b"])(
    "rejects unsafe or non-file paths: %p",
    (path) => expectCode(() => normalizeRelativeEvidencePath(path), EvidenceErrorCode.INVALID_RELATIVE_PATH),
  );

  test("accepts paired Unicode surrogate characters", () => {
    expect(normalizeRelativeEvidencePath("docs/architecture-🧭.md")).toBe("docs/architecture-🧭.md");
  });

  test.each(["bad-\ud800-name", "bad-\udc00-name", "\ud800\ud800", "\udc00\ud800"])(
    "rejects unpaired Unicode surrogates: %p",
    (path) => expectCode(() => normalizeRelativeEvidencePath(path), EvidenceErrorCode.INVALID_RELATIVE_PATH),
  );
});

describe("evidence manifests", () => {
  test("normalizes paths before detecting duplicates", () => {
    expectCode(
      () => createEvidenceManifest([
        { path: "src//main.ts", byteSize: 1 },
        { path: "src/./main.ts", byteSize: 1 },
      ], manifestLimits),
      EvidenceErrorCode.INVALID_MANIFEST,
    );
  });

  test("applies path character and entry count limits", () => {
    expectCode(
      () => createEvidenceManifest([{ path: "long-name.ts", byteSize: 1 }], { ...manifestLimits, maxPathCharacters: 5 }),
      EvidenceErrorCode.MANIFEST_LIMIT_EXCEEDED,
    );
    expectCode(
      () => createEvidenceManifest(Array.from({ length: 4 }, (_, index) => ({ path: `f${index}`, byteSize: 0 })), manifestLimits),
      EvidenceErrorCode.MANIFEST_LIMIT_EXCEEDED,
    );
  });

  test("rejects non-array inputs and non-object entries at runtime", () => {
    expectCode(
      () => createEvidenceManifest(null as never, manifestLimits),
      EvidenceErrorCode.INVALID_MANIFEST,
    );
    expectCode(
      () => createEvidenceManifest([null as never], manifestLimits),
      EvidenceErrorCode.INVALID_MANIFEST,
    );
  });

  test("rejects invalid byte sizes and media types", () => {
    for (const byteSize of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
      expectCode(
        () => createEvidenceManifest([{ path: "a", byteSize }], manifestLimits),
        EvidenceErrorCode.INVALID_MANIFEST,
      );
    }
    for (const mediaType of ["", "x".repeat(41), "text/plain\nforged"]) {
      expectCode(
        () => createEvidenceManifest([{ path: "a", byteSize: 0, mediaType }], manifestLimits),
        EvidenceErrorCode.INVALID_MANIFEST,
      );
    }
  });

  test("freezes the manifest and entries returned to callers", () => {
    const manifest = createEvidenceManifest([{ path: "a", byteSize: 2 }], manifestLimits);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.entries)).toBe(true);
    expect(Object.isFrozen(manifest.entries[0])).toBe(true);
  });
});

describe("evidence digests", () => {
  const validDigest = "A".repeat(64);

  test("accepts only a SHA-256 hex digest and canonicalizes it", () => {
    expect(createEvidenceDigestRecord({ path: "./src\\main.ts", algorithm: "sha256", hexDigest: validDigest, byteSize: 3 }))
      .toEqual({ path: "src/main.ts", algorithm: "sha256", hexDigest: "a".repeat(64), byteSize: 3 });
  });

  test("rejects unsupported algorithms, malformed digest lengths/characters, and invalid sizes", () => {
    const base = { path: "a", algorithm: "sha256" as const, hexDigest: "a".repeat(64), byteSize: 0 };
    expectCode(
      () => createEvidenceDigestRecord({ ...base, algorithm: "md5" as "sha256" }),
      EvidenceErrorCode.INVALID_DIGEST,
    );
    for (const hexDigest of ["a".repeat(63), "a".repeat(65), "g".repeat(64), "0x" + "a".repeat(62)]) {
      expectCode(() => createEvidenceDigestRecord({ ...base, hexDigest }), EvidenceErrorCode.INVALID_DIGEST);
    }
    for (const byteSize of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expectCode(() => createEvidenceDigestRecord({ ...base, byteSize }), EvidenceErrorCode.INVALID_DIGEST);
    }
  });

  test("rejects a digest record whose path is not repository-relative", () => {
    expectCode(
      () => createEvidenceDigestRecord({ path: "../a", algorithm: "sha256", hexDigest: validDigest, byteSize: 0 }),
      EvidenceErrorCode.INVALID_RELATIVE_PATH,
    );
  });
});

describe("evidence intake lifecycle", () => {
  const start = "2026-09-25T12:00:00.000Z";

  test("supports received to validating to accepted and returns immutable states", () => {
    const received = createEvidenceIntake("intake-1", start);
    const validating = transitionEvidenceIntake(received, "validating", "2026-09-25T12:01:00.000Z");
    const accepted = transitionEvidenceIntake(validating, "accepted", "2026-09-25T12:02:00.000Z");
    expect([received.status, validating.status, accepted.status]).toEqual(["received", "validating", "accepted"]);
    expect(Object.isFrozen(received)).toBe(true);
    expect(Object.isFrozen(validating)).toBe(true);
    expect(Object.isFrozen(accepted)).toBe(true);
  });

  test("supports rejection with a stable code from received or validating", () => {
    const received = createEvidenceIntake("intake-2", start);
    const rejectedDirectly = transitionEvidenceIntake(received, "rejected", start, "unsupported_media");
    const validating = transitionEvidenceIntake(received, "validating", start);
    const rejectedAfterValidation = transitionEvidenceIntake(validating, "rejected", start, "invalid_manifest");
    expect(rejectedDirectly).toMatchObject({ status: "rejected", rejectionCode: "unsupported_media" });
    expect(rejectedAfterValidation).toMatchObject({ status: "rejected", rejectionCode: "invalid_manifest" });
  });

  test("rejects illegal transitions and transitions from terminal states", () => {
    const received = createEvidenceIntake("intake-3", start);
    expectCode(() => transitionEvidenceIntake(received, "accepted", start), EvidenceErrorCode.INVALID_INTAKE_TRANSITION);
    const accepted = transitionEvidenceIntake(
      transitionEvidenceIntake(received, "validating", start), "accepted", start,
    );
    expectCode(() => transitionEvidenceIntake(accepted, "rejected", start, "late"), EvidenceErrorCode.INVALID_INTAKE_TRANSITION);
  });

  test("requires valid monotonic canonical timestamps and identifiers", () => {
    expectCode(() => createEvidenceIntake("  ", start), EvidenceErrorCode.INVALID_INTAKE);
    expectCode(() => createEvidenceIntake("intake-4", "2026-09-25T12:00:00Z"), EvidenceErrorCode.INVALID_INTAKE);
    const received = createEvidenceIntake("intake-4", start);
    expectCode(() => transitionEvidenceIntake(received, "validating", "2026-09-25T11:59:59.999Z"), EvidenceErrorCode.INVALID_INTAKE);
    expectCode(() => transitionEvidenceIntake(received, "validating", "2026-02-30T12:00:00.000Z"), EvidenceErrorCode.INVALID_INTAKE);
  });

  test("requires rejection codes only for rejected transitions and rejects control characters", () => {
    const received = createEvidenceIntake("intake-5", start);
    expectCode(() => transitionEvidenceIntake(received, "rejected", start), EvidenceErrorCode.INVALID_INTAKE);
    expectCode(() => transitionEvidenceIntake(received, "rejected", start, "bad\ncode"), EvidenceErrorCode.INVALID_INTAKE);
    expectCode(() => transitionEvidenceIntake(received, "validating", start, "unexpected"), EvidenceErrorCode.INVALID_INTAKE);
  });

  test("rejects malformed or unknown caller-supplied intake state", () => {
    const received = createEvidenceIntake("intake-6", start);
    expectCode(
      () => transitionEvidenceIntake({ ...received, status: "unknown" } as never, "validating", start),
      EvidenceErrorCode.INVALID_INTAKE,
    );
    expectCode(
      () => transitionEvidenceIntake({ ...received, id: "bad\nidentifier" }, "validating", start),
      EvidenceErrorCode.INVALID_INTAKE,
    );
    expectCode(
      () => transitionEvidenceIntake({ ...received, status: "rejected", rejectionCode: "bad\ncode" } as never, "validating", start),
      EvidenceErrorCode.INVALID_INTAKE,
    );
  });
});
