// import { getSession } from "next-auth/react";
import { getServerSession } from "next-auth/next";
// import { NextAuthOptions } from "next-auth";
// import { NextApiRequest, NextApiResponse } from "next";
import { User } from "next-auth";
// import { NextApiRequest } from "next";
import { authOptions } from "../options";
import { setCorsHeaders } from "../[...nextauth]";
import { NextApiRequest, NextApiResponse } from "next";

export async function GET(req: NextApiRequest, res: NextApiResponse) {
  setCorsHeaders(res)
  // Retrieve the session from the request
  // console.log(req)
  // const session = await getSession({ req });
  // const session = await getServerSession(req, authOptions)
  const session = await getServerSession({ req, ...authOptions });
  // console.log(session)

  // Check if the session exists
  if (!session || !session.user) {
    return new Response(JSON.stringify({ message: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Check if the session has expired
  if (new Date(session.expires) < new Date()) {
    return new Response(JSON.stringify({ message: "Session expired, Login again" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Return the user's session info if verified
  return new Response(JSON.stringify({
      message: "JWT is valid",
      user: {
      name: session.user.name,
      // You can include other user details as needed
      } as User,
    }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    }
  );
}