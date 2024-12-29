import type { NextConfig } from "next";

/** @type {import('next').NextConfig} */
const CORS_HEADERS = [
  {
    key: "Access-Control-Allow-Credentials",
    value: "true",
  },
  {
    key: "Access-Control-Allow-Origin",
    value: "*", // Change this to your specific origin in production
  },
  {
    key: "Access-Control-Allow-Methods",
    value: "GET, DELETE, PATCH, POST, PUT",
  },
  {
    key: "Access-Control-Allow-Headers",
    value: "*",
  },
];

const nextConfig: NextConfig = {
  images: {
    unoptimized: true
  },
  async headers() {
    return [
      {
        source: "/api/:path*", // Add headers for all API routes
        headers: CORS_HEADERS,
      },
      {
        source: "/specific", // Add headers for a specific route
        headers: CORS_HEADERS,
      },
    ];
  },
};

module.exports = nextConfig;