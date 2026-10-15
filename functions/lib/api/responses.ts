export function jsonError(message: string, status: number, headers?: Record<string, string>): Response {
  return jsonResponse({ error: message, status }, { status, cacheControl: 'no-store', cors: false, headers });
}

/** Done, with nothing to say and nothing to cache. */
export function noContent(): Response {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

export interface JsonResponseOptions {
  status?: number;
  /** Value for the Cache-Control header. Omitted entirely when unset. */
  cacheControl?: string;
  /** Emit `Access-Control-Allow-Origin: *` (default true). */
  cors?: boolean;
  /** Extra headers merged last (can override the defaults above). */
  headers?: Record<string, string>;
}

export function jsonResponse(body: unknown, options: JsonResponseOptions = {}): Response {
  const { status = 200, cacheControl, cors = true, headers } = options;
  const finalHeaders: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (cors) {
    finalHeaders['Access-Control-Allow-Origin'] = '*';
  }
  if (cacheControl) {
    finalHeaders['Cache-Control'] = cacheControl;
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...finalHeaders, ...headers }
  });
}
