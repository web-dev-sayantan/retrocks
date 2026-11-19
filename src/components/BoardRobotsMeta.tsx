import { Meta } from '@solidjs/meta';
import { Show } from 'solid-js';

import { isBoardPathname } from '../lib/routes';

export default function BoardRobotsMeta(props: { pathname: string }) {
  return (
    <Show when={isBoardPathname(props.pathname)}>
      <Meta name="robots" content="noindex, nofollow" />
    </Show>
  );
}
