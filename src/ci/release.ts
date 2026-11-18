// Asks the platform to release a bundle it holds, by the hash it was uploaded with, in two
// requests: GitHub, for the job's token, and the pipeline API. The API queues the release and
// answers at once. The platform's release worker then creates or updates the domain's function,
// publishes a version and points `live` at it.

import {
  API_TIMEOUT_MS,
  field,
  jobToken,
  refusal,
  sha256Hex,
  type UploadOptions,
} from "./upload.ts";

export async function releaseBundle(
  sha256: string,
  options: UploadOptions,
): Promise<void> {
  const send = options.fetch ?? fetch;
  const token = await jobToken(send, options);
  const body = JSON.stringify({ sha256 });
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
  if (field(await response.json(), "sha256") !== sha256) {
    throw new Error("The pipeline API queued the release of another bundle");
  }
}
