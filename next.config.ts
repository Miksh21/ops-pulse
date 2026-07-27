import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg"],
  // There is a stray lockfile in the home directory; without this Next infers
  // ~/ as the workspace root and traces the wrong files.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
