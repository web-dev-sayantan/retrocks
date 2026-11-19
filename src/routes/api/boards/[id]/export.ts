import type { APIHandler } from 'filesystem-routing/api';

import { handleExportRequest } from '../../../../server/export-handler';

export const GET: APIHandler = (event) =>
  handleExportRequest(event.params?.id ?? '', event.request);
