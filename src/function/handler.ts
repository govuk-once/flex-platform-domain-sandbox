// The domain's function. The platform puts it behind an API Gateway REST API as a proxy
// integration, so it takes that API's event, which the adapter turns into a request for the app.

import { handle } from "@hono/aws-lambda";

import { createApp } from "./app.ts";

// Written in by the build, from `package.json`.
declare const FLEX_EXAMPLE_VERSION: string;

export const handler = handle(createApp(FLEX_EXAMPLE_VERSION));
