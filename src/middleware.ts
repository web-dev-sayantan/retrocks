import type { StartMiddleware } from '@solidjs/vite-plugin';
import { createAPIHandler } from 'filesystem-routing/api';
import routes from 'virtual:file-routes';

import { securityHeadersMiddleware } from './server/security-headers';

export default [
  securityHeadersMiddleware,
  createAPIHandler(routes),
] satisfies StartMiddleware[];
