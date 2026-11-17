// Writes a zip with nothing in it that changes from one build to the next: no file times, no
// owner, no order but the one given. The platform keeps a bundle under its SHA-256, so the same
// code must give the same zip, byte for byte, for a second upload of it to be the same bundle.

import { crc32, deflateRawSync } from "node:zlib";

export interface ZipFile {
  /** The file's path in the zip, with `/` between its parts. */
  readonly name: string;
  readonly content: Buffer;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;

// The format's version 2.0, which is what deflate needs.
const VERSION = 20;
// Made on Unix, so the file's permissions below are read.
const MADE_BY_UNIX = (3 << 8) | VERSION;
// Names are UTF-8.
const FLAGS = 0x0800;
const DEFLATE = 8;
// Midnight on 1 January 1980, the earliest time a zip can hold.
const TIME = 0;
const DATE = (1 << 5) | 1;
// A regular file its owner may write and anyone may read. Lambda runs the code as another user
// than the one that unpacked it.
const PERMISSIONS = 0o100644;

// Sizes and offsets are 32 bits, and counts 16, without the zip64 extension, which this leaves out.
const MAX_BYTES = 0xffffffff;
const MAX_FILES = 0xffff;

export function zipOf(files: readonly ZipFile[]): Buffer {
  if (files.length > MAX_FILES) throw new Error("Too many files for a zip");

  const entries: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = deflateRawSync(file.content, { level: 9 });
    const checksum = crc32(file.content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(FLAGS, 6);
    local.writeUInt16LE(DEFLATE, 8);
    local.writeUInt16LE(TIME, 10);
    local.writeUInt16LE(DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(file.content.length, 22);
    local.writeUInt16LE(name.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER, 0);
    central.writeUInt16LE(MADE_BY_UNIX, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(FLAGS, 8);
    central.writeUInt16LE(DEFLATE, 10);
    central.writeUInt16LE(TIME, 12);
    central.writeUInt16LE(DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(file.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    // The permissions are the high half of the file's external attributes.
    central.writeUInt32LE((PERMISSIONS << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);

    entries.push(local, name, data);
    directory.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const directoryBytes = Buffer.concat(directory);
  if (offset + directoryBytes.length > MAX_BYTES) {
    throw new Error("Too large for a zip without zip64");
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_DIRECTORY, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...entries, directoryBytes, end]);
}
