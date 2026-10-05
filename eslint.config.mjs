import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'publish/**',
      'web/meaning-equivalences.mjs',
      'web/meaning-fixtures.mjs',
      'web-fixtures.mjs',
      'dictionary.mjs',
      'reading-bucket.mjs',
      'build-web-dictionary.mjs',
    ],
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-dupe-args': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'valid-typeof': 'error',
    },
  },
];
