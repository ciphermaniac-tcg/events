/** Every Pages Function the site has, routed in the browser (routes.ts). */

import { type FunctionModule, routerFor } from './routes';

const modules = import.meta.glob<FunctionModule>(['../../functions/api/**/*.ts', '!**/_middleware.ts'], {
  eager: true
});

export const route = routerFor(
  Object.fromEntries(Object.entries(modules).map(([file, module]) => [file.replace('../../functions', ''), module]))
);
