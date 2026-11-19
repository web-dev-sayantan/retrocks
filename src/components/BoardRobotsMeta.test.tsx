import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { render } from '@solidjs/testing-library';
import { createSignal, flush } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';

import BoardRobotsMeta from './BoardRobotsMeta';

afterEach(() => {
  for (const el of document.head.querySelectorAll('meta[name="robots"]')) {
    el.remove();
  }
});

describe('<BoardRobotsMeta />', () => {
  it('renders noindex, nofollow meta tag on /b/* routes and omits it elsewhere', async () => {
    const [pathname, setPathname] = createSignal('/');
    render(() => <BoardRobotsMeta pathname={pathname()} />);
    flush();
    await Promise.resolve();

    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();

    setPathname('/b/abc123');
    flush();
    await Promise.resolve();

    const meta = document.head.querySelector('meta[name="robots"]');
    expect(meta).not.toBeNull();
    expect(meta).toHaveAttribute('content', 'noindex, nofollow');

    setPathname('/board-info');
    flush();
    await Promise.resolve();

    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it('toggles meta tag with zero Solid 2.0 reactivity diagnostics', async () => {
    const { artifact } = await captureArtifact(
      async () => {
        const [pathname, setPathname] = createSignal('/');
        render(() => <BoardRobotsMeta pathname={pathname()} />);
        flush();
        await Promise.resolve();
        setPathname('/b/xyz789');
        flush();
        await Promise.resolve();
        expect(
          document.head.querySelector('meta[name="robots"]'),
        ).toHaveAttribute('content', 'noindex, nofollow');
      },
      { scenario: 'board-robots-meta-toggle' },
    );
    expectNoDiagnostics(artifact);
  });
});
