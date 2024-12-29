import NextAuth from "next-auth";
import { NextApiRequest, NextApiResponse } from "next";
import { authOptions } from "./options";

// Function to set CORS headers
const setCorsHeaders = (res: NextApiResponse) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // Replace with your allowed origin
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

// Handling the POST request
export async function POST(req: NextApiRequest, res: NextApiResponse) {
  setCorsHeaders(res);

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end(); // End the response for preflight requests
    return;
  }

  // Call NextAuth for POST
  return NextAuth(req, res, authOptions);
}

// Handling the GET request
export async function GET(req: NextApiRequest, res: NextApiResponse) {
  setCorsHeaders(res);

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end(); // End the response for preflight requests
    return;
  }

  // Call NextAuth for GET
  return NextAuth(req, res, authOptions);
}