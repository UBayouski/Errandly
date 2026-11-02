import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
