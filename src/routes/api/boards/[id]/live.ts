import type { APIHandler } from 'filesystem-routing/api';

import { handleLiveRequest } from '../../../../server/live-handler';

const handle: APIHandler = (event) =>
  handleLiveRequest(event.params?.id ?? '', event.request);

export const GET = handle;
export const POST = handle;
