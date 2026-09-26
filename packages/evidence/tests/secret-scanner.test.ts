import { describe, expect, test } from "bun:test";
import {
  EvidenceSecretScanError,
  EvidenceSecretScanErrorCode,
  scanEvidenceFileForSecrets,
} from "../application/index.js";
import { EvidenceArchiveErrorCode } from "../application/archive-errors.js";
import { EVIDENCE_SCANNED_FILE_MAX_BYTES, readBoundedZipEvidenceArchive } from "../application/read-bounded-zip.js";

describe("in-memory evidence secret scanner", () => {
  test("accepts benign text through the bounded ZIP reader callback", async () => {
    const bytes = Buffer.from("export function add(a: number, b: number) { return a + b; }\n", "utf8");
    const result = await readBoundedZipEvidenceArchive(createZip("src/math.ts", bytes), {
      scanFile: scanEvidenceFileForSecrets,
    });

    expect(result.manifest.entries[0]?.path).toBe("src/math.ts");
  });

  test("rejects a known credential without exposing source or secret text", async () => {
    const token = ["ghp_", "123456789012345678901234567890123456"].join("");
    let thrown: unknown;
    try {
      await readBoundedZipEvidenceArchive(createZip("config.txt", Buffer.from(`token=${token}\n`, "utf8")), {
        scanFile: scanEvidenceFileForSecrets,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: EvidenceArchiveErrorCode.SCANNER_FAILED });
    expect(JSON.stringify(thrown)).not.toContain(token);
    expect(String(thrown)).not.toContain(token);
    const cause = (thrown as Error & { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(EvidenceSecretScanError);
    expect(cause).toMatchObject({
      code: EvidenceSecretScanErrorCode.SECRET_DETECTED,
    });
    expect(String(cause)).not.toContain(token);
  });

  test("does not honor evidence-controlled secretlint suppression directives", async () => {
    const token = ["ghp_", "123456789012345678901234567890123456"].join("");
    const text = `// secretlint-disable\nconst token = "${token}";\n`;
    let thrown: unknown;
    try {
      await readBoundedZipEvidenceArchive(createZip("src/credentials.ts", Buffer.from(text, "utf8")), {
        scanFile: scanEvidenceFileForSecrets,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: EvidenceArchiveErrorCode.SCANNER_FAILED });
    expect(String(thrown)).not.toContain(token);
    expect((thrown as Error & { cause?: unknown }).cause).toMatchObject({
      code: EvidenceSecretScanErrorCode.SECRET_DETECTED,
    });
  });

  test.each([
    ["malformed UTF-8", new Uint8Array([0xc3, 0x28])],
    ["binary NUL", new Uint8Array([0x41, 0x00, 0x42])],
    ["binary controls", new Uint8Array([0x41, 0x01, 0x42])],
  ])("rejects %s rather than scanning partial text", async (_label, bytes) => {
    await expect(scanEvidenceFileForSecrets({ path: "data.bin", bytes })).rejects.toMatchObject({
      code: EvidenceSecretScanErrorCode.UNSUPPORTED_CONTENT,
    });
  });

  test("rejects files above the scanner's documented 8 MiB in-memory limit before scanning", async () => {
    const bytes = new Uint8Array(EVIDENCE_SCANNED_FILE_MAX_BYTES + 1);
    await expect(scanEvidenceFileForSecrets({ path: "large.txt", bytes })).rejects.toMatchObject({
      code: EvidenceSecretScanErrorCode.UNSUPPORTED_CONTENT,
    });
  });
});

function createZip(name: string, contents: Uint8Array): Buffer {
  const nameBytes = Buffer.from(name, "utf8");
  const data = Buffer.from(contents);
  const checksum = crc32(data);
  const local = Buffer.alloc(30 + nameBytes.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  nameBytes.copy(local, 30);

  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0314, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  central.writeUInt32LE(0, 42);
  nameBytes.copy(central, 46);

  const centralDirectoryOffset = local.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(centralDirectoryOffset, 16);
  return Buffer.concat([local, data, central, end]);
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
