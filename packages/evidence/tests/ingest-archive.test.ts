import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  EvidenceArchiveIngestError,
  EvidenceArchiveIngestErrorCode,
  EvidenceArchiveIngestRejectionCode,
  ingestEvidenceArchive,
} from "../application/ingest-archive.js";
import type {
  EvidenceArchiveStoragePort,
  StoreAcceptedEvidenceArchive,
  WorkspaceEvidenceAuthorizationPort,
} from "../application/ingest-archive.js";

interface ZipEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
}

function createZip(entries: readonly ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const bytes = Buffer.from(entry.bytes);
    const checksum = crc32(bytes);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    localParts.push(local, bytes);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    localOffset += local.length + bytes.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dependencies(authorized = true, store?: (value: StoreAcceptedEvidenceArchive) => Promise<void>) {
  const stored: StoreAcceptedEvidenceArchive[] = [];
  const authorization: WorkspaceEvidenceAuthorizationPort = {
    canIngestEvidence: async () => authorized,
  };
  const storage: EvidenceArchiveStoragePort = {
    storeAcceptedArchive: async (value) => {
      const committedValue = { ...value, archiveBytes: Buffer.from(value.archiveBytes) };
      stored.push(committedValue);
      await store?.(committedValue);
    },
  };
  return { authorization, storage, stored };
}

const context = { actorId: "actor-1", workspaceId: "workspace-1" };

describe("ingestEvidenceArchive", () => {
  test("authorizes the workspace before parsing and never stores unauthorized input", async () => {
    const deps = dependencies(false);
    let thrown: unknown;
    try {
      await ingestEvidenceArchive({ ...context, archiveBytes: Buffer.from("malformed ZIP") }, deps.authorization, deps.storage);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(EvidenceArchiveIngestError);
    expect(thrown).toMatchObject({ code: EvidenceArchiveIngestErrorCode.WORKSPACE_FORBIDDEN });
    expect(deps.stored).toHaveLength(0);
  });

  test("returns a rejected intake for detected secrets without storing raw bytes", async () => {
    const token = ["ghp_", "123456789012345678901234567890123456"].join("");
    const archiveBytes = createZip([{ path: "config.txt", bytes: Buffer.from(`token=${token}\n`) }]);
    const deps = dependencies();
    const result = await ingestEvidenceArchive({ ...context, archiveBytes }, deps.authorization, deps.storage);
    expect(result).toMatchObject({
      status: "rejected",
      intake: { status: "rejected" },
      rejectionCode: EvidenceArchiveIngestRejectionCode.SECRET_DETECTED,
    });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(deps.stored).toHaveLength(0);
  });

  test("returns a rejected intake for binary content without storing it", async () => {
    const deps = dependencies();
    const result = await ingestEvidenceArchive({
      ...context,
      archiveBytes: createZip([{ path: "binary.dat", bytes: new Uint8Array([0x41, 0x00, 0x42]) }]),
    }, deps.authorization, deps.storage);
    expect(result).toMatchObject({
      status: "rejected",
      rejectionCode: EvidenceArchiveIngestRejectionCode.UNSUPPORTED_CONTENT,
    });
    expect(deps.stored).toHaveLength(0);
  });

  test("maps the per-file scan size limit to unsupported content without storing it", async () => {
    const deps = dependencies();
    const oversizedTextFile = Buffer.alloc(8 * 1024 * 1024 + 1, 0x61);
    const result = await ingestEvidenceArchive({
      ...context,
      archiveBytes: createZip([{ path: "large.txt", bytes: oversizedTextFile }]),
    }, deps.authorization, deps.storage);
    expect(result).toMatchObject({
      status: "rejected",
      rejectionCode: EvidenceArchiveIngestRejectionCode.UNSUPPORTED_CONTENT,
    });
    expect(deps.stored).toHaveLength(0);
  });

  test("returns a stable rejection for malformed ZIP input without storing it", async () => {
    const deps = dependencies();
    const result = await ingestEvidenceArchive({
      ...context,
      archiveBytes: Buffer.from("not a ZIP"),
    }, deps.authorization, deps.storage);
    expect(result).toMatchObject({
      status: "rejected",
      rejectionCode: EvidenceArchiveIngestRejectionCode.INVALID_ARCHIVE,
    });
    expect(deps.stored).toHaveLength(0);
  });

  test("stores an accepted intake only after scanning and returns both digests", async () => {
    const archiveBytes = createZip([{ path: "src/main.ts", bytes: Buffer.from("export const answer = 42;\n") }]);
    const deps = dependencies();
    const result = await ingestEvidenceArchive({ ...context, archiveBytes }, deps.authorization, deps.storage);
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") {
      throw new Error("Expected an accepted intake.");
    }
    expect(result.intake.status).toBe("accepted");
    expect(result.archiveSha256).toBe(createHash("sha256").update(archiveBytes).digest("hex"));
    expect(result.manifest.entries).toEqual([{ path: "src/main.ts", byteSize: Buffer.byteLength("export const answer = 42;\n") }]);
    expect(result.digests[0]?.hexDigest).toBe(createHash("sha256").update("export const answer = 42;\n").digest("hex"));
    expect(deps.stored).toHaveLength(1);
    expect(deps.stored[0]?.intake.status).toBe("accepted");
    expect(deps.stored[0]?.archiveBytes).toEqual(archiveBytes);
  });

  test("reports storage failure distinctly and never returns accepted", async () => {
    const deps = dependencies(true, async () => { throw new Error("storage offline"); });
    let thrown: unknown;
    try {
      await ingestEvidenceArchive({
        ...context,
        archiveBytes: createZip([{ path: "readme.txt", bytes: Buffer.from("safe text") }]),
      }, deps.authorization, deps.storage);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: EvidenceArchiveIngestErrorCode.STORAGE_FAILED });
    expect(thrown).not.toMatchObject({ status: "accepted" });
  });
});
