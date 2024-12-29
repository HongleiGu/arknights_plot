import { getServerSession } from "next-auth/next";
import { User } from "next-auth";
import { authOptions } from "../options";
import { setCorsHeaders } from "../[...nextauth]";
import { NextApiRequest, NextApiResponse } from "next";

export async function GET(req: NextApiRequest, res: NextApiResponse) {
  // Set CORS headers
  setCorsHeaders(res);

  // Retrieve the session from the request
  const session = await getServerSession(req, authOptions);

  // Check if the session exists
  if (!session || !session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Check if the session has expired
  if (new Date(session.expires) < new Date()) {
    return res.status(403).json({ message: "Session expired, login again" });
  }

  // Return the user's session info if verified
  return res.status(200).json({
    message: "JWT is valid",
    user: {
      name: session.user.name,
      // You can include other user details as needed
    } as User,
  });
}