import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  images: {
    domains: [new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').host],
  },
};

export default nextConfig;
