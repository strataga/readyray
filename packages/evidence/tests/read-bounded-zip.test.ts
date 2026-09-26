import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { describe, expect, test } from "bun:test";
import { EvidenceArchiveErrorCode, EvidenceArchiveReadError } from "../application/archive-errors.js";
import {
  EVIDENCE_ARCHIVE_LIMITS,
  EVIDENCE_SCANNED_FILE_MAX_BYTES,
  readBoundedZipEvidenceArchive,
} from "../application/read-bounded-zip.js";

interface ZipFixtureEntry {
  readonly name: string;
  readonly data?: Uint8Array;
  readonly flags?: number;
  readonly unixMode?: number;
  readonly declaredSize?: number;
  readonly declaredCrc?: number;
  readonly compressionMethod?: 0 | 8;
}

function createZip(entries: readonly ZipFixtureEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const fixture of entries) {
    const name = Buffer.from(fixture.name, "utf8");
    const data = Buffer.from(fixture.data ?? new Uint8Array());
    const compressionMethod = fixture.compressionMethod ?? 0;
    const compressedData = compressionMethod === 8
      ? deflateRawSync(data)
      : (fixture.flags ?? 0) & 1
        ? Buffer.concat([Buffer.alloc(12), data])
        : data;
    const crc = fixture.declaredCrc ?? crc32(data);
    const uncompressedSize = fixture.declaredSize ?? data.byteLength;
    const compressedSize = compressedData.byteLength;
    const flags = fixture.flags ?? 0;
    const unixMode = fixture.unixMode ?? 0o100644;

    const local = Buffer.alloc(30 + name.byteLength);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(compressionMethod, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    localParts.push(local, compressedData);

    const central = Buffer.alloc(46 + name.byteLength);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(compressionMethod, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(((unixMode & 0xffff) << 16) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    localOffset += local.byteLength + compressedData.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
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

async function expectArchiveError(archive: Uint8Array, code: string): Promise<void> {
  let thrown: unknown;
  try {
    await readBoundedZipEvidenceArchive(archive);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(EvidenceArchiveReadError);
  expect(thrown).toMatchObject({ code });
}

describe("readBoundedZipEvidenceArchive", () => {
  test("returns file metadata and SHA-256 digest records for a valid archive", async () => {
    const contents = Buffer.from("untrusted source, never executed");
    const archive = createZip([
      { name: "docs/", unixMode: 0o040755 },
      { name: "docs/architecture.md", data: contents },
      { name: "empty.txt", data: new Uint8Array() },
    ]);

    const result = await readBoundedZipEvidenceArchive(archive);
    expect(result.manifest).toEqual({
      entries: [
        { path: "docs/architecture.md", byteSize: contents.byteLength },
        { path: "empty.txt", byteSize: 0 },
      ],
      totalBytes: contents.byteLength,
    });
    expect(result.digests).toEqual([
      {
        path: "docs/architecture.md",
        algorithm: "sha256",
        hexDigest: createHash("sha256").update(contents).digest("hex"),
        byteSize: contents.byteLength,
      },
      {
        path: "empty.txt",
        algorithm: "sha256",
        hexDigest: createHash("sha256").update(new Uint8Array()).digest("hex"),
        byteSize: 0,
      },
    ]);
    expect("filesForSecretScanning" in result).toBe(false);
  });

  test("passes bounded file bytes to a scanner before returning and clears the buffer", async () => {
    const contents = Buffer.from("scan this bounded file");
    let scannerBuffer: Uint8Array | undefined;
    const result = await readBoundedZipEvidenceArchive(
      createZip([{ name: "src/file.ts", data: contents }]),
      { scanFile: ({ path, bytes }) => {
        expect(path).toBe("src/file.ts");
        expect(bytes).toEqual(contents);
        scannerBuffer = bytes;
      } },
    );
    expect(result.digests).toHaveLength(1);
    expect(scannerBuffer).toBeInstanceOf(Uint8Array);
    expect([...scannerBuffer!].every((byte) => byte === 0)).toBe(true);
    expect("filesForSecretScanning" in result).toBe(false);
  });

  test("rejects a scanner that mutates bytes whose digest has already been calculated", async () => {
    let thrown: unknown;
    try {
      await readBoundedZipEvidenceArchive(createZip([{ name: "src/file.ts", data: Buffer.from("original") }]), {
        scanFile: ({ bytes }) => {
          bytes[0] = 0;
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: EvidenceArchiveErrorCode.SCANNER_MUTATED_BYTES });
  });

  test("rejects a scanner failure and releases the single-reader slot", async () => {
    let thrown: unknown;
    try {
      await readBoundedZipEvidenceArchive(createZip([{ name: "file.txt", data: Buffer.from("scan failure") }]), {
        scanFile: () => { throw new Error("scanner unavailable"); },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: EvidenceArchiveErrorCode.SCANNER_FAILED });
    await readBoundedZipEvidenceArchive(createZip([{ name: "recovered.txt", data: Buffer.from("ok") }]));
  });

  test("bounds concurrent archive processing instead of queuing more archive buffers", async () => {
    let signalScannerEntered: () => void = () => {};
    let releaseScanner: () => void = () => {};
    const scannerEntered = new Promise<void>((resolve) => {
      signalScannerEntered = resolve;
    });
    const scannerWait = new Promise<void>((resolve) => {
      releaseScanner = resolve;
    });
    const archive = createZip([{ name: "file.txt", data: Buffer.from("wait") }]);
    const pending = readBoundedZipEvidenceArchive(archive, {
      scanFile: async () => {
        signalScannerEntered();
        await scannerWait;
      },
    });
    await scannerEntered;
    await expectArchiveError(archive, EvidenceArchiveErrorCode.CONCURRENT_LIMIT);
    releaseScanner();
    await pending;
  });

  test("rejects traversal paths", async () => {
    await expectArchiveError(
      createZip([{ name: "../outside.txt", data: Buffer.from("x") }]),
      EvidenceArchiveErrorCode.INVALID_ARCHIVE,
    );
  });

  test("rejects a declared expanded-size bomb before reading entry data", async () => {
    await expectArchiveError(
      createZip([{
        name: "bomb.bin",
        data: Buffer.from("x"),
        declaredSize: EVIDENCE_ARCHIVE_LIMITS.maxExpandedBytes + 1,
        compressionMethod: 8,
      }]),
      EvidenceArchiveErrorCode.EXPANDED_SIZE_LIMIT,
    );
  });

  test("rejects a declared scanned file above its cap before opening or scanning it", async () => {
    let scannerCalled = false;
    await expect(readBoundedZipEvidenceArchive(
      createZip([{
        name: "oversized.txt",
        data: Buffer.from("x"),
        declaredSize: EVIDENCE_SCANNED_FILE_MAX_BYTES + 1,
        compressionMethod: 8,
      }]),
      { scanFile: () => { scannerCalled = true; } },
    )).rejects.toMatchObject({ code: EvidenceArchiveErrorCode.SCANNED_FILE_SIZE_LIMIT });
    expect(scannerCalled).toBe(false);
  });

  test("rejects symlink entries", async () => {
    await expectArchiveError(
      createZip([{ name: "link", data: Buffer.from("target"), unixMode: 0o120777 }]),
      EvidenceArchiveErrorCode.UNSUPPORTED_ENTRY_TYPE,
    );
  });

  test("rejects duplicate normalized paths", async () => {
    await expectArchiveError(
      createZip([
        { name: "src/./same.txt", data: Buffer.from("one") },
        { name: "src//same.txt", data: Buffer.from("two") },
      ]),
      EvidenceArchiveErrorCode.DUPLICATE_PATH,
    );
  });

  test("rejects directory/file collisions in either entry order", async () => {
    await expectArchiveError(
      createZip([
        { name: "node", data: Buffer.from("file") },
        { name: "node/child.txt", data: Buffer.from("child") },
      ]),
      EvidenceArchiveErrorCode.PATH_COLLISION,
    );
    await expectArchiveError(
      createZip([
        { name: "parent/child.txt", data: Buffer.from("child") },
        { name: "parent", data: Buffer.from("file") },
      ]),
      EvidenceArchiveErrorCode.PATH_COLLISION,
    );
  });

  test("rejects encrypted entries and malformed ZIP input", async () => {
    await expectArchiveError(
      createZip([{ name: "secret.txt", data: Buffer.from("ciphertext"), flags: 0x0001 }]),
      EvidenceArchiveErrorCode.UNSUPPORTED_ENCRYPTION,
    );
    await expectArchiveError(Buffer.from("not a ZIP archive"), EvidenceArchiveErrorCode.INVALID_ARCHIVE);
  });

  test("rejects actual data that exceeds its declared entry size", async () => {
    await expectArchiveError(
      createZip([{
        name: "oversized.txt",
        data: Buffer.from("more than declared"),
        declaredSize: 2,
        compressionMethod: 8,
      }]),
      EvidenceArchiveErrorCode.INVALID_ARCHIVE,
    );
  });

  test("rejects actual data shorter than its declared entry size", async () => {
    await expectArchiveError(
      createZip([{
        name: "undersized.txt",
        data: Buffer.from("short"),
        declaredSize: 20,
        compressionMethod: 8,
      }]),
      EvidenceArchiveErrorCode.INVALID_ARCHIVE,
    );
  });

  test("rejects CRC corruption", async () => {
    await expectArchiveError(
      createZip([{ name: "corrupt.txt", data: Buffer.from("contents"), declaredCrc: 1 }]),
      EvidenceArchiveErrorCode.CHECKSUM_MISMATCH,
    );
  });

  test("rejects an input buffer above the compressed limit before copying it", async () => {
    await expectArchiveError(
      new Uint8Array(EVIDENCE_ARCHIVE_LIMITS.maxCompressedBytes + 1),
      EvidenceArchiveErrorCode.COMPRESSED_SIZE_LIMIT,
    );
  });

  test("rejects archives above the entry-count limit", async () => {
    const entries = Array.from({ length: EVIDENCE_ARCHIVE_LIMITS.maxEntries + 1 }, (_, index) => ({
      name: `entry-${index}.txt`,
    }));
    await expectArchiveError(createZip(entries), EvidenceArchiveErrorCode.ENTRY_LIMIT);
  });

  test("bounds path trie complexity independently of the archive entry count", async () => {
    const entries = Array.from({ length: 500 }, (_, fileIndex) => ({
      name: Array.from({ length: 100 }, (_, segmentIndex) => `f${fileIndex}s${segmentIndex}`).join("/"),
    }));
    await expectArchiveError(createZip(entries), EvidenceArchiveErrorCode.PATH_COMPLEXITY_LIMIT);
  });
});
