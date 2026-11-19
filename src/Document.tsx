import { HydrationScript, getRequestEvent } from '@solidjs/web';
import type { ParentProps } from 'solid-js';

import { THEME_INIT_SCRIPT } from './lib/theme';

function getScriptNonce(): string | undefined {
  const nonce = getRequestEvent()?.nonce;
  if (typeof nonce === 'string') {
    return nonce;
  }
  if (nonce && typeof nonce.script === 'string') {
    return nonce.script;
  }
  return undefined;
}

// Document shell (index.html replacement). Runs on the server only and ships
// no client JS. The inline script applies the saved or system theme before
// first paint to prevent FOUC, using the per-request CSP script nonce.
export default function Document(props: ParentProps) {
  const scriptNonce = getScriptNonce();

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
        <title>Retrocks</title>
        {/* eslint-disable-next-line solid/no-innerhtml */}
        <script nonce={scriptNonce} innerHTML={THEME_INIT_SCRIPT} />
        <HydrationScript nonce={scriptNonce} />
      </head>
      <body class="bg-canvas text-text antialiased">{props.children}</body>
    </html>
  );
}
