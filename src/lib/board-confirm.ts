import { createConfirm } from '@ui-sdk/solid/alert-dialog';

// One shared question dialog for every destructive action; BoardConfirmDialog renders the answer.
export const confirmBoardAction = createConfirm();
