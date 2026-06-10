import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The library is consumed via file:../../packages/* — transpile it (and core) so Next
  // bundles the ESM source rather than treating it as an external CJS dependency.
  transpilePackages: ["i18n-keyless-react", "i18n-keyless-core"],
};

export default nextConfig;
