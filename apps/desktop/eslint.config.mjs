import js from '@eslint/js';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  {
    // El descubrimiento de archivos central de ESLint siempre recorre las extensiones JS reconocidas
    // independientemente del alcance `files:` de cualquier config, por lo que cada una que no sea ts/tsx
    // debe ignorarse explícitamente para coincidir con la restricción antigua `--ext ts,tsx`
    // exactamente - de lo contrario, artefactos de coverage/, tailwind/postcss
    // configs, public/sw.js, y el propio archivo de config terminan "linted"
    // con cero reglas aplicables.
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
      // Desactiva reglas centrales que TypeScript ya verifica mejor (no-undef,
      // no-redeclare, ...) para ts/tsx - la cadena de extensiones del estilo eslintrc 'plugin:@typescript-
      // eslint/recommended' aplicó esto automáticamente; la config plana
      // no lo hace, por lo que debe incluirse explícitamente o tipos DOM/
      // lib ambientes (EventListener, FrameRequestCallback, ...) y el pragma JSX
      // se leen como globals indefinidas.
      ...tsPlugin.configs['flat/eslint-recommended'].rules,
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs['recommended-latest'].rules,
      // Ejecutamos con `--max-warnings 0`, así que evitamos reglas a nivel de advertencia de forma predeterminada.
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
