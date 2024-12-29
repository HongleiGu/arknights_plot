// this code work if it is client side, however, its server side

import { NextResponse } from 'next/server';
// import NextAuth from 'next-auth';
import { signIn } from 'next-auth/react';
// import { authOptions } from '@/lib/auth'; // Adjust the path to your NextAuth options

export async function POST(request: Request) {
  const { username, password } = await request.json();

  // Use NextAuth's signIn method for authentication
  const result = await signIn('credentials', {
    redirect: false,
    username,
    password,
  });

  if (result == undefined) {
    return NextResponse.json({ code: 0, message: "invalid result"}, {status: 400})
  }

  if (result.error) {
    return NextResponse.json({ code: 0, message: result.error }, { status: 401 });
  }

  // Successful login
  return NextResponse.json({ code: 1, message: 'Login successful', user: username }, { status: 200 });
}