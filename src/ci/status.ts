// Asks the platform how a release went, and waits for it to be live. Each time is two requests:
// GitHub, for a new token, since one lasts minutes and a release can take longer, and the
// pipeline API.

import {
  API_TIMEOUT_MS,
  field,
  jobToken,
  refusal,
  type UploadOptions,
} from "./upload.ts";

// `queued` and `releasing` are on their way. `released` and `refused` are final. `failed` will be
// tried again by the platform, and `abandoned` was tried as often as it tries.
const STATUSES = [
  "queued",
  "releasing",
  "released",
  "failed",
  "refused",
  "abandoned",
] as const;

export type ReleaseStatus = (typeof STATUSES)[number];

export interface ReleaseState {
  readonly status: ReleaseStatus;
  /** For a release that stopped: the step, and the platform's fixed code for why. */
  readonly step?: string;
  readonly reason?: string;
  /** For a release that succeeded: the function version `live` points at. */
  readonly functionVersion?: string;
  /** For a release that succeeded: `false` when `live` was already at this version's code. */
  readonly moved?: boolean;
}

// The answer wasn't the API's, or the API failed. Asking again may get one.
class Unavailable extends Error {}

/** How the release is now, as the platform's release table has it. */
export async function releaseState(
  releaseId: string,
  options: UploadOptions,
): Promise<ReleaseState> {
  const send = options.fetch ?? fetch;
  const token = await jobToken(send, options);
  let response: Response;
  try {
    response = await send(
      `${options.api}/environments/${options.environment}/domains/${options.domain}/releases/${releaseId}`,
      {
        // No body, so no content type and no hash of one.
        headers: { "x-flex-ci-token": token },
        // A redirect would carry the token to wherever it pointed.
        redirect: "error",
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      },
    );
  } catch {
    // Nothing of the error: a failed request's can hold its address.
    throw new Unavailable("The pipeline API could not be reached");
  }
  if (response.status === 429 || response.status >= 500) {
    throw new Unavailable(await refusal(response));
  }
  if (response.status !== 200) {
    throw new Error(await refusal(response));
  }

  const answer: unknown = await response.json();
  const status = STATUSES.find((known) => known === field(answer, "status"));
  if (field(answer, "releaseId") !== releaseId || status === undefined) {
    throw new Error("The pipeline API's answer is not this release's status");
  }
  const step = code(field(answer, "step"));
  const reason = code(field(answer, "reason"));
  const functionVersion = code(field(answer, "functionVersion"));
  const moved = field(answer, "moved");
  return {
    status,
    ...(step !== undefined && { step }),
    ...(reason !== undefined && { reason }),
    ...(functionVersion !== undefined && { functionVersion }),
    ...(typeof moved === "boolean" && { moved }),
  };
}

export interface WaitOptions extends UploadOptions {
  /** How long to wait for the release to be live, in milliseconds. */
  readonly waitMs: number;
  /** How long to leave between asking, in milliseconds. */
  readonly intervalMs: number;
  /** Replace the clock in tests. */
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Asks until the release is live, and answers how it went. Throws when the platform refused it,
 * failed at it or gave it up, and when it isn't live within the wait.
 */
export async function waitForRelease(
  releaseId: string,
  options: WaitOptions,
): Promise<ReleaseState> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + options.waitMs;

  let last: ReleaseState | undefined;
  for (;;) {
    try {
      last = await releaseState(releaseId, options);
    } catch (error) {
      // One answer that didn't come is no reason to give up on a release that is under way.
      if (!(error instanceof Unavailable)) throw error;
    }
    if (last?.status === "released") return last;
    if (
      last !== undefined &&
      last.status !== "queued" &&
      last.status !== "releasing"
    ) {
      throw new Error(stopped(last));
    }
    if (now() + options.intervalMs > deadline) {
      const minutes = Math.round(options.waitMs / 60_000);
      throw new Error(
        `The release isn't live after ${minutes} minutes: ${
          last === undefined
            ? "the pipeline API gave no answer"
            : `it is still ${last.status}`
        }. It may yet finish`,
      );
    }
    await sleep(options.intervalMs);
  }
}

function stopped(state: ReleaseState): string {
  const why = [
    state.step === undefined ? "" : `step ${state.step}`,
    state.reason === undefined ? "" : `reason ${state.reason}`,
  ]
    .filter((part) => part !== "")
    .join(", ");
  const detail = why === "" ? "" : ` (${why})`;
  switch (state.status) {
    case "refused":
      return state.reason === "superseded"
        ? `The platform refused the release${detail}: a later version, or a release asked for later, is live`
        : `The platform refused the release${detail}, and won't try it again`;
    case "abandoned":
      return `The platform gave the release up${detail}. Run the pipeline again once the cause is fixed`;
    default:
      // The platform tries a failed release again, but not soon enough for a job to wait for.
      return `The release failed${detail}. The platform will try it again later, and this job doesn't wait for that`;
  }
}

// A step, a reason or a function version is a short code. Anything else isn't printed.
function code(value: unknown): string | undefined {
  return typeof value === "string" && /^[\w.-]{1,64}$/.test(value)
    ? value
    : undefined;
}
