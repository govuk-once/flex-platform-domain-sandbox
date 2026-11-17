import { describe, expect, it } from "vitest";

import { handler } from "./handler.ts";

describe("handler", () => {
  it("answers 200 with JSON that names the request", async () => {
    const result = await handler({ httpMethod: "GET", path: "/hello" });

    expect(result.statusCode).toBe(200);
    expect(result.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(result.body)).toEqual({
      message: "Hello from the example domain",
      method: "GET",
      path: "/hello",
    });
  });
});
