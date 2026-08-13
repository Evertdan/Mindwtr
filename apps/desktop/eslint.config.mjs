import js from '@eslint/js';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  {
    // ESLint's core file-discovery always walks recognized JS extensions
    // regardless of any config's `files:` scoping, so every non-ts/tsx one
    // must be ignored explicitly to match the old `--ext ts,tsx` restriction
    // exactly - otherwise coverage/ report artifacts, tailwind/postcss
    // configs, public/sw.js, and this config file itself end up "linted"
    // with zero applicable rules.
    ignores: ['dist/**', 'src-tauri/**', 'node_modules/**', '**/*.js', '**/*.mjs', '**/*.cjs'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2020,
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      // Turns off core rules TypeScript already checks better (no-undef,
      // no-redeclare, ...) for ts/tsx - the eslintrc-style 'plugin:@typescript-
      // eslint/recommended' extends chain applied this automatically; flat
      // config does not, so it must be spread in explicitly or ambient DOM/
      // lib types (EventListener, FrameRequestCallback, ...) and the JSX
      // pragma read as undefined globals.
      ...tsPlugin.configs['flat/eslint-recommended'].rules,
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs['recommended-latest'].rules,
      // We run with `--max-warnings 0`, so avoid warning-level rules by default.
      'no-mixed-spaces-and-tabs': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
    },
  },
];
