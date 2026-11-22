import { createConfirm, type ConfirmOptions } from '@ui-sdk/solid/alert-dialog';

// One shared question dialog for every destructive action; BoardConfirmDialog renders the answer.
export type BoardConfirmation = ConfirmOptions & { agentConfirm?: string };

export const confirmBoardAction = createConfirm<BoardConfirmation>();
