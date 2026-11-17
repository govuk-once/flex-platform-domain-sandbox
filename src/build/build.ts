import { fileURLToPath } from "node:url";

import { buildSync } from "esbuild";

const ENTRY = fileURLToPath(new URL("../function/handler.ts", import.meta.url));

// The bundle is CommonJS, deployed as `index.js` with the handler `index.handler`.
export const HANDLER = "index.handler";

/** The file the function's code is under in the zip. */
export const CODE_FILE = "index.js";

// Returns the code of `index.js`, with every dependency bundled.
export function buildFunction(): string {
  const result = buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    target: "node24",
    // Not minified, so the source locations a failure logs point at a line worth reading.
  });

  const output = result.outputFiles[0]?.text;
  if (output === undefined) throw new Error("esbuild produced no output");
  return output;
}
