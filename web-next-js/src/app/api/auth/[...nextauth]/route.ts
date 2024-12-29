import NextAuth, { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { findUsername } from "@/utils/api"; // Your custom function to find users
import type { User as NextAuthUser } from "next-auth";
import { NextApiRequest, NextApiResponse } from "next";

// Define the NextAuth options
export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    CredentialsProvider({
      credentials: {
        username: { label: "Username", type: "text", placeholder: "Enter your username" },
        password: { label: "Password", type: "password", placeholder: "Enter your password" },
      },
      async authorize(credentials) {
        if (!credentials) {
          throw new Error("Credentials not provided");
        }

        const user = await findUsername(credentials.username);
        if (!user || user.length === 0) {
          throw new Error("No user found with the provided username");
        }

        if (user.length !== 1) {
          throw new Error("Multiple entries in the database, most likely corrupted. Contact the admin.");
        }

        const userPassword = user[0].password;
        const isPasswordValid = await compare(credentials.password, userPassword);

        if (!isPasswordValid) {
          throw new Error("Invalid password");
        }

        return { name: user[0].username } as NextAuthUser; // Return user object
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 1 day
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.name = user.name; // Add user info to token
      }
      return token;
    },
    async session({ session, token }) {
      if (session && session.user) {
        session.user.name = token.name as string; // Add user info to session
      }
      return session;
    },
  },
};

// Handling the POST request
export async function POST(req: NextApiRequest, res: NextApiResponse) {
  return NextAuth(req, res, authOptions); // Pass both req and res
}

// Export the GET method
export async function GET(req: NextApiRequest, res: NextApiResponse) {
  return NextAuth(req, res, authOptions); // Call NextAuth to handle the GET request
}