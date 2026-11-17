// The domain's function. The platform puts it behind an API Gateway REST API as a proxy
// integration, so it takes that API's event and answers with a status, headers and a body.

export interface ProxyEvent {
  readonly httpMethod: string;
  readonly path: string;
}

export interface ProxyResult {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export function handler(event: ProxyEvent): Promise<ProxyResult> {
  return Promise.resolve({
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: "Hello from the example domain",
      method: event.httpMethod,
      path: event.path,
    }),
  });
}
