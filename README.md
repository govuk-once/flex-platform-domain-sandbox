# flex-platform-domain-sandbox

The Flex platform team's sandbox, for testing how a domain is deployed and for developing the
domain SDK. It is a domain as a domain team would write one: a Lambda function, and the
pipeline that uploads its code. The platform's `platform-dev` stage hosts it as the `example`
domain.

## Working here

Use Node 24 (`.nvmrc`) and the pnpm version pinned in `package.json`.

```bash
pnpm install          # install dependencies
pnpm lint             # eslint, with the platform's base rules
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run
pnpm build            # bundle the function and write dist/bundle.zip
```

tsx runs the build and upload scripts from their TypeScript, so nothing is compiled but the
function's bundle.

| Path | What it holds |
|---|---|
| `src/function/handler.ts` | The function. It takes API Gateway's proxy event. |
| `src/build/build.ts` | `buildFunction`, which bundles the function with esbuild into one `index.js`. |
| `src/build/zip.ts` | Writes the zip, the same bytes for the same code. |
| `src/build/bundle.ts` | `pnpm build`: writes `dist/bundle.zip`. |
| `src/ci/upload.ts` | Uploads a bundle through the platform's pipeline API. |
| `src/ci/main.ts` | `pnpm run upload`: uploads `dist/bundle.zip`, from a GitHub Actions job. |

## The pipeline

`.github/workflows/ci.yml` runs the checks and builds the bundle for every pull request and
every push to `main`. A push to `main` then uploads the bundle to the platform's `development`
environment.

The upload job holds no AWS credentials. It asks GitHub for a token that says which repository
and GitHub environment the job runs in, and sends it to the platform's pipeline API with the
bundle's SHA-256 and size. The API answers with one request the job may make of S3, and the job
sends the bundle there. The platform keeps a bundle under its hash, so uploading the same code
again changes nothing.

The platform decides whether to take an upload from three things, none of them a secret:

- **The repository.** The platform's config registers this repository, by GitHub's IDs for it
  and its owner, as the one that may release `example`.
- **The GitHub environment.** The job runs in the GitHub environment `development`, named for
  the platform's. Who may run a job there is set in this repository's settings, under
  Environments.
- **The address.** The token is made out to the pipeline API's address, `FLEX_CI_API` in the
  workflow, and is good nowhere else.

`pnpm run upload` works only in such a job: GitHub issues the token nowhere else.
