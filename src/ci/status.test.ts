import { assert, describe, expect, it } from "vitest";

import { releaseState, waitForRelease, type WaitOptions } from "./status.ts";

const API = "https://shared.example/ci";
const TOKEN_REQUEST_URL = "https://actions.example/token?api-version=2.0";
// Stand-ins, in no real token's shape.
const REQUEST_TOKEN = "SYNTHETIC_REQUEST_TOKEN";
const JOB_TOKEN = "SYNTHETIC_JOB_TOKEN";

const RELEASE_ID = "0193a1b2-c3d4-7e5f-8a6b-0123456789ab";
const STATUS_URL = `${API}/environments/development/domains/example/releases/${RELEASE_ID}`;

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly redirect: RequestInit["redirect"];
}

function json(status: number, body: unknown, headers = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

type Answer = Response | Error;

// Answers each request in turn, and records what was sent. An error is a request that failed.
function network(answers: readonly Answer[]) {
  const sent: Sent[] = [];
  const remaining = [...answers];
  const fake: typeof fetch = (input, init) => {
    sent.push({
      url:
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers)),
      redirect: init?.redirect,
    });
    const answer = remaining.shift();
    assert(answer !== undefined, "an unexpected request");
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer);
  };
  return { fetch: fake, sent };
}

// A clock that only sleeping moves, so a wait runs at once.
function clock() {
  let time = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => time,
    sleep: (ms: number) => {
      slept.push(ms);
      time += ms;
      return Promise.resolve();
    },
  };
}

function options(fake: typeof fetch, time = clock()): WaitOptions {
  return {
    api: API,
    environment: "development",
    domain: "example",
    tokenRequestUrl: TOKEN_REQUEST_URL,
    tokenRequestToken: REQUEST_TOKEN,
    fetch: fake,
    waitMs: 60_000,
    intervalMs: 5_000,
    now: time.now,
    sleep: time.sleep,
  };
}

const TOKEN_ISSUED = () => json(200, { value: JOB_TOKEN });
const STATE = (status: string, more = {}) =>
  json(200, { releaseId: RELEASE_ID, status, ...more });
// One time of asking: GitHub for the token, then the API.
const asked = (answer: Answer): Answer[] => [TOKEN_ISSUED(), answer];

describe("releaseState", () => {
  it("asks the API for the release by its ID, with the token and nothing else", async () => {
    const { fetch, sent } = network(asked(STATE("queued")));

    const state = await releaseState(RELEASE_ID, options(fetch));

    expect(state).toEqual({ status: "queued" });
    expect(sent[0]?.url).toBe(
      `${TOKEN_REQUEST_URL}&audience=${encodeURIComponent(API)}`,
    );
    expect(sent[1]).toEqual({
      url: STATUS_URL,
      method: "GET",
      headers: { "x-flex-ci-token": JOB_TOKEN },
      // A redirect would carry the token elsewhere.
      redirect: "error",
    });
  });

  it("answers how a release that succeeded went", async () => {
    const { fetch } = network(
      asked(
        STATE("released", {
          functionVersion: "3",
          created: false,
          moved: true,
          attempts: 1,
        }),
      ),
    );

    expect(await releaseState(RELEASE_ID, options(fetch))).toEqual({
      status: "released",
      functionVersion: "3",
      moved: true,
    });
  });

  it("refuses an answer that isn't this release's status", async () => {
    for (const answer of [
      { releaseId: RELEASE_ID, status: "done" },
      { releaseId: RELEASE_ID },
      { releaseId: "0193a1b2-c3d4-7e5f-8a6b-ffffffffffff", status: "released" },
      [],
    ]) {
      const { fetch } = network(asked(json(200, answer)));

      await expect(releaseState(RELEASE_ID, options(fetch))).rejects.toThrow(
        "The pipeline API's answer is not this release's status",
      );
    }
  });

  it("leaves out a step or reason that isn't a short code", async () => {
    const { fetch } = network(
      asked(
        STATE("failed", { step: "update-code", reason: "::error::injected" }),
      ),
    );

    expect(await releaseState(RELEASE_ID, options(fetch))).toEqual({
      status: "failed",
      step: "update-code",
    });
  });

  it("fails with the API's reason and request ID", async () => {
    const { fetch } = network(
      asked(
        json(
          404,
          { message: "Not found", type: "client_error" },
          { "x-correlation-id": "1-00000000-000000000000000000000000" },
        ),
      ),
    );

    await expect(releaseState(RELEASE_ID, options(fetch))).rejects.toThrow(
      "The pipeline API answered 404: Not found (request 1-00000000-000000000000000000000000)",
    );
  });
});

describe("waitForRelease", () => {
  it("asks until the release is live, with a new token each time", async () => {
    const time = clock();
    const { fetch, sent } = network([
      ...asked(STATE("queued")),
      ...asked(STATE("releasing")),
      ...asked(STATE("released", { functionVersion: "3", moved: true })),
    ]);

    const state = await waitForRelease(RELEASE_ID, options(fetch, time));

    expect(state).toEqual({
      status: "released",
      functionVersion: "3",
      moved: true,
    });
    expect(sent.map(({ url }) => url)).toEqual([
      expect.stringContaining(TOKEN_REQUEST_URL),
      STATUS_URL,
      expect.stringContaining(TOKEN_REQUEST_URL),
      STATUS_URL,
      expect.stringContaining(TOKEN_REQUEST_URL),
      STATUS_URL,
    ]);
    expect(time.slept).toEqual([5_000, 5_000]);
  });

  it("answers at once for a version that was already live", async () => {
    const time = clock();
    const { fetch } = network(
      asked(STATE("released", { functionVersion: "3", moved: false })),
    );

    const state = await waitForRelease(RELEASE_ID, options(fetch, time));

    expect(state.moved).toBe(false);
    expect(time.slept).toEqual([]);
  });

  it("asks again after an answer that didn't come", async () => {
    const { fetch } = network([
      ...asked(new TypeError("fetch failed: https://shared.example/SYNTHETIC")),
      ...asked(json(503, { message: "Service unavailable" })),
      ...asked(new Response("<html>Blocked</html>", { status: 429 })),
      ...asked(STATE("released", { moved: true })),
    ]);

    const state = await waitForRelease(RELEASE_ID, options(fetch));

    expect(state.status).toBe("released");
  });

  it("fails at once for a release the platform refused, failed at or gave up", async () => {
    const stopped = [
      [
        STATE("refused", { step: "check-order", reason: "superseded" }),
        "The platform refused the release (step check-order, reason superseded): a later version, or a release asked for later, is live",
      ],
      [
        STATE("refused", { step: "check-bundle", reason: "hash" }),
        "The platform refused the release (step check-bundle, reason hash), and won't try it again",
      ],
      [
        STATE("failed", { step: "update-code", reason: "TooManyRequests" }),
        "The release failed (step update-code, reason TooManyRequests). The platform will try it again later, and this job doesn't wait for that",
      ],
      [
        STATE("abandoned"),
        "The platform gave the release up. Run the pipeline again once the cause is fixed",
      ],
    ] as const;
    for (const [answer, message] of stopped) {
      const time = clock();
      const { fetch } = network(asked(answer));

      await expect(
        waitForRelease(RELEASE_ID, options(fetch, time)),
      ).rejects.toMatchObject({ message });
      expect(time.slept).toEqual([]);
    }
  });

  it("fails at once for an answer that is the API's refusal", async () => {
    const { fetch, sent } = network(
      asked(json(403, { message: "Forbidden", type: "auth_error" })),
    );

    await expect(waitForRelease(RELEASE_ID, options(fetch))).rejects.toThrow(
      "The pipeline API answered 403: Forbidden",
    );
    expect(sent).toHaveLength(2);
  });

  it("stops waiting when the wait is over, and says how the release was", async () => {
    const time = clock();
    // Asked at 0, 5, 10, 15 and 20 seconds: a sixth time would be after the 20 seconds are up.
    const { fetch, sent } = network([
      ...asked(STATE("queued")),
      ...asked(STATE("releasing")),
      ...asked(json(500, { message: "Internal server error" })),
      ...asked(STATE("releasing")),
      ...asked(STATE("releasing")),
    ]);

    await expect(
      waitForRelease(RELEASE_ID, {
        ...options(fetch, time),
        waitMs: 20_000,
      }),
    ).rejects.toMatchObject({
      message:
        "The release isn't live after 0 minutes: it is still releasing. It may yet finish",
    });
    expect(sent).toHaveLength(10);
    expect(time.slept).toEqual([5_000, 5_000, 5_000, 5_000]);
  });

  it("says so when the API never answered", async () => {
    const { fetch } = network([
      ...asked(json(500, { message: "Internal server error" })),
      ...asked(json(500, { message: "Internal server error" })),
    ]);

    await expect(
      waitForRelease(RELEASE_ID, { ...options(fetch), waitMs: 5_000 }),
    ).rejects.toThrow("the pipeline API gave no answer");
  });

  it("never puts the token or a failed request's address in an error", async () => {
    const failures: Answer[][] = [
      asked(json(403, { message: "Forbidden" })),
      [
        ...asked(new TypeError("fetch failed: SYNTHETIC")),
        ...asked(new TypeError("fetch failed: SYNTHETIC")),
      ],
    ];
    for (const answers of failures) {
      const { fetch } = network(answers);

      await expect(
        waitForRelease(RELEASE_ID, { ...options(fetch), waitMs: 5_000 }),
      ).rejects.toSatisfy(
        (error) =>
          error instanceof Error && !error.message.includes("SYNTHETIC"),
      );
    }
  });
});
