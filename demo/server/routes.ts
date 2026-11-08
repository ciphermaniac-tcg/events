/**
 * Routing the Pages Functions as Cloudflare routes them from their file
 * paths: `[name]` is a parameter, `index` the directory itself, and a literal
 * path wins over one with parameters. Given the modules by file (router.ts
 * collects them), answers a request with the handler its method names.
 */

import type { TournamentEnv } from '../../functions/lib/auth/env';

type Handler = (context: unknown) => Promise<Response> | Response;
/** A function's module: its exports, of which the onRequest* ones are handlers. */
export type FunctionModule = Record<string, unknown>;

const METHODS: Record<string, string> = {
  GET: 'onRequestGet',
  HEAD: 'onRequestGet',
  POST: 'onRequestPost',
  PUT: 'onRequestPut',
  PATCH: 'onRequestPatch',
  DELETE: 'onRequestDelete'
};

function handlerOf(module: FunctionModule, method: string): Handler | null {
  const found = module[METHODS[method] ?? ''] ?? module.onRequest;
  return typeof found === 'function' ? (found as Handler) : null;
}

interface Route {
  pattern: RegExp;
  names: string[];
  module: FunctionModule;
}

/** A route from a module's path under `root` (`/api/tournaments/[code]/index.ts`). */
function routeOf(path: string, module: FunctionModule): Route {
  const names: string[] = [];
  const source = path
    .replace(/\.ts$/, '')
    .replace(/\/index$/, '')
    .replace(/\[([^\]]+)\]/g, (_, name: string) => {
      names.push(name);
      return '([^/]+)';
    });
  return { pattern: new RegExp(`^${source}$`), names, module };
}

export type Router = (request: Request, env: TournamentEnv) => Promise<Response>;

/** A router over `modules`, keyed by each module's path from the functions directory (`/api/...`). */
export function routerFor(modules: Record<string, FunctionModule>): Router {
  const routes = Object.entries(modules)
    .map(([path, module]) => routeOf(path, module))
    .sort((a, b) => a.names.length - b.names.length);
  return async (request, env) => {
    const path = new URL(request.url).pathname;
    for (const { pattern, names, module } of routes) {
      const match = pattern.exec(path);
      if (!match) {
        continue;
      }
      const handler = handlerOf(module, request.method);
      if (!handler) {
        return new Response(null, { status: 405 });
      }
      const params = Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(match[i + 1] ?? '')]));
      // Work a function leaves running past its answer is done before the answer is handed back.
      const waits: Promise<unknown>[] = [];
      try {
        const response = await handler({
          request,
          env,
          params,
          waitUntil: (work: Promise<unknown>) => waits.push(work)
        });
        await Promise.allSettled(waits);
        return response;
      } catch (error) {
        // A function that throws answers 500, as it does on Cloudflare, with the error in the console.
        console.error(error);
        return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
      }
    }
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  };
}
