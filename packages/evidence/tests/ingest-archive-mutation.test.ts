import { expect, test } from "bun:test";
import { ingestEvidenceArchive } from "../application/ingest-archive.js";

let notifyStorageAccepted: () => void = () => {};
let finishStorage: () => void = () => {};
const storageAccepted = new Promise<void>((resolve) => {
  notifyStorageAccepted = resolve;
});
const storageGate = new Promise<void>((resolve) => {
  finishStorage = resolve;
});

test("caller mutation during awaited storage cannot alter the scanned archive snapshot", async () => {
  const original = createZip("src/main.ts", Buffer.from("export const answer = 42;\n"));
  const callerBuffer = Buffer.from(original);
  let storedCopy: Uint8Array | undefined;
  const pending = ingestEvidenceArchive({
    actorId: "actor-1",
    workspaceId: "workspace-1",
    archiveBytes: callerBuffer,
  }, {
    canIngestEvidence: async () => true,
  }, {
    storeAcceptedArchive: async ({ archiveBytes }) => {
      // Model the storage port's contract: copy/commit before resolving.
      storedCopy = Buffer.from(archiveBytes);
      notifyStorageAccepted();
      await storageGate;
    },
  });

  await Promise.race([
    storageAccepted,
    Bun.sleep(3_000).then(() => { throw new Error("Storage did not accept the archive within 3 seconds."); }),
  ]);
  callerBuffer.fill(0);
  finishStorage();

  const result = await pending;
  expect(result.status).toBe("accepted");
  expect(storedCopy).toEqual(original);
});

function createZip(path: string, contents: Uint8Array): Buffer {
  const name = Buffer.from(path, "utf8");
  const data = Buffer.from(contents);
  const checksum = crc32(data);
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);

  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0314, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  central.writeUInt32LE(0, 42);
  name.copy(central, 46);

  const centralOffset = local.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(centralOffset, 16);
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
