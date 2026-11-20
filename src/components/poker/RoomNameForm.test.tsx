import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { createRouter, formAction, memoryHistory } from '@solidjs/router';
import { createAgent } from '@ui-sdk/solid/agent';
import { afterEach, expect, test } from 'vitest';

import RoomNameForm from './RoomNameForm';

const agent = createAgent();
afterEach(cleanup);

test('chooses a Display Name and joins a Room from the named form controls', async () => {
  const submitted: FormDataEntryValue[] = [];
  const join = formAction(async (form: FormData) => {
    const name = form.get('displayName');
    if (name !== null) submitted.push(name);
  }, 'test-join-room');
  const Router = createRouter({
    history: memoryHistory('/'),
    routes: [{
      path: '/',
      component: () => (
        <RoomNameForm heading="Join Pointing Poker" submitLabel="Join Room" action={join} />
      ),
    }],
  });
  render(() => <Router />);

  expect(screen.getByRole('textbox', { name: 'Display Name' }))
    .toHaveAccessibleDescription('Others in this Room can see your Display Name. Use your name or an alias.');
  const controls = agent.snapshot().filter((entry) => !entry.offPage && entry.component !== 'more');
  expect(controls.every((entry) => Boolean(entry.label))).toBe(true);
  expect(controls.map((entry) => entry.label)).toEqual(expect.arrayContaining(['Display Name', 'Join Room']));
  const result = await agent.act({ steps: [
    { ref: 'Display Name', action: 'setValue', args: ['Sam'] },
    { ref: 'Join Room', action: 'press' },
  ] });
  expect(result.ok, result.error?.message).toBe(true);
  await waitFor(() => expect(submitted).toEqual(['Sam']));
});
