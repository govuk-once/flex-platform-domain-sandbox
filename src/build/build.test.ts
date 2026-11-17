import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildFunction, CODE_FILE, HANDLER } from "./build.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("buildFunction", () => {
  it("is deployed as index.js, with its handler exported by that name", () => {
    expect(HANDLER).toBe("index.handler");
    expect(CODE_FILE).toBe("index.js");
  });

  it("gives the same code every time", () => {
    expect(buildFunction()).toBe(buildFunction());
  });

  // As Lambda runs it: `index.js` alone in a directory outside the project, so nothing it needs
  // can be resolved from here, loaded as CommonJS by a fresh Node.
  it("runs on its own, answering a request", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "domain-sandbox-"));
    directories.push(directory);
    writeFileSync(path.join(directory, CODE_FILE), buildFunction());

    const script = `
      require("./index.js")
        .handler({ httpMethod: "GET", path: "/hello" })
        .then((result) => process.stdout.write(JSON.stringify(result)));
    `;
    const stdout = execFileSync(process.execPath, ["-e", script], {
      cwd: directory,
      encoding: "utf8",
    });

    const result: unknown = JSON.parse(stdout);
    expect(result).toEqual({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Hello from the example domain",
        method: "GET",
        path: "/hello",
      }),
    });
  });
});
