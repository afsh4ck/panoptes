import { inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/**
 * Read every entry of a small ZIP archive (GDELT publishes single-file
 * archives). Walks the central directory so archives that use data
 * descriptors still resolve sizes correctly; ZIP64 is not supported.
 * @param {Uint8Array|Buffer} bytes Archive bytes.
 * @param {{maxEntryBytes?: number}} [options] Decompressed size ceiling per entry.
 * @returns {Array<{name: string, method: number, data: Buffer}>}
 */
export function readZipEntries(
  bytes,
  { maxEntryBytes = 64 * 1024 * 1024 } = {},
) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length < 22) throw new Error('zip_truncated');
  let eocd = -1;
  const floor = Math.max(0, buf.length - 22 - 65_535);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip_no_central_directory');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (
      offset + 46 > buf.length ||
      buf.readUInt32LE(offset) !== CENTRAL_SIGNATURE
    )
      throw new Error('zip_bad_central_entry');
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (uncompressedSize > maxEntryBytes)
      throw new Error('zip_entry_too_large');
    if (
      localOffset + 30 > buf.length ||
      buf.readUInt32LE(localOffset) !== LOCAL_SIGNATURE
    )
      throw new Error('zip_bad_local_header');
    const localNameLength = buf.readUInt16LE(localOffset + 26);
    const localExtraLength = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const end = start + compressedSize;
    if (end > buf.length) throw new Error('zip_truncated_entry');
    const raw = buf.subarray(start, end);
    let data;
    if (method === METHOD_STORED) data = Buffer.from(raw);
    else if (method === METHOD_DEFLATE)
      data = inflateRawSync(raw, { maxOutputLength: maxEntryBytes });
    else throw new Error(`zip_unsupported_method_${method}`);
    entries.push({ name, method, data });
  }
  return entries;
}

/**
 * Build a single-entry deflated archive (test fixture helper; also handy for
 * cache round-trips). Not a general ZIP writer.
 * @param {string} name Entry name.
 * @param {Buffer} data Entry bytes.
 * @param {Buffer} compressed Raw-deflated bytes of `data`.
 * @returns {Buffer}
 */
export function buildSingleEntryZip(name, data, compressed) {
  const nameBytes = Buffer.from(name, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(LOCAL_SIGNATURE, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(METHOD_DEFLATE, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(METHOD_DEFLATE, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);
  const centralOffset = local.length + nameBytes.length + compressed.length;
  const centralSize = central.length + nameBytes.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([
    local,
    nameBytes,
    compressed,
    central,
    nameBytes,
    eocd,
  ]);
}
