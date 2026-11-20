import { defineConfig } from 'oxlint';
import solidV2Strict from 'eslint-plugin-solid/configs/v2-strict';

export default defineConfig({
  jsPlugins: [
    'eslint-plugin-solid',
    // Repo-local architecture ratchet rules (#53); every rule was
    // probe-verified to fire on a scratch violation before enabling.
    { name: 'retrocks', specifier: './oxlint/plugins-dev/index.js' },
  ],
  plugins: ['typescript', 'unicorn', 'oxc', 'import', 'jsx-a11y'],
  ignorePatterns: ['**/*.gen.*', 'file-routes.d.ts', 'dist'],
  settings: solidV2Strict.settings,
  rules: {
    ...solidV2Strict.rules,
    'import/no-cycle': 'error',
    'no-unused-vars': 'error',
    'typescript/no-explicit-any': 'error',
    // window.confirm/alert/prompt were replaced by the shared confirm
    // dialog and overlay layer (#45); keep raw browser dialogs out.
    'no-alert': 'error',
    // Core semantic checks; the plugin's other defaults stay on at warn level.
    'jsx-a11y/alt-text': 'error',
    'jsx-a11y/anchor-is-valid': 'error',
    'jsx-a11y/aria-props': 'error',
    'jsx-a11y/role-supports-aria-props': 'error',
    // Solid labels associate with `for=`; oxlint only resolves React's
    // `htmlFor=`, so every repo finding is a probe-verified false positive.
    'jsx-a11y/label-has-associated-control': 'off',
    // role="status" live regions, role="group" visual groupings, and
    // role="img" SVG-icon wrappers are deliberate; the <output>/<fieldset>/
    // <img> swaps the rule demands would change their semantics.
    'jsx-a11y/prefer-tag-over-role': 'off',
    // role="list" on <ul> is the deliberate VoiceOver workaround for
    // list-style:none dropping list semantics; allowed, everything else fires.
    'jsx-a11y/no-redundant-roles': ['error', { ul: ['list'] }],
    // Handlers are scoped to real interaction events: HTML5 drag targets
    // must carry onDrag*/onDrop on non-interactive containers by design, and
    // onDblClick marks the double-tap edit affordance whose keyboard path is
    // the dedicated Edit control.
    'jsx-a11y/no-noninteractive-element-interactions': [
      'error',
      {
        handlers: [
          'onError',
          'onLoad',
          'onKeyPress',
          'onKeyDown',
          'onKeyUp',
          'onFocus',
          'onBlur',
          'onClick',
        ],
      },
    ],
    'jsx-a11y/no-static-element-interactions': [
      'error',
      {
        handlers: [
          'onKeyPress',
          'onKeyDown',
          'onKeyUp',
          'onFocus',
          'onBlur',
          'onClick',
        ],
      },
    ],
    'jsx-a11y/click-events-have-key-events': 'error',
  },
  overrides: [
    {
      // Production source only: tests and vitest-setup polyfills may assert
      // and reach for raw primitives.
      files: ['src/**/*.{ts,tsx}'],
      excludeFiles: ['**/*.test.*'],
      rules: {
        'typescript/no-non-null-assertion': 'error',
        // Wire payloads are valibot-parsed (#42); object-literal `as T` is
        // exactly the unchecked-cast pattern this bans. `as const` is exempt.
        'typescript/consistent-type-assertions': [
          'error',
          { objectLiteralTypeAssertions: 'never' },
        ],
        // typescript/no-unnecessary-type-assertion needs type information
        // oxlint 1.92 does not have — probe-verified it never fires, so it
        // is scoped out rather than shipped unenforced.
        'retrocks/no-raw-dialog-overlay': 'error',
        'retrocks/no-dialog-open-probe': 'error',
        'retrocks/no-raw-document-keydown': 'error',
        'retrocks/no-raw-wire-literals': 'error',
      },
    },
    {
      // Non-test UI components: ratchet against another monolithic workspace
      // component. Caps sit just above today's measured maxima (largest:
      // BoardWorkspace 1562 lines / 1562-line component / complexity 33) so
      // any growth fails the gate; split the file before raising them.
      files: ['src/components/**/*.tsx'],
      excludeFiles: ['**/*.test.*'],
      rules: {
        'max-lines': ['error', { max: 1600 }],
        'max-lines-per-function': ['error', { max: 1580 }],
        'complexity': ['error', { max: 35 }],
      },
    },
    {
      // UI consumes the Board controller (board-controller) and the permission
      // module, never the transport/store internals behind them. board-actions
      // stays allowed: it is the server-action facade the composition root
      // (BoardWorkspace/BoardCreator) wires into createBoardController.
      files: ['src/components/**/*.{ts,tsx}', 'src/routes/**/*.tsx'],
      excludeFiles: ['**/*.test.*'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['*board-live', '*board-live-protocol', '*board-store', '*board-fixtures'],
                message:
                  'UI components consume the Board controller (src/lib/board-controller.ts), not low-level transport/store internals (#53).',
              },
            ],
          },
        ],
      },
    },
  ],
});
