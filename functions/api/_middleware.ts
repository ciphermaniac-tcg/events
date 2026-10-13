/** Pages' static _headers do not cover Functions responses. */
interface MiddlewareContext {
  next: () => Promise<Response>;
}

export async function onRequest(context: MiddlewareContext): Promise<Response> {
  const response = await context.next();
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Strict-Transport-Security', 'max-age=31536000');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
