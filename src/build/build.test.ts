import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, assert, describe, expect, it } from "vitest";

import { field } from "../ci/upload.ts";
import { bundleVersion } from "../ci/version.ts";
import { buildFunction, CODE_FILE, HANDLER } from "./build.ts";

// The parts of API Gateway's REST proxy event the function reads, as the platform's API sends
// it for `/app/example/hello`.
const EVENT = {
  resource: "/{proxy+}",
  path: "/hello",
  httpMethod: "GET",
  headers: { accept: "application/json" },
  multiValueHeaders: { accept: ["application/json"] },
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  body: null,
  isBase64Encoded: false,
  requestContext: {
    domainName: "example.development.domains.test",
    httpMethod: "GET",
    path: "/hello",
    resourcePath: "/{proxy+}",
    stage: "default",
  },
};

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
        .handler(${JSON.stringify(EVENT)})
        .then((result) => process.stdout.write(JSON.stringify(result)));
    `;
    const stdout = execFileSync(process.execPath, ["-e", script], {
      cwd: directory,
      encoding: "utf8",
    });

    const result: unknown = JSON.parse(stdout);
    expect(result).toMatchObject({
      statusCode: 200,
      isBase64Encoded: false,
      multiValueHeaders: { "content-type": ["application/json"] },
    });
    const body = field(result, "body");
    assert(typeof body === "string", "the answer has no body");
    expect(JSON.parse(body)).toEqual({
      message: "Hello from the example domain",
      version: bundleVersion(
        readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
      ),
    });
  });
});
