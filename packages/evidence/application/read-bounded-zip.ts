import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import type { Readable } from "node:stream";
import yauzl from "yauzl";
import type { Entry, ZipFile } from "yauzl";
import { createEvidenceDigestRecord } from "../domain/digest.js";
import type { EvidenceDigestRecord } from "../domain/digest.js";
import { EvidenceDomainError } from "../domain/errors.js";
import { createEvidenceManifest } from "../domain/manifest.js";
import type { EvidenceManifest, EvidenceManifestEntryInput } from "../domain/manifest.js";
import { normalizeRelativeEvidencePath } from "../domain/relative-path.js";
import { EvidenceArchiveErrorCode, EvidenceArchiveReadError } from "./archive-errors.js";

export const EVIDENCE_ARCHIVE_LIMITS = Object.freeze({
  maxCompressedBytes: 50 * 1024 * 1024,
  maxExpandedBytes: 250 * 1024 * 1024,
  maxEntries: 5_000,
  maxPathCharacters: 4_096,
  maxPathNodes: 50_000,
});

/** Maximum expanded bytes retained for one file when a scanner callback is enabled. */
export const EVIDENCE_SCANNED_FILE_MAX_BYTES = 8 * 1024 * 1024;

const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_DIRECTORY = 0o040000;
const UNIX_REGULAR_FILE = 0o100000;
const UNIX_SYMBOLIC_LINK = 0o120000;
const DOS_DIRECTORY = 0x10;
const ENCRYPTED_FLAG = 0x0001;
const STRONG_ENCRYPTION_FLAG = 0x0040;
const MAX_CONCURRENT_ARCHIVE_READS = 1;
let activeArchiveReads = 0;

export interface ReadBoundedZipOptions {
  /** Called with each validated file before the archive result is returned. */
  readonly scanFile?: (file: EvidenceArchiveScannerFile) => void | Promise<void>;
}

export interface EvidenceArchiveScannerFile {
  readonly path: string;
  /** Mutable bytes are zeroed immediately after the awaited scanner callback returns. */
  readonly bytes: Uint8Array;
}

export interface EvidenceArchiveReadResult {
  readonly manifest: EvidenceManifest;
  readonly digests: readonly EvidenceDigestRecord[];
}

type ArchiveNodeKind = "directory" | "file";

interface ArchivePathNode {
  kind?: ArchiveNodeKind;
  readonly children: Map<string, ArchivePathNode>;
}

/** Read an untrusted ZIP from a bounded buffer without extracting it to disk or executing its files. */
export async function readBoundedZipEvidenceArchive(
  input: Uint8Array,
  options: ReadBoundedZipOptions = {},
): Promise<EvidenceArchiveReadResult> {
  if (!(input instanceof Uint8Array)) {
    throw archiveError(EvidenceArchiveErrorCode.INVALID_INPUT, "ZIP input must be a Uint8Array.");
  }
  if (input.byteLength > EVIDENCE_ARCHIVE_LIMITS.maxCompressedBytes) {
    throw archiveError(EvidenceArchiveErrorCode.COMPRESSED_SIZE_LIMIT, "ZIP input exceeds the compressed byte limit.");
  }
  if (activeArchiveReads >= MAX_CONCURRENT_ARCHIVE_READS) {
    throw archiveError(EvidenceArchiveErrorCode.CONCURRENT_LIMIT, "Another evidence archive is already being read.");
  }
  activeArchiveReads += 1;

  try {
    // Copy before yielding so callers cannot mutate the archive during asynchronous parsing.
    const archiveBuffer = Buffer.from(input);
    let zipFile: ZipFile;
    try {
      zipFile = await new Promise<ZipFile>((resolve, reject) => {
        yauzl.fromBuffer(archiveBuffer, {
          lazyEntries: true,
          validateEntrySizes: true,
          decodeStrings: true,
          strictFileNames: true,
          autoClose: false,
        }, (error, openedZipFile) => {
          if (error || !openedZipFile) {
            reject(error ?? new Error("ZIP parser did not return an archive."));
          } else {
            resolve(openedZipFile);
          }
        });
      });
    } catch (cause) {
      throw archiveError(EvidenceArchiveErrorCode.INVALID_ARCHIVE, "ZIP archive structure is invalid.", cause);
    }

    if (zipFile.entryCount > EVIDENCE_ARCHIVE_LIMITS.maxEntries) {
      zipFile.close();
      throw archiveError(EvidenceArchiveErrorCode.ENTRY_LIMIT, "ZIP archive contains too many entries.");
    }

    return await consumeArchive(zipFile, options);
  } finally {
    activeArchiveReads -= 1;
  }
}

function consumeArchive(zipFile: ZipFile, options: ReadBoundedZipOptions): Promise<EvidenceArchiveReadResult> {
  return new Promise((resolve, reject) => {
    const activeStreams = new Set<Readable>();
    const pathRoot: ArchivePathNode = { children: new Map() };
    const pathNodeCount = { value: 1 };
    const explicitPaths = new Map<string, ArchiveNodeKind>();
    const manifestInputs: EvidenceManifestEntryInput[] = [];
    const digests: EvidenceDigestRecord[] = [];
    let entriesSeen = 0;
    let declaredExpandedBytes = 0;
    let actualExpandedBytes = 0;
    let settled = false;

    const closeStreams = (): void => {
      for (const stream of activeStreams) {
        stream.destroy();
      }
      activeStreams.clear();
    };

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      closeStreams();
      zipFile.close();
      reject(error);
    };

    const succeed = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        const manifest = createEvidenceManifest(manifestInputs, {
          maxEntries: EVIDENCE_ARCHIVE_LIMITS.maxEntries,
          maxTotalBytes: EVIDENCE_ARCHIVE_LIMITS.maxExpandedBytes,
          maxPathCharacters: EVIDENCE_ARCHIVE_LIMITS.maxPathCharacters,
          maxMediaTypeCharacters: 255,
        });
        zipFile.close();
        resolve(Object.freeze({
          manifest,
          digests: Object.freeze(digests),
        }));
      } catch (error) {
        zipFile.close();
        if (error instanceof EvidenceDomainError) {
          reject(archiveError(EvidenceArchiveErrorCode.INVALID_ARCHIVE, "ZIP archive metadata is invalid.", error));
        } else {
          reject(error instanceof Error ? error : new Error("ZIP archive processing failed."));
        }
      }
    };

    const handleEntry = (entry: Entry): void => {
      if (settled) {
        return;
      }
      try {
        entriesSeen += 1;
        if (entriesSeen > EVIDENCE_ARCHIVE_LIMITS.maxEntries) {
          throw archiveError(EvidenceArchiveErrorCode.ENTRY_LIMIT, "ZIP archive contains too many entries.");
        }

        if ((entry.generalPurposeBitFlag & (ENCRYPTED_FLAG | STRONG_ENCRYPTION_FLAG)) !== 0 || entry.isEncrypted()) {
          throw archiveError(EvidenceArchiveErrorCode.UNSUPPORTED_ENCRYPTION, "Encrypted ZIP entries are not supported.");
        }
        if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
          throw archiveError(EvidenceArchiveErrorCode.INVALID_ENTRY, "ZIP entry uses an unsupported compression method.");
        }

        const hostSystem = entry.versionMadeBy >>> 8;
        const unixMode = hostSystem === 3 || hostSystem === 19
          ? entry.externalFileAttributes >>> 16
          : 0;
        const unixType = unixMode & UNIX_FILE_TYPE_MASK;
        if (unixType === UNIX_SYMBOLIC_LINK) {
          throw archiveError(EvidenceArchiveErrorCode.UNSUPPORTED_ENTRY_TYPE, "Symbolic links are not accepted in evidence archives.");
        }
        if (unixType !== 0 && unixType !== UNIX_REGULAR_FILE && unixType !== UNIX_DIRECTORY) {
          throw archiveError(EvidenceArchiveErrorCode.UNSUPPORTED_ENTRY_TYPE, "ZIP entry is not a regular file or directory.");
        }

        const rawPath = entry.fileName;
        let path: string;
        try {
          path = normalizeRelativeEvidencePath(rawPath);
        } catch (cause) {
          throw archiveError(EvidenceArchiveErrorCode.INVALID_PATH, "ZIP entry path is unsafe or invalid.", cause);
        }
        if (path.length > EVIDENCE_ARCHIVE_LIMITS.maxPathCharacters) {
          throw archiveError(EvidenceArchiveErrorCode.INVALID_PATH, "ZIP entry path exceeds the path character limit.");
        }
        const isDirectory = rawPath.endsWith("/") || unixType === UNIX_DIRECTORY ||
          (entry.externalFileAttributes & DOS_DIRECTORY) !== 0;
        const kind: ArchiveNodeKind = isDirectory ? "directory" : "file";

        if (explicitPaths.has(path)) {
          const priorKind = explicitPaths.get(path);
          throw priorKind === kind
            ? archiveError(EvidenceArchiveErrorCode.DUPLICATE_PATH, "ZIP archive contains duplicate normalized paths.")
            : archiveError(EvidenceArchiveErrorCode.PATH_COLLISION, "ZIP archive contains a directory/file path collision.");
        }
        registerArchivePath(path, kind, pathRoot, pathNodeCount);
        explicitPaths.set(path, kind);

        if (isDirectory) {
          if (entry.uncompressedSize !== 0 || entry.compressedSize !== 0) {
            throw archiveError(EvidenceArchiveErrorCode.INVALID_ENTRY, "ZIP directory entries must not contain file data.");
          }
          zipFile.readEntry();
          return;
        }

        if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 ||
          !Number.isSafeInteger(entry.compressedSize) || entry.compressedSize < 0) {
          throw archiveError(EvidenceArchiveErrorCode.INVALID_ENTRY, "ZIP entry sizes are invalid.");
        }
        if (options.scanFile && entry.uncompressedSize > EVIDENCE_SCANNED_FILE_MAX_BYTES) {
          throw archiveError(
            EvidenceArchiveErrorCode.SCANNED_FILE_SIZE_LIMIT,
            "A scanned ZIP entry exceeds the per-file byte limit.",
          );
        }
        const remainingBudget = EVIDENCE_ARCHIVE_LIMITS.maxExpandedBytes - declaredExpandedBytes;
        if (entry.uncompressedSize > remainingBudget) {
          throw archiveError(EvidenceArchiveErrorCode.EXPANDED_SIZE_LIMIT, "ZIP archive exceeds the expanded byte limit.");
        }
        declaredExpandedBytes += entry.uncompressedSize;
        readRegularEntry(entry, path, entry.uncompressedSize);
      } catch (error) {
        fail(error instanceof Error ? error : new Error("ZIP archive processing failed."));
      }
    };

    const readRegularEntry = (entry: Entry, path: string, declaredSize: number): void => {
      zipFile.openReadStream(entry, (openError, stream) => {
        if (settled) {
          stream?.destroy();
          return;
        }
        if (openError || !stream) {
          fail(archiveError(EvidenceArchiveErrorCode.INVALID_ARCHIVE, "ZIP entry could not be opened.", openError));
          return;
        }

        activeStreams.add(stream);
        const hash = createHash("sha256");
        const retainBytes = options.scanFile !== undefined;
        const fileBytes = retainBytes ? Buffer.allocUnsafe(declaredSize) : undefined;
        let entryBytes = 0;
        let crc = 0xffffffff;
        let streamFailed = false;

        stream.on("data", (chunk: Buffer | string) => {
          if (settled || streamFailed) {
            return;
          }
          const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
          const nextEntryBytes = entryBytes + bytes.byteLength;
          if (nextEntryBytes > declaredSize || actualExpandedBytes + bytes.byteLength > EVIDENCE_ARCHIVE_LIMITS.maxExpandedBytes) {
            streamFailed = true;
            stream.destroy();
            fail(archiveError(EvidenceArchiveErrorCode.EXPANDED_SIZE_LIMIT, "ZIP entry expanded beyond its declared or allowed size."));
            return;
          }
          entryBytes = nextEntryBytes;
          actualExpandedBytes += bytes.byteLength;
          hash.update(bytes);
          crc = updateCrc32(crc, bytes);
          if (fileBytes) {
            bytes.copy(fileBytes, entryBytes - bytes.byteLength);
          }
        });

        stream.once("error", (error: Error) => {
          if (!settled && !streamFailed) {
            fail(archiveError(EvidenceArchiveErrorCode.INVALID_ARCHIVE, "ZIP entry data is malformed.", error));
          }
        });

        stream.once("end", () => {
          activeStreams.delete(stream);
          if (settled || streamFailed) {
            return;
          }
          if (entryBytes !== declaredSize) {
            fail(archiveError(EvidenceArchiveErrorCode.SIZE_MISMATCH, "ZIP entry size does not match its declaration."));
            return;
          }
          if (((crc ^ 0xffffffff) >>> 0) !== entry.crc32) {
            fail(archiveError(EvidenceArchiveErrorCode.CHECKSUM_MISMATCH, "ZIP entry checksum does not match its declaration."));
            return;
          }

          const digest = hash.digest("hex");
          void (async () => {
          try {
            manifestInputs.push({ path, byteSize: entryBytes });
            digests.push(createEvidenceDigestRecord({
              path,
              algorithm: "sha256",
              hexDigest: digest,
              byteSize: entryBytes,
            }));
            if (fileBytes && options.scanFile) {
              let scannerMutatedBytes = false;
              try {
                await options.scanFile(Object.freeze({ path, bytes: fileBytes }));
                scannerMutatedBytes = createHash("sha256").update(fileBytes).digest("hex") !== digest;
              } catch (error) {
                fail(archiveError(EvidenceArchiveErrorCode.SCANNER_FAILED, "Evidence secret scanning failed.", error));
                return;
              } finally {
                fileBytes.fill(0);
              }
              if (scannerMutatedBytes) {
                fail(archiveError(EvidenceArchiveErrorCode.SCANNER_MUTATED_BYTES, "The secret scanner changed evidence bytes."));
                return;
              }
            }
            zipFile.readEntry();
          } catch (error) {
            fail(error instanceof Error ? error : new Error("ZIP archive processing failed."));
          }
          })();
        });
      });
    };

    zipFile.once("error", (error: Error) => {
      fail(archiveError(EvidenceArchiveErrorCode.INVALID_ARCHIVE, "ZIP archive could not be read.", error));
    });
    zipFile.once("end", succeed);
    zipFile.on("entry", handleEntry);
    try {
      zipFile.readEntry();
    } catch (error) {
      fail(archiveError(EvidenceArchiveErrorCode.INVALID_ARCHIVE, "ZIP archive could not be read.", error));
    }
  });
}

function registerArchivePath(
  path: string,
  kind: ArchiveNodeKind,
  root: ArchivePathNode,
  nodeCount: { value: number },
): void {
  let node = root;
  const segments = path.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    if (node.kind === "file") {
      throw archiveError(EvidenceArchiveErrorCode.PATH_COLLISION, "A ZIP file path is also used as a parent directory.");
    }
    const segment = segments[index]!;
    let child = node.children.get(segment);
    if (child === undefined) {
      if (nodeCount.value >= EVIDENCE_ARCHIVE_LIMITS.maxPathNodes) {
        throw archiveError(EvidenceArchiveErrorCode.PATH_COMPLEXITY_LIMIT, "ZIP archive contains too many distinct path segments.");
      }
      child = { children: new Map() };
      node.children.set(segment, child);
      nodeCount.value += 1;
    }
    const isLastSegment = index === segments.length - 1;
    if (isLastSegment) {
      if (child.kind !== undefined && child.kind !== kind) {
        throw archiveError(EvidenceArchiveErrorCode.PATH_COLLISION, "ZIP archive contains a directory/file path collision.");
      }
      child.kind = kind;
    } else {
      if (child.kind === "file") {
        throw archiveError(EvidenceArchiveErrorCode.PATH_COLLISION, "A ZIP file path is also used as a parent directory.");
      }
      child.kind ??= "directory";
      node = child;
    }
  }
}

const CRC32_TABLE = createCrc32Table();

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function updateCrc32(crc: number, bytes: Uint8Array): number {
  let value = crc;
  for (const byte of bytes) {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return value >>> 0;
}

function archiveError(
  code: EvidenceArchiveErrorCode,
  message: string,
  cause?: unknown,
): EvidenceArchiveReadError {
  return new EvidenceArchiveReadError(code, message, cause instanceof Error ? { cause } : undefined);
}
