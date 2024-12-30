import NextAuth from 'next-auth';
import { authOptions } from '../options';

const handler = NextAuth(authOptions);

// Exporting the handler for both GET and POST methods
export { handler as GET, handler as POST };