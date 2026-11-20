import { MenuContent, type MenuContentProps, type MenuContentState } from '@ui-sdk/solid/menu';
import type { PartProps } from '@ui-sdk/solid/primitive';

interface BoardMenuContentProps
  extends PartProps<'div', MenuContentState>,
    MenuContentProps {
  'aria-label': string;
}

// Every Board menu surface: named for assistive tech, registered as an open
// Board overlay, and excluded from print. Placement defaults match the
// anchored board popovers; pass side/sideOffset to override.
export default function BoardMenuContent(props: BoardMenuContentProps) {
  return (
    <MenuContent
      side="bottom"
      align="end"
      sideOffset={6}
      collisionPadding={12}
      {...props}
      render={(contentProps) => (
        <div
          {...contentProps}
          aria-labelledby={undefined}
          aria-label={props['aria-label']}
          data-board-overlay="true"
          data-print-hide="true"
        />
      )}
    />
  );
}
