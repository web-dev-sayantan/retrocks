import { Title } from '@solidjs/meta';
import type { RouteDefinition } from '@solidjs/router';
import { httpStatus } from '@solidjs/web';

import PageMessage from '../components/PageMessage';
import { paths } from '../router';

export const route = {
  preload: () => httpStatus(404),
} satisfies RouteDefinition;

export default function NotFound() {
  return (
    <>
      <Title>Page Not Found — Retrocks</Title>
      <PageMessage title="Page not found" message="Check the address or return to Retrocks to create a Board.">
        <a href={paths()} class="page-message-action">Back to Retrocks</a>
      </PageMessage>
    </>
  );
}
