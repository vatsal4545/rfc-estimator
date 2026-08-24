import type { NextConfig } from "next";

// The app is fully client-side (state lives in localStorage), so it can ship
// as pure static files. STATIC_EXPORT=1 turns on `next export` mode — used by
// the GitHub Pages workflow, which also sets BASE_PATH=/<repo-name> because
// Pages serves project sites from a sub-path. Vercel needs neither.
const nextConfig: NextConfig = {
  ...(process.env.STATIC_EXPORT === "1"
    ? {
        output: "export" as const,
        basePath: process.env.BASE_PATH ?? "",
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
