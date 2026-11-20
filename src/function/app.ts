// The domain's routes. The platform forwards a request with the path after `/app/example`, so
// `/app/example/hello` arrives here as `/hello`.

import { Hono } from "hono";

const NOT_FOUND = { message: "Not found", type: "client_error" };
const SERVER_ERROR = { message: "Internal server error", type: "server_error" };

/** The app, answering with the version of the bundle it was built into. */
export function createApp(version: string): Hono {
  const app = new Hono();

  app.get("/hello", (c) =>
    c.json({ message: "Hello from the example domain", version }),
  );

  app.get("/hello/:name", (c) =>
    c.json({
      message: `Hello, ${c.req.param("name")}, from the example domain`,
      version,
    }),
  );

  app.get("/ping", (c) => c.json({ message: "pong", version }));

  app.notFound((c) => c.json(NOT_FOUND, 404));

  // The error itself goes to the log, never to the caller.
  app.onError((err, c) => {
    console.error(err);
    return c.json(SERVER_ERROR, 500);
  });

  return app;
}
