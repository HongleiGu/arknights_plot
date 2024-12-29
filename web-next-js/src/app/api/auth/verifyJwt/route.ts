import { getServerSession } from "next-auth/next";
import { User } from "next-auth";
import { authOptions } from "../options";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const res = NextResponse.next(); // Create a NextResponse instance

  res.headers.append("Access-Control-Allow-Credentials", "true");
  res.headers.append("Access-Control-Allow-Origin", "*");
  res.headers.append("Access-Control-Allow-Methods", "GET,DELETE,PATCH,POST,PUT");
  res.headers.append("Access-Control-Allow-Headers", "*");

  // Retrieve the session from the request
  const session = await getServerSession({ req, ...authOptions });

  // Check if the session exists
  if (!session || !session.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  // Check if the session has expired
  if (new Date(session.expires) < new Date()) {
    return NextResponse.json({ message: "Session expired, Login again" }, { status: 403 });
  }

  // Return the user's session info if verified
  return NextResponse.json({
    message: "JWT is valid",
    user: {
      name: session.user.name,
      // You can include other user details as needed
    } as User,
  }, { status: 200 });
}