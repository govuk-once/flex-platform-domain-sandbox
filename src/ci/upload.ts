// Uploads a bundle through the platform's pipeline API, in three requests:
//
// 1. GitHub, for a token that says which repository and environment this job runs in, made out
//    to the API's address.
// 2. The API, with that token and the bundle's hash and size. It answers with one request this
//    job may make of S3.
// 3. S3, with the bundle.
//
// The job holds no AWS credentials. Neither the token nor the address S3 is sent the bundle at
// is ever printed: each lets its holder upload as this repository until it expires.

import { createHash } from "node:crypto";

export interface UploadOptions {
  /** The pipeline API's address, `https://<the stage's shared zone>/ci`. Also the token's audience. */
  readonly api: string;
  /** The platform's environment to upload to, which the job's GitHub environment is named for. */
  readonly environment: string;
  readonly domain: string;
  /** Where GitHub issues the job's token, and what to ask with. A job with `id-token: write` has both. */
  readonly tokenRequestUrl: string;
  readonly tokenRequestToken: string;
  /** Replaces the network in tests. */
  readonly fetch?: typeof fetch;
}

export interface Uploaded {
  /** Where the platform keeps the bundle. */
  readonly key: string;
  /** The bundle's SHA-256, in lowercase hex, which a release names it by. */
  readonly sha256: string;
  /** `already-there` when the platform holds this very bundle from an earlier upload. */
  readonly outcome: "uploaded" | "already-there";
}

export const API_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 240_000;

export async function uploadBundle(
  bundle: Buffer,
  options: UploadOptions,
): Promise<Uploaded> {
  const send = options.fetch ?? fetch;
  const token = await jobToken(send, options);
  const sha256 = sha256Hex(bundle);
  const upload = await askWhereToUpload(send, options, token, {
    sha256,
    size: bundle.length,
  });

  const response = await send(upload.url, {
    method: "PUT",
    headers: upload.headers,
    body: new Uint8Array(bundle),
    redirect: "error",
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  const key = `${options.domain}/bundle/${sha256}.zip`;
  if (response.ok) return { key, sha256, outcome: "uploaded" };
  // S3 was told to write only where there is no object. The key is the bundle's hash, so what
  // is there is this bundle.
  if (response.status === 412) {
    return { key, sha256, outcome: "already-there" };
  }
  // S3's answer can repeat what was signed, so only its error code is passed on.
  const code = /<Code>([A-Za-z0-9]+)<\/Code>/.exec(await response.text())?.[1];
  throw new Error(
    `S3 refused the bundle: ${response.status}${code === undefined ? "" : ` ${code}`}`,
  );
}

export async function jobToken(
  send: typeof fetch,
  options: UploadOptions,
): Promise<string> {
  const url = new URL(options.tokenRequestUrl);
  url.searchParams.set("audience", options.api);
  const response = await send(url, {
    headers: { authorization: `Bearer ${options.tokenRequestToken}` },
    redirect: "error",
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`GitHub issued no token: ${response.status}`);
  }
  const token = field(await response.json(), "value");
  if (typeof token !== "string" || token === "") {
    throw new Error("GitHub's answer held no token");
  }
  return token;
}

interface SignedUpload {
  readonly url: string;
  readonly headers: Record<string, string>;
}

async function askWhereToUpload(
  send: typeof fetch,
  options: UploadOptions,
  token: string,
  description: { readonly sha256: string; readonly size: number },
): Promise<SignedUpload> {
  const body = JSON.stringify(description);
  const response = await send(
    `${options.api}/environments/${options.environment}/domains/${options.domain}/uploads`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Not `Authorization`: CloudFront signs the request for the API, and that header holds
        // its signature.
        "x-flex-ci-token": token,
        // CloudFront can't hash a body, so it signs the hash it is given.
        "x-amz-content-sha256": sha256Hex(body),
      },
      body,
      // A redirect would carry the token to wherever it pointed.
      redirect: "error",
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new Error(await refusal(response));
  }

  const answer: unknown = await response.json();
  const url = field(answer, "url");
  const headers = field(answer, "headers");
  if (
    field(answer, "method") !== "PUT" ||
    typeof url !== "string" ||
    !url.startsWith("https://") ||
    !isStrings(headers)
  ) {
    throw new Error("The pipeline API's answer is not an upload to make");
  }
  return { url, headers };
}

// The API's own words for why, and its ID for the request, which finds the platform's logs of it.
export async function refusal(response: Response): Promise<string> {
  let message: unknown;
  try {
    message = field(await response.json(), "message");
  } catch {
    // Not JSON, so not the API's answer: CloudFront's, or the web ACL's.
  }
  const trace = response.headers.get("x-correlation-id");
  return [
    `The pipeline API answered ${response.status}`,
    typeof message === "string" ? `: ${message}` : "",
    trace === null ? "" : ` (request ${trace})`,
  ].join("");
}

export function field(value: unknown, name: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.hasOwn(value, name)
    ? (value as Record<string, unknown>)[name]
    : undefined;
}

function isStrings(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

export function sha256Hex(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}
