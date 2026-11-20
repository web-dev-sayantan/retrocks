/**
 * Repo-local oxlint JS plugin (#53): architectural ratchet rules that keep the
 * refactored Board client layered. Loaded from `jsPlugins` in oxlint.config.ts
 * (oxlint >= 1.92 JS-plugin loader); every rule was probe-verified to fire on
 * a scratch violation before being enabled.
 *
 * Exemptions shared by all rules: test files and vitest-setup.ts (overlay
 * polyfills / fixtures may touch the raw primitives).
 */

const DRAG_MIME_LITERALS = new Set([
  'application/x-retrocks-card',
  'application/x-retrocks-group',
]);

const KEY_EVENT_TYPES = new Set(['keydown', 'keyup', 'keypress']);

/** True when the file is linted by the architecture ratchet. */
function isLintable(filename) {
  const file = filename.replace(/\\/g, '/');
  return !/\.test\.[tj]sx?$/.test(file) && !file.endsWith('vitest-setup.ts');
}

/** True when the file is the single owner of a wire-literal family. */
function isOwningModule(filename, ownedPathSuffix) {
  return filename.replace(/\\/g, '/').endsWith(ownedPathSuffix);
}

/** Unwrap `a?.b` chains so member rules see the underlying MemberExpression. */
function unwrapChain(node) {
  return node !== undefined && node !== null && node.type === 'ChainExpression'
    ? node.expression
    : node;
}

function memberCallee(callee) {
  const member = unwrapChain(callee);
  if (member === null || member === undefined || member.type !== 'MemberExpression') {
    return null;
  }
  const property = member.computed
    ? member.property.type === 'Literal' ? String(member.property.value) : ''
    : member.property.type === 'Identifier' ? member.property.name : '';
  const object = unwrapChain(member.object);
  const objectName = object !== null && object !== undefined && object.type === 'Identifier'
    ? object.name
    : '';
  return { objectName, property };
}

function report(context, node, message) {
  context.report({ node, message });
}

export default {
  meta: { name: 'retrocks' },
  rules: {
    /** Overlays must go through the ui-sdk primitives, never raw <dialog>. */
    'no-raw-dialog-overlay': {
      meta: { type: 'problem', docs: { description: 'Ban raw <dialog> JSX and .showModal() calls; overlays go through @ui-sdk/solid.' } },
      create(context) {
        if (!isLintable(context.filename)) return {};
        return {
          JSXOpeningElement(node) {
            if (node.name.type === 'JSXIdentifier' && node.name.name === 'dialog') {
              report(
                context,
                node,
                'Raw <dialog> JSX is banned (#53); render overlays through @ui-sdk/solid Dialog/Drawer instead.',
              );
            }
          },
          CallExpression(node) {
            const callee = memberCallee(node.callee);
            if (callee !== null && callee.property === 'showModal') {
              report(
                context,
                node,
                'Raw .showModal() is banned (#53); open overlays through @ui-sdk/solid Dialog/Drawer instead.',
              );
            }
          },
        };
      },
    },

    /** #48 removed the dialog[open] DOM probes; keep them out. */
    'no-dialog-open-probe': {
      meta: { type: 'problem', docs: { description: "Ban 'dialog[open]' DOM probing; overlay state is tracked, not queried." } },
      create(context) {
        if (!isLintable(context.filename)) return {};
        const check = (node, value) => {
          if (typeof value === 'string' && value.includes('dialog[open]')) {
            report(
              context,
              node,
              "'dialog[open]' DOM probing was removed with the ui-sdk overlay migration (#48); track overlay state instead of querying the DOM.",
            );
          }
        };
        return {
          Literal(node) {
            check(node, node.value);
          },
          TemplateElement(node) {
            check(node, node.value.cooked);
          },
        };
      },
    },

    /**
     * Keyboard handling is owned by the ui-sdk shortcut layer; raw
     * document/window key listeners recreate the deleted cascade (#48).
     * Escape hatch: files importing @ui-sdk/solid/shortcuts (e.g. the timer
     * popover's WebAudio unlock) may register document-level key listeners.
     */
    'no-raw-document-keydown': {
      meta: { type: 'problem', docs: { description: 'Ban raw document/window key listeners outside the shortcut layer; use useShortcut.' } },
      create(context) {
        if (!isLintable(context.filename)) return {};
        let shortcutLayer = false;
        return {
          Program(node) {
            shortcutLayer = node.body.some(
              (statement) =>
                statement.type === 'ImportDeclaration' &&
                String(statement.source.value).startsWith('@ui-sdk/solid/shortcuts'),
            );
          },
          CallExpression(node) {
            if (shortcutLayer) return;
            const callee = memberCallee(node.callee);
            if (
              callee === null ||
              callee.property !== 'addEventListener' ||
              (callee.objectName !== 'document' && callee.objectName !== 'window')
            ) {
              return;
            }
            const type = node.arguments[0];
            if (
              type !== undefined && type !== null && type.type === 'Literal' &&
              KEY_EVENT_TYPES.has(String(type.value))
            ) {
              report(
                context,
                node,
                `Raw ${callee.objectName}.addEventListener('${String(type.value)}') is banned (#53); register keyboard behavior through useShortcut (@ui-sdk/solid/shortcuts).`,
              );
            }
          },
        };
      },
    },

    /**
     * The drag MIME contract is gone with #52's createTransfer; a raw MIME
     * literal now flags re-introduced HTML5 drag. The optimistic-id prefix
     * lives in exactly one module; raw copies drift from the wire contract.
     */
    'no-raw-wire-literals': {
      meta: { type: 'problem', docs: { description: 'Ban raw drag-MIME and optimistic-prefix literals outside their owning modules.' } },
      create(context) {
        const file = context.filename.replace(/\\/g, '/');
        if (
          !isLintable(file) ||
          isOwningModule(file, 'src/lib/optimistic-ids.ts')
        ) {
          return {};
        }
        const check = (node, value) => {
          if (typeof value !== 'string') return;
          if (DRAG_MIME_LITERALS.has(value)) {
            report(
              context,
              node,
              'Raw drag MIME literal; HTML5 drag was replaced by createTransfer (src/lib/board-transfer.ts) in #52.',
            );
            return;
          }
          if (value.includes('optimistic:')) {
            report(
              context,
              node,
              "Raw 'optimistic:' literal; use src/lib/optimistic-ids.ts helpers (#53).",
            );
          }
        };
        return {
          Literal(node) {
            check(node, node.value);
          },
          TemplateElement(node) {
            check(node, node.value.cooked);
          },
        };
      },
    },
  },
};
