// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'supabase/functions/*', 'coverage/*'],
  },
  {
    rules: {
      // Screens start async data fetches from effects; state is set when the request resolves.
      // The compiler rule cannot distinguish that from synchronous cascading updates.
      'react-hooks/set-state-in-effect': 'off',
      // False positive: expo-notifications re-exports its enums via `export *` from .types files.
      'import/namespace': 'off',
    },
  },
]);
