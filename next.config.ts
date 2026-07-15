import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Serve images directly from R2 instead of Vercel's image optimizer.
    // The optimizer has a monthly quota on the Hobby plan; once exhausted,
    // /_next/image returns 402 (OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED).
    // Our assets already live on R2/Cloudflare, so optimization buys little.
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'pub-42f3c13ba55547428f5aa143303b7ad7.r2.dev',
      },
    ],
  },
};

export default nextConfig;
