import { crc32, inflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { type ZipFile, zipOf } from "./zip.ts";

const FILES: readonly ZipFile[] = [
  { name: "index.js", content: Buffer.from("exports.handler = () => {};\n") },
  { name: "data/é.txt", content: Buffer.from("x".repeat(10_000)) },
];

interface Entry {
  readonly name: string;
  readonly content: Buffer;
  readonly checksum: number;
  readonly permissions: number;
  readonly time: number;
  readonly date: number;
}

// Reads a zip back from its directory at the end, as an unzipper does.
function entriesOf(zip: Buffer): Entry[] {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);

  const entries: Entry[] = [];
  for (let index = 0; index < count; index += 1) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const compressed = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");

    expect(zip.readUInt32LE(local)).toBe(0x04034b50);
    const start =
      local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const content = inflateRawSync(zip.subarray(start, start + compressed));
    expect(content.length).toBe(zip.readUInt32LE(at + 24));

    entries.push({
      name,
      content,
      checksum: zip.readUInt32LE(at + 16),
      permissions: zip.readUInt32LE(at + 38) >>> 16,
      time: zip.readUInt16LE(at + 12),
      date: zip.readUInt16LE(at + 14),
    });
    at += 46 + nameLength;
  }
  expect(at).toBe(end);
  return entries;
}

describe("zipOf", () => {
  it("holds each file under its name, with its content and checksum", () => {
    const entries = entriesOf(zipOf(FILES));

    expect(entries.map(({ name, content }) => ({ name, content }))).toEqual(
      FILES,
    );
    for (const entry of entries) {
      expect(entry.checksum).toBe(crc32(entry.content));
    }
  });

  it("makes each a file anyone may read, as Lambda needs", () => {
    for (const { permissions } of entriesOf(zipOf(FILES))) {
      expect(permissions).toBe(0o100644);
    }
  });

  // The platform keeps a bundle under its hash, so the same code must be the same zip.
  it("gives the same bytes every time, holding no time but the format's earliest", () => {
    const zip = zipOf(FILES);

    expect(zipOf(FILES).equals(zip)).toBe(true);
    for (const { time, date } of entriesOf(zip)) {
      expect(time).toBe(0);
      expect(date).toBe(0x21);
    }
  });

  it("writes an empty zip for no files", () => {
    expect(entriesOf(zipOf([]))).toEqual([]);
  });
});
