import { cleanup, render } from '@solidjs/testing-library';
import { createSignal, flush } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';

import { useBoardWorkspace } from './BoardWorkspaceContext';
import { TestBoardWorkspace } from '../lib/board-workspace-test-helper';

afterEach(() => {
  cleanup();
});

describe('BoardWorkspaceContext', () => {
  it('throws a clear error when useBoardWorkspace is called outside a provider', () => {
    function OrphanConsumer() {
      const workspace = useBoardWorkspace();
      return <span>{workspace.isLocked ? 'locked' : 'open'}</span>;
    }

    expect(() => render(() => <OrphanConsumer />)).toThrow(
      /BoardWorkspaceContext provider/i,
    );
  });

  it('propagates reactive getter updates without remounting consumers', () => {
    const [isLocked, setIsLocked] = createSignal(false);
    const [isBlurred, setIsBlurred] = createSignal(false);
    const [blindVoting, setBlindVoting] = createSignal(false);
    let mountCount = 0;

    function StatusConsumer() {
      mountCount += 1;
      const workspace = useBoardWorkspace();
      return (
        <output>
          {workspace.isLocked ? 'locked' : 'unlocked'}-
          {workspace.isBlurred ? 'private' : 'revealed'}-
          {workspace.blindVoting ? 'blind' : 'open'}
        </output>
      );
    }

    const { getByRole } = render(() => (
      <TestBoardWorkspace
        isLocked={isLocked}
        isBlurred={isBlurred}
        blindVoting={blindVoting}
      >
        <StatusConsumer />
      </TestBoardWorkspace>
    ));
    flush();

    expect(mountCount).toBe(1);
    expect(getByRole('status')).toHaveTextContent('unlocked-revealed-open');

    setIsLocked(true);
    setIsBlurred(true);
    setBlindVoting(true);
    flush();

    expect(mountCount).toBe(1);
    expect(getByRole('status')).toHaveTextContent('locked-private-blind');
  });
});
