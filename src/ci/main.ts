// Uploads `dist/bundle.zip`, then releases it, from a GitHub Actions job. See
// `.github/workflows/ci.yml`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { releaseBundle } from "./release.ts";
import { uploadBundle } from "./upload.ts";

const BUNDLE = fileURLToPath(new URL("../../dist/bundle.zip", import.meta.url));

function variable(name: string, from: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. ${from}`);
  }
  return value;
}

const WORKFLOW = "The workflow sets it.";
const JOB =
  "GitHub sets it for a job with the permission `id-token: write`, so this runs only there.";

try {
  const options = {
    api: variable("FLEX_CI_API", WORKFLOW),
    environment: variable("FLEX_ENVIRONMENT", WORKFLOW),
    domain: variable("FLEX_DOMAIN", WORKFLOW),
    tokenRequestUrl: variable("ACTIONS_ID_TOKEN_REQUEST_URL", JOB),
    tokenRequestToken: variable("ACTIONS_ID_TOKEN_REQUEST_TOKEN", JOB),
  };
  const { key, sha256, outcome } = await uploadBundle(
    readFileSync(BUNDLE),
    options,
  );
  console.log(
    outcome === "uploaded"
      ? `Uploaded ${key}`
      : `The platform already holds ${key}`,
  );
  // An upload that was already there is released too: the last release may have been of other
  // code, or may have failed.
  await releaseBundle(sha256, options);
  console.log(
    `Asked the platform to release ${key} to ${options.environment}. It releases it in the background.`,
  );
} catch (error) {
  // The message alone, never the rest of the error: a failed request's can hold its address.
  console.error(error instanceof Error ? error.message : "The upload failed");
  process.exitCode = 1;
}
