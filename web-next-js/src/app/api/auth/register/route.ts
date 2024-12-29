import { NextResponse } from 'next/server';
// import { sql } from '@vercel/postgres';
import { hash } from 'bcryptjs';
import { findUsername, register } from '@/utils/api';

export async function POST(request: Request) {
  const { username, password } = await request.json();

  // Check if the user already exists
  // const existingUser = await sql`SELECT * FROM users WHERE username = ${username}`;
  console.log(username)
  const existingUser = await findUsername(username)
  const rowCount = existingUser.length
  if (rowCount > 0) {
    return NextResponse.json({ code: 0, message: 'Username already taken' }, { status: 400 });
  }

  // Hash the password
  const salt = 10
  const hashedPassword = await hash(password, salt);

  // Insert the new user into the database
  // await sql`INSERT INTO users (username, password) VALUES (${username}, ${hashedPassword})`;
  register({username: username, password: hashedPassword})

  return NextResponse.json({ code: 1, message: 'User registered successfully' }, { status: 201 });
}