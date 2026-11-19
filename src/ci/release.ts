// Asks the platform to release a version it holds, in two requests: GitHub, for the job's token,
// and the pipeline API. The API queues the release and answers at once with the release's ID. The
// platform's release worker then creates or updates the domain's function, publishes a version
// and points `live` at it. `status.ts` asks how that went.

import {
  API_TIMEOUT_MS,
  field,
  jobToken,
  refusal,
  sha256Hex,
  type UploadOptions,
} from "./upload.ts";

// A UUID of version 7. The ID goes into the address `status.ts` asks at, so nothing else is taken.
const RELEASE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface ReleaseAsked {
  readonly version: string;
  /** The SHA-256 of the bundle uploaded as that version, in lowercase hex. */
  readonly sha256: string;
}

/** Answers the ID of the release the platform queued. */
export async function releaseBundle(
  asked: ReleaseAsked,
  options: UploadOptions,
): Promise<string> {
  const send = options.fetch ?? fetch;
  const token = await jobToken(send, options);
  const body = JSON.stringify({ version: asked.version });
  const response = await send(
    `${options.api}/environments/${options.environment}/domains/${options.domain}/releases`,
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
  if (response.status !== 202) {
    throw new Error(await refusal(response));
  }

  const answer: unknown = await response.json();
  // The version names the bundle the platform recorded for it, which must be the one just built.
  if (
    field(answer, "version") !== asked.version ||
    field(answer, "sha256") !== asked.sha256
  ) {
    throw new Error("The pipeline API queued the release of another bundle");
  }
  const releaseId = field(answer, "releaseId");
  if (typeof releaseId !== "string" || !RELEASE_ID.test(releaseId)) {
    throw new Error("The pipeline API's answer held no release ID");
  }
  return releaseId;
}
