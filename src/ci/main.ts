// Uploads `dist/bundle.zip` as the version in `package.json`, releases it, and waits for it to be
// live, from a GitHub Actions job. See `.github/workflows/ci.yml`.
//
// Running it again for the same version and code is no failure: each step finds its work done.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { releaseBundle } from "./release.ts";
import { waitForRelease } from "./status.ts";
import { uploadBundle } from "./upload.ts";
import { bundleVersion } from "./version.ts";

const BUNDLE = fileURLToPath(new URL("../../dist/bundle.zip", import.meta.url));
const PACKAGE = fileURLToPath(new URL("../../package.json", import.meta.url));

// A release takes seconds, or minutes the first time, when the platform creates the function in
// its network. Longer is not normal, so the job stops waiting and fails. The workflow gives the
// job 20 minutes, which leaves three to set up and build.
const WAIT_MS = 17 * 60_000;
const ASK_EVERY_MS = 5_000;

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
  const version = bundleVersion(readFileSync(PACKAGE, "utf8"));
  const { environment } = options;

  const uploaded = await uploadBundle(readFileSync(BUNDLE), version, options);
  console.log(
    uploaded.outcome === "uploaded"
      ? `Uploaded ${version} as ${uploaded.key}`
      : `The platform already holds ${version}, as ${uploaded.key}. Nothing to upload.`,
  );

  // A bundle that was already there is released too: its last release may have failed. Where it
  // is already live, the platform changes nothing and says so.
  const releaseId = await releaseBundle(uploaded, options);
  console.log(
    `Asked the platform to release ${version} to ${environment}: release ${releaseId}`,
  );

  const { moved, functionVersion } = await waitForRelease(releaseId, {
    ...options,
    waitMs: WAIT_MS,
    intervalMs: ASK_EVERY_MS,
  });
  const at =
    functionVersion === undefined
      ? ""
      : `, function version ${functionVersion}`;
  console.log(
    moved === false
      ? `${version} is already live in ${environment}${at}. Nothing to do.`
      : `${version} is live in ${environment}${at}`,
  );
} catch (error) {
  // The message alone, never the rest of the error: a failed request's can hold its address.
  console.error(error instanceof Error ? error.message : "The release failed");
  process.exitCode = 1;
}
