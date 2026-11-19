import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
import { render } from '@solidjs/testing-library';
import { flush } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { tokenizeCardText } from '../lib/card-text';
import CardText from './CardText';

describe('tokenizeCardText & <CardText />', () => {
  it('preserves line breaks and renders plain text safely', () => {
    const { container } = render(() => (
      <CardText text={'Line one\nLine two\r\nLine three'} />
    ));
    flush();

    expect(container.querySelectorAll('br')).toHaveLength(2);
    expect(container.textContent).toBe('Line oneLine twoLine three');
  });

  it('auto-links http:// and https:// URLs with safe rel/target and trims trailing punctuation', () => {
    const { container, getByRole } = render(() => (
      <CardText text="See (https://retrocks.app/docs/guide). Also https://en.wikipedia.org/wiki/Solid_(web_framework)!" />
    ));
    flush();

    const links = container.querySelectorAll('a');
    expect(links).toHaveLength(2);

    const first = getByRole('link', {
      name: 'https://retrocks.app/docs/guide',
    });
    expect(first).toHaveAttribute('href', 'https://retrocks.app/docs/guide');
    expect(first).toHaveAttribute('target', '_blank');
    expect(first).toHaveAttribute('rel', 'noopener noreferrer');

    const second = getByRole('link', {
      name: 'https://en.wikipedia.org/wiki/Solid_(web_framework)',
    });
    expect(second).toHaveAttribute(
      'href',
      'https://en.wikipedia.org/wiki/Solid_(web_framework)',
    );
    expect(container.textContent).toBe(
      'See (https://retrocks.app/docs/guide). Also https://en.wikipedia.org/wiki/Solid_(web_framework)!',
    );
  });

  it('renders inline backtick code spans without auto-linking URLs inside code', () => {
    const { container } = render(() => (
      <CardText text="Run `curl https://internal.local/health` before deploy `pnpm test`" />
    ));
    flush();

    const codes = container.querySelectorAll('code');
    expect(codes).toHaveLength(2);
    expect(codes[0].textContent).toBe('curl https://internal.local/health');
    expect(codes[1].textContent).toBe('pnpm test');
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });

  it('neutralizes raw HTML tags and non-http(s) URL schemes as plain escaped text', () => {
    const xssPayload =
      '<script>alert(1)</script> <img src=x onerror=alert(2)> javascript:alert(3) data:text/html,<svg/onload=alert(4)>';

    const tokens = tokenizeCardText(xssPayload);
    expect(tokens.every((t) => t.type === 'text')).toBe(true);

    const { container } = render(() => <CardText text={xssPayload} />);
    flush();

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe(xssPayload);
  });

  it('leaves unmatched or empty backticks as plain text', () => {
    expect(tokenizeCardText("It's `unclosed").every((t) => t.type === 'text')).toBe(
      true,
    );
    expect(tokenizeCardText('Empty `` pair').every((t) => t.type === 'text')).toBe(
      true,
    );
  });

  it('renders with zero Solid 2.0 reactivity diagnostics', async () => {
    const { artifact } = await captureArtifact(
      () => {
        render(() => (
          <CardText text={'Check `npm run build`\nhttps://example.com'} />
        ));
        flush();
      },
      { scenario: 'card-text-render' },
    );
    expectNoDiagnostics(artifact);
  });
});
