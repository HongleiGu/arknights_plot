import { getServerSession } from "next-auth/next";
import { User } from "next-auth";
import { authOptions } from "../options";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  // Initialize the response variable
  let response: NextResponse | null = null;

  // Retrieve the session from the request
  const session = await getServerSession({ req, ...authOptions });

  // Check if the session exists
  if (!session || !session.user) {
    response = NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  } 
  // Check if the session has expired
  else if (new Date(session.expires) < new Date()) {
    response = NextResponse.json({ message: "Session expired, Login again" }, { status: 403 });
  } 
  // Return the user's session info if verified
  else {
    response = NextResponse.json({
      message: "JWT is valid",
      user: {
        name: session.user.name,
        // You can include other user details as needed
      } as User,
    }, { status: 200 });
  }

  // Set CORS headers
  if (response) {
    response.headers.append("Access-Control-Allow-Credentials", "true");
    response.headers.append("Access-Control-Allow-Origin", "*");
    response.headers.append("Access-Control-Allow-Methods", "GET,DELETE,PATCH,POST,PUT");
    response.headers.append("Access-Control-Allow-Headers", "*");
  }

  return response; // Return the final response
}