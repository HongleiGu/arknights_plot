import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'pub-42f3c13ba55547428f5aa143303b7ad7.r2.dev',
      },
    ],
  },
};

export default nextConfig;
