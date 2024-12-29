import NextAuth from "next-auth";
// import CredentialsProvider from "next-auth/providers/credentials";
// import { compare } from "bcryptjs";
// import { findUsername } from "@/utils/api"; // Your custom function to find users
// import type { User as NextAuthUser } from "next-auth";
import { NextApiRequest, NextApiResponse } from "next";
import { authOptions } from "./options";

// Handling the POST request
export async function POST(req: NextApiRequest, res: NextApiResponse) {
  return NextAuth(req, res, authOptions); // Pass both req and res
}

// Export the GET method
export async function GET(req: NextApiRequest, res: NextApiResponse) {
  return NextAuth(req, res, authOptions); // Call NextAuth to handle the GET request
}