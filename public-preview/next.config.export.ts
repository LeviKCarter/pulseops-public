// Next.js config used ONLY for the public GitHub Pages preview build.
// scripts/build-public-preview.mjs copies this over next.config.ts inside a throwaway staging
// copy of the repo — the real next.config.ts (used by `npm run dev` / `npm run build` / `npm run
// start`) is never touched.
//
// GH_PAGES_BASE_PATH lets the build target a GitHub "project" page
// (https://<user>.github.io/<repo>/) instead of a root/custom domain. Leave it unset for a
// user/org page or a custom domain mapped to the repo root.
import type { NextConfig } from 'next';

const basePath = process.env.GH_PAGES_BASE_PATH?.trim();

const nextConfig: NextConfig = {
  output: 'export',
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
};

export default nextConfig;
