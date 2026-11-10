/** Pages' static _headers do not cover Functions responses. */
interface MiddlewareContext {
  request: Request;
  next: () => Promise<Response>;
}

/** The one route the scheduled sweep calls at the Pages address, with its token (.github/workflows/tournament-idle.yml). */
const SWEEP_PATH = '/api/tournaments/idle';

/**
 * Whether a request came in at a Pages address (*.pages.dev), which serves
 * the same Functions and bindings as the site's own domain but without its
 * bot and firewall rules. Only the sweep is answered there.
 */
export function offDomain(url: URL): boolean {
  return url.hostname.replace(/\.$/, '').endsWith('.pages.dev') && url.pathname !== SWEEP_PATH;
}

export async function onRequest(context: MiddlewareContext): Promise<Response> {
  const response = offDomain(new URL(context.request.url))
    ? new Response('Not found', { status: 404 })
    : await context.next();
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Strict-Transport-Security', 'max-age=31536000');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
