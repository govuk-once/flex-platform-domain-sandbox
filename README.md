# flex-platform-domain-sandbox

The Flex platform team's sandbox, for testing how a domain is deployed and for developing the
domain SDK. It is a domain as a domain team would write one: a Lambda function, and the
pipeline that uploads and releases its code. The platform's `platform-dev` stage hosts it as the
`example` domain.

## Working here

Use Node 24 (`.nvmrc`) and the pnpm version pinned in `package.json`.

```bash
pnpm install          # install dependencies
pnpm lint             # eslint, with the platform's base rules
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run
pnpm build            # bundle the function and write dist/bundle.zip
```

tsx runs the build and release scripts from their TypeScript, so nothing is compiled but the
function's bundle.

| Path | What it holds |
|---|---|
| `src/function/handler.ts` | The function. It takes API Gateway's proxy event. |
| `src/build/build.ts` | `buildFunction`, which bundles the function with esbuild into one `index.js`. |
| `src/build/zip.ts` | Writes the zip, the same bytes for the same code. |
| `src/build/bundle.ts` | `pnpm build`: writes `dist/bundle.zip`. |
| `src/ci/version.ts` | Reads the bundle's version from `package.json`. |
| `src/ci/upload.ts` | Uploads a bundle through the platform's pipeline API. |
| `src/ci/release.ts` | Asks the platform to release an uploaded version. |
| `src/ci/status.ts` | Asks the platform how a release went, and waits for it to be live. |
| `src/ci/main.ts` | `pnpm run release`: uploads `dist/bundle.zip`, releases it and waits for it to be live, from a GitHub Actions job. |

## The pipeline

`.github/workflows/ci.yml` runs the checks and builds the bundle for every pull request and
every push to `main`. A push to `main` then uploads the bundle to the platform's `development`
environment, releases it there and waits for it to be live.

The release job holds no AWS credentials. It asks GitHub for a token that says which repository
and GitHub environment the job runs in, and sends it to the platform's pipeline API with the
bundle's [version](#the-version), SHA-256 and size. The API answers with one request the job may
make of S3, and the job sends the bundle there. Where the platform holds the bundle already, the
API says so and the job sends nothing.

The job then asks the API to release the version. The API queues the release and answers at once
with the release's ID, and the platform creates or updates the domain's function, publishes a
version of it and points `live` at it in the background.

The job asks the API how the release went, every five seconds, until it is live. It fails when
the platform refused the release, failed at it or gave it up, with the step and the platform's
code for why. A release takes seconds, or minutes the first time, so the job stops waiting after
17 minutes and fails, saying how the release was. The release may still finish after that.

Running the pipeline again for the same version and code fails nothing. The upload finds the
bundle there, and the release finds the version live and changes nothing, so the job says there
was nothing to do.

### The version

The bundle is uploaded as the `version` in `package.json`: `MAJOR.MINOR.PATCH` and nothing more,
with no `v`, no pre-release and no build metadata. The platform records which bundle a version
names and never changes it. So:

- **A change to the bundle needs a new version.** Without one, the upload on `main` fails with
  `This version is already a different bundle`. Anything that changes the bundle's bytes counts,
  an esbuild upgrade included. A change that leaves the bundle as it was, such as one to this
  file, needs none.
- **Versions only go up.** Once a version is live, the platform refuses the release of an earlier
  one as `superseded`, so running an old run again fails once a later version is live.

The platform decides whether to take an upload or a release from three things, none of them a secret:

- **The repository.** The platform's config registers this repository, by GitHub's IDs for it
  and its owner, as the one that may release `example`.
- **The GitHub environment.** The job runs in the GitHub environment `development`, named for
  the platform's. Who may run a job there is set in this repository's settings, under
  Environments.
- **The address.** The token is made out to the pipeline API's address, `FLEX_CI_API` in the
  workflow, and is good nowhere else.

`pnpm run release` works only in such a job: GitHub issues the token nowhere else.
