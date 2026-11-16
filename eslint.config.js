// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// architecture.md §3.2 dependency rules, as `no-restricted-imports` patterns.
const SIBLING_MODULE = {
  regex: '^\\.\\./[^.]',
  message: 'A module never imports another module: promote it to core/ or expose a service (architecture.md §3.2).',
};
const MODULES = { regex: '/modules/', message: 'core/, db/, lib/ and config/ know nothing about modules/ (architecture.md §3.2).' };
const WORKSPACES = { regex: '^(\\.\\./|api$|web$)', message: 'shared is the leaf of the graph (architecture.md §3.2).' };
const APP = { regex: '(^|/)App$', message: 'Only main.tsx imports App (architecture.md §3.2).' };
const PAGES = { regex: '/pages/', message: 'pages/ is imported only by App.tsx and other pages (architecture.md §3.2).' };
const COMPONENTS = { regex: '/components/', message: 'lib/ holds no UI: it never imports components/ (architecture.md §3.2).' };

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'doc-ai/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  // Dependency rules — architecture.md §3.2. One entry per directory group
  // (the groups are disjoint: flat config does not merge one rule's options
  // across entries, the last match would win).
  ...[
    { files: ['apps/api/src/modules/**'], deny: [SIBLING_MODULE] },
    { files: ['apps/api/src/{core,db,lib,config}/**'], deny: [MODULES] },
    { files: ['packages/shared/src/**'], deny: [WORKSPACES] },
    { files: ['apps/web/src/pages/**'], deny: [APP] },
    { files: ['apps/web/src/{components,auth,tenant,styles}/**'], deny: [APP, PAGES] },
    { files: ['apps/web/src/lib/**'], deny: [APP, PAGES, COMPONENTS] },
  ].map(({ files, deny }) => ({
    files,
    // Web tests may render the whole app (`AppRoutes`) — the rules are about runtime code.
    ignores: ['apps/web/src/**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: deny }] },
  })),
);
