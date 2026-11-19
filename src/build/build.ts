import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildSync } from "esbuild";

import { bundleVersion } from "../ci/version.ts";

const ENTRY = fileURLToPath(new URL("../function/handler.ts", import.meta.url));
const PACKAGE_JSON = new URL("../../package.json", import.meta.url);

// The bundle is CommonJS, deployed as `index.js` with the handler `index.handler`.
export const HANDLER = "index.handler";

/** The file the function's code is under in the zip. */
export const CODE_FILE = "index.js";

// Returns the code of `index.js`, with every dependency bundled and the version from
// `package.json` written in, so the function can say which version is live.
export function buildFunction(): string {
  const version = bundleVersion(readFileSync(PACKAGE_JSON, "utf8"));
  const result = buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    target: "node24",
    define: { FLEX_EXAMPLE_VERSION: JSON.stringify(version) },
    // Not minified, so the source locations a failure logs point at a line worth reading.
  });

  const output = result.outputFiles[0]?.text;
  if (output === undefined) throw new Error("esbuild produced no output");
  return output;
}
