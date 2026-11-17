// Builds the function and writes its bundle, the zip the platform takes, to `dist/bundle.zip`.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildFunction, CODE_FILE } from "./build.ts";
import { zipOf } from "./zip.ts";

const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));

const bundle = zipOf([
  { name: CODE_FILE, content: Buffer.from(buildFunction(), "utf8") },
]);

mkdirSync(DIST, { recursive: true });
writeFileSync(`${DIST}bundle.zip`, bundle);

const sha256 = createHash("sha256").update(bundle).digest("hex");
console.log(`dist/bundle.zip: ${bundle.length} bytes, SHA-256 ${sha256}`);
