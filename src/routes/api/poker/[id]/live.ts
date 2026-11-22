import type { APIHandler } from 'filesystem-routing/api';

import { handlePokerLiveRequest } from '../../../../server/poker/service';

const handle: APIHandler = (event) =>
  handlePokerLiveRequest(event.params?.id ?? '', event.request);

export const GET = handle;
export const POST = handle;
