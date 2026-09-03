import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) })

/**
 * Flat config, replacing `next lint` (deprecated in Next 15.5, removed in 16).
 * See issue #21: the old script never actually linted — there was no ESLint
 * installed at all, so `next lint` only ever offered to set one up.
 *
 * `next/core-web-vitals` is the rule set create-next-app ships; `next/typescript`
 * adds the typescript-eslint recommended layer. Neither is type-aware, so the
 * lint stays fast and `tsc --noEmit` remains the thing that checks types.
 */
const config = [
  {
    // Generated, vendored, or produced by a run — never hand-written.
    ignores: [
      '.next/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // A leading underscore is how this codebase already spells "bound on
      // purpose, unused on purpose" — a positional argument it has to accept
      // to reach a later one, or a destructured field it is deliberately
      // dropping. Flagging those trains people to delete the marker rather
      // than read it.
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
]

export default config
