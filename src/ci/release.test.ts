import { createHash } from "node:crypto";

import { assert, describe, expect, it } from "vitest";

import { releaseBundle } from "./release.ts";
import type { UploadOptions } from "./upload.ts";

const API = "https://shared.example/ci";
const TOKEN_REQUEST_URL = "https://actions.example/token?api-version=2.0";
// Stand-ins, in no real token's shape.
const REQUEST_TOKEN = "SYNTHETIC_REQUEST_TOKEN";
const JOB_TOKEN = "SYNTHETIC_JOB_TOKEN";

const VERSION = "1.4.2";
const SHA256 = createHash("sha256").update("a bundle").digest("hex");
const ASKED = { version: VERSION, sha256: SHA256 };
const RELEASE_ID = "0193a1b2-c3d4-7e5f-8a6b-0123456789ab";

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
  readonly redirect: RequestInit["redirect"];
}

function json(status: number, body: unknown, headers = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

// Answers each request in turn, and records what was sent.
function network(answers: readonly Response[]) {
  const sent: Sent[] = [];
  const remaining = [...answers];
  const fake: typeof fetch = (input, init) => {
    sent.push({
      url:
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers)),
      body: typeof init?.body === "string" ? init.body : undefined,
      redirect: init?.redirect,
    });
    const answer = remaining.shift();
    assert(answer !== undefined, "an unexpected request");
    return Promise.resolve(answer);
  };
  return { fetch: fake, sent };
}

function options(fake: typeof fetch): UploadOptions {
  return {
    api: API,
    environment: "development",
    domain: "example",
    tokenRequestUrl: TOKEN_REQUEST_URL,
    tokenRequestToken: REQUEST_TOKEN,
    fetch: fake,
  };
}

const TOKEN_ISSUED = () => json(200, { value: JOB_TOKEN });
const QUEUED = () =>
  json(202, {
    releaseId: RELEASE_ID,
    environment: "development",
    domain: "example",
    version: VERSION,
    sha256: SHA256,
  });

describe("releaseBundle", () => {
  it("asks the API to release the bundle by its version, with the token and the body's own hash", async () => {
    const { fetch, sent } = network([TOKEN_ISSUED(), QUEUED()]);

    const releaseId = await releaseBundle(ASKED, options(fetch));

    expect(releaseId).toBe(RELEASE_ID);

    expect(sent[0]?.url).toBe(
      `${TOKEN_REQUEST_URL}&audience=${encodeURIComponent(API)}`,
    );
    const [, asked] = sent;
    assert(asked?.body !== undefined);
    expect(asked.url).toBe(
      `${API}/environments/development/domains/example/releases`,
    );
    expect(asked.method).toBe("POST");
    expect(JSON.parse(asked.body)).toEqual({ version: VERSION });
    expect(asked.headers).toEqual({
      "content-type": "application/json",
      "x-flex-ci-token": JOB_TOKEN,
      "x-amz-content-sha256": createHash("sha256")
        .update(asked.body)
        .digest("hex"),
    });
    // A redirect would carry the token elsewhere.
    expect(asked.redirect).toBe("error");
  });

  it("fails with the API's reason and request ID", async () => {
    const { fetch } = network([
      TOKEN_ISSUED(),
      json(
        409,
        {
          message: "No bundle with this version has been uploaded",
          type: "client_error",
        },
        { "x-correlation-id": "1-00000000-000000000000000000000000" },
      ),
    ]);

    await expect(releaseBundle(ASKED, options(fetch))).rejects.toMatchObject({
      message:
        "The pipeline API answered 409: No bundle with this version has been uploaded (request 1-00000000-000000000000000000000000)",
    });
  });

  // Any other success is not the API's answer to a release.
  it("fails on a 200, which the API never answers a release with", async () => {
    const { fetch } = network([TOKEN_ISSUED(), json(200, { sha256: SHA256 })]);

    await expect(releaseBundle(ASKED, options(fetch))).rejects.toThrow(
      "The pipeline API answered 200",
    );
  });

  it("fails when the API queued another bundle or version", async () => {
    for (const answer of [
      { releaseId: RELEASE_ID, version: VERSION, sha256: "0".repeat(64) },
      { releaseId: RELEASE_ID, version: "1.4.3", sha256: SHA256 },
    ]) {
      const { fetch } = network([TOKEN_ISSUED(), json(202, answer)]);

      await expect(releaseBundle(ASKED, options(fetch))).rejects.toThrow(
        "another bundle",
      );
    }
  });

  // The ID goes into the address the status is asked at.
  it("fails when the answer's release ID is not one", async () => {
    for (const releaseId of [undefined, "", "../uploads", `${RELEASE_ID}/x`]) {
      const { fetch } = network([
        TOKEN_ISSUED(),
        json(202, { releaseId, version: VERSION, sha256: SHA256 }),
      ]);

      await expect(releaseBundle(ASKED, options(fetch))).rejects.toThrow(
        "The pipeline API's answer held no release ID",
      );
    }
  });

  it("never puts the token in an error", async () => {
    const { fetch } = network([
      TOKEN_ISSUED(),
      json(500, { message: "Internal server error" }),
    ]);

    await expect(releaseBundle(ASKED, options(fetch))).rejects.toSatisfy(
      (error) => error instanceof Error && !error.message.includes("SYNTHETIC"),
    );
  });
});
