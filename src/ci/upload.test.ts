import { createHash } from "node:crypto";

import { assert, describe, expect, it } from "vitest";

import { uploadBundle, type UploadOptions } from "./upload.ts";

const API = "https://shared.example/ci";
const TOKEN_REQUEST_URL = "https://actions.example/token?api-version=2.0";
// Stand-ins, in no real token's shape.
const REQUEST_TOKEN = "SYNTHETIC_REQUEST_TOKEN";
const JOB_TOKEN = "SYNTHETIC_JOB_TOKEN";
const UPLOAD_URL =
  "https://bucket.s3.eu-west-2.amazonaws.com/example/bundle/hash.zip?X-Amz-Signature=SYNTHETIC";
const UPLOAD_HEADERS = {
  "if-none-match": "*",
  "x-amz-checksum-sha256": "checksum",
};

const BUNDLE = Buffer.from("a bundle");
const BUNDLE_SHA256 = createHash("sha256").update(BUNDLE).digest("hex");

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
    const { body } = init ?? {};
    sent.push({
      url:
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers)),
      body:
        typeof body === "string"
          ? body
          : body instanceof Uint8Array
            ? Buffer.from(body).toString()
            : undefined,
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
const UPLOAD_SIGNED = () =>
  json(200, {
    method: "PUT",
    url: UPLOAD_URL,
    headers: UPLOAD_HEADERS,
    expiresInSeconds: 300,
  });

describe("uploadBundle", () => {
  it("asks GitHub for a token made out to the API's address", async () => {
    const { fetch, sent } = network([
      TOKEN_ISSUED(),
      UPLOAD_SIGNED(),
      new Response(null, { status: 200 }),
    ]);

    await uploadBundle(BUNDLE, options(fetch));

    expect(sent[0]?.url).toBe(
      `${TOKEN_REQUEST_URL}&audience=${encodeURIComponent(API)}`,
    );
    expect(sent[0]?.headers.authorization).toBe(`Bearer ${REQUEST_TOKEN}`);
  });

  it("tells the API the bundle's hash and size, with the token and the body's own hash", async () => {
    const { fetch, sent } = network([
      TOKEN_ISSUED(),
      UPLOAD_SIGNED(),
      new Response(null, { status: 200 }),
    ]);

    await uploadBundle(BUNDLE, options(fetch));

    const [, asked] = sent;
    assert(asked?.body !== undefined);
    expect(asked.url).toBe(
      `${API}/environments/development/domains/example/uploads`,
    );
    expect(asked.method).toBe("POST");
    expect(JSON.parse(asked.body)).toEqual({
      sha256: BUNDLE_SHA256,
      size: BUNDLE.length,
    });
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

  it("sends the bundle where the API said, with the headers it gave and nothing of the token", async () => {
    const { fetch, sent } = network([
      TOKEN_ISSUED(),
      UPLOAD_SIGNED(),
      new Response(null, { status: 200 }),
    ]);

    const uploaded = await uploadBundle(BUNDLE, options(fetch));

    expect(sent[2]).toEqual({
      url: UPLOAD_URL,
      method: "PUT",
      headers: UPLOAD_HEADERS,
      body: BUNDLE.toString(),
      redirect: "error",
    });
    expect(uploaded).toEqual({
      key: `example/bundle/${BUNDLE_SHA256}.zip`,
      sha256: BUNDLE_SHA256,
      outcome: "uploaded",
    });
  });

  it("takes S3's 412 as done: the platform already holds this bundle", async () => {
    const { fetch } = network([
      TOKEN_ISSUED(),
      UPLOAD_SIGNED(),
      new Response("<Error><Code>PreconditionFailed</Code></Error>", {
        status: 412,
      }),
    ]);

    const uploaded = await uploadBundle(BUNDLE, options(fetch));

    expect(uploaded.outcome).toBe("already-there");
  });

  it("fails with the API's reason and request ID, and sends S3 nothing", async () => {
    const { fetch, sent } = network([
      TOKEN_ISSUED(),
      json(
        403,
        { message: "Forbidden", type: "auth_error" },
        { "x-correlation-id": "1-00000000-000000000000000000000000" },
      ),
    ]);

    await expect(uploadBundle(BUNDLE, options(fetch))).rejects.toMatchObject({
      message:
        "The pipeline API answered 403: Forbidden (request 1-00000000-000000000000000000000000)",
    });
    expect(sent).toHaveLength(2);
  });

  it("fails with the status alone for an answer that isn't the API's", async () => {
    const { fetch } = network([
      TOKEN_ISSUED(),
      new Response("<html>Blocked</html>", { status: 403 }),
    ]);

    await expect(uploadBundle(BUNDLE, options(fetch))).rejects.toMatchObject({
      message: "The pipeline API answered 403",
    });
  });

  it("refuses an answer that is no upload to make", async () => {
    for (const answer of [
      { method: "POST", url: UPLOAD_URL, headers: UPLOAD_HEADERS },
      { method: "PUT", url: "http://bucket.example/key", headers: {} },
      { method: "PUT", url: UPLOAD_URL, headers: { "if-none-match": 1 } },
      { method: "PUT", headers: UPLOAD_HEADERS },
      [],
    ]) {
      const { fetch, sent } = network([TOKEN_ISSUED(), json(200, answer)]);

      await expect(uploadBundle(BUNDLE, options(fetch))).rejects.toMatchObject({
        message: "The pipeline API's answer is not an upload to make",
      });
      expect(sent).toHaveLength(2);
    }
  });

  it("fails with S3's error code, and nothing else of its answer", async () => {
    const { fetch } = network([
      TOKEN_ISSUED(),
      UPLOAD_SIGNED(),
      new Response(
        "<Error><Code>SignatureDoesNotMatch</Code><StringToSign>SYNTHETIC</StringToSign></Error>",
        { status: 403 },
      ),
    ]);

    await expect(uploadBundle(BUNDLE, options(fetch))).rejects.toMatchObject({
      message: "S3 refused the bundle: 403 SignatureDoesNotMatch",
    });
  });

  it("fails when GitHub issues no token, and asks the API nothing", async () => {
    for (const answer of [
      json(401, { message: "Unauthorized" }),
      json(200, { value: "" }),
      json(200, {}),
    ]) {
      const { fetch, sent } = network([answer]);

      await expect(uploadBundle(BUNDLE, options(fetch))).rejects.toThrow();
      expect(sent).toHaveLength(1);
    }
  });

  it("never puts the token or the upload's address in an error", async () => {
    const failures = [
      [TOKEN_ISSUED(), json(500, { message: "Internal server error" })],
      [TOKEN_ISSUED(), UPLOAD_SIGNED(), new Response("", { status: 500 })],
    ];
    for (const answers of failures) {
      const { fetch } = network(answers);

      await expect(uploadBundle(BUNDLE, options(fetch))).rejects.toSatisfy(
        (error) =>
          error instanceof Error && !error.message.includes("SYNTHETIC"),
      );
    }
  });
});
