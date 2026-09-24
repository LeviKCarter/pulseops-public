import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'dist/**', 'scratch-handoff-dashboard-release-20260829/**', 'next-env.d.ts',
    // Output of scripts/build-public-preview.mjs (gitignored): a staged copy of the repo and its bundled build.
    '.public-preview-stage/**', 'public-preview-dist/**']),
]);

export default eslintConfig;
