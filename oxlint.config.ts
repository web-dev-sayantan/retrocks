import { defineConfig } from 'oxlint';
import solidV2Strict from 'eslint-plugin-solid/configs/v2-strict';

export default defineConfig({
  jsPlugins: ['eslint-plugin-solid'],
  plugins: ['typescript', 'unicorn', 'oxc', 'import', 'jsx-a11y'],
  ignorePatterns: ['**/*.gen.*', 'dist'],
  settings: solidV2Strict.settings,
  rules: {
    ...solidV2Strict.rules,
    'import/no-cycle': 'error',
    'no-unused-vars': 'error',
    'typescript/no-explicit-any': 'error',
    // Core semantic checks; the plugin's other defaults stay on at warn level.
    'jsx-a11y/alt-text': 'error',
    'jsx-a11y/anchor-is-valid': 'error',
    'jsx-a11y/aria-props': 'error',
    'jsx-a11y/role-supports-aria-props': 'error',
    // React-flavored heuristics false-positive on Solid's delegated events and
    // drag targets, and on the deliberate role="list" VoiceOver workaround.
    // TODO(#53): ratchet these back on once the ratchet baseline mechanism lands.
    'jsx-a11y/click-events-have-key-events': 'off',
    'jsx-a11y/label-has-associated-control': 'off',
    'jsx-a11y/no-noninteractive-element-interactions': 'off',
    'jsx-a11y/no-redundant-roles': 'off',
    'jsx-a11y/no-static-element-interactions': 'off',
    'jsx-a11y/prefer-tag-over-role': 'off',
  },
});
