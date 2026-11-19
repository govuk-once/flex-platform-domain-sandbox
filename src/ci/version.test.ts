import { describe, expect, it } from "vitest";

import { bundleVersion } from "./version.ts";

describe("bundleVersion", () => {
  it("answers the version package.json holds", () => {
    expect(bundleVersion('{ "name": "a", "version": "1.10.0" }')).toBe(
      "1.10.0",
    );
    expect(bundleVersion('{ "version": "0.0.0" }')).toBe("0.0.0");
  });

  it("refuses anything the platform wouldn't take as a version", () => {
    for (const version of [
      "v1.4.2",
      "1.4",
      "1.4.2-rc.1",
      "1.4.2+abc",
      "01.4.2",
      "1.4.2 ",
      "1234567890.0.0",
      142,
      undefined,
    ]) {
      expect(() => bundleVersion(JSON.stringify({ version }))).toThrow(
        "package.json's version must be MAJOR.MINOR.PATCH",
      );
    }
  });
});
