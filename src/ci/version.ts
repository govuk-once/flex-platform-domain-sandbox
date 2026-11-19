// The bundle's version: the `version` in `package.json`, which the platform records the bundle
// under. It names one bundle for good, so it changes whenever the bundle's bytes do.

import { field } from "./upload.ts";

// `MAJOR.MINOR.PATCH` and nothing more, as the platform takes one: each part at most nine digits
// with no leading zero, no `v`, no pre-release and no build metadata.
const BUNDLE_VERSION = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;

/** The version a `package.json` holds, given the file's text. */
export function bundleVersion(packageJson: string): string {
  const version = field(JSON.parse(packageJson), "version");
  if (typeof version !== "string" || !BUNDLE_VERSION.test(version)) {
    throw new Error(
      "package.json's version must be MAJOR.MINOR.PATCH, such as 1.4.2, and nothing more",
    );
  }
  return version;
}
