import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "./app.ts";

const VERSION = "1.4.2";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createApp", () => {
  it("says hello, with its version", async () => {
    const response = await createApp(VERSION).request("/hello");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({
      message: "Hello from the example domain",
      version: VERSION,
    });
  });

  it("says hello by name", async () => {
    const response = await createApp(VERSION).request("/hello/Ada");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: "Hello, Ada, from the example domain",
      version: VERSION,
    });
  });

  it("answers a ping, with its version", async () => {
    const response = await createApp(VERSION).request("/ping");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: "pong",
      version: VERSION,
    });
  });

  it.each([
    ["a path it has no route for", "GET", "/goodbye"],
    ["a method it has no route for", "POST", "/hello"],
  ])("answers 404 for %s", async (_, method, path) => {
    const response = await createApp(VERSION).request(path, { method });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      message: "Not found",
      type: "client_error",
    });
  });

  it("answers 500 for a route that throws, saying nothing of why", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = createApp(VERSION);
    app.get("/fail", () => {
      throw new Error("SYNTHETIC failure");
    });

    const response = await app.request("/fail");

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      message: "Internal server error",
      type: "server_error",
    });
    expect(body).not.toContain("SYNTHETIC");
  });
});
