// // this code work if it is client side, however, its server side

// import { NextResponse } from 'next/server';
// // import NextAuth from 'next-auth';
// import { signIn } from 'next-auth/react';
// import { User } from 'next-auth';
// import useUserStore from '@/app/store/login';
// import { useRouter } from 'next/router';
// // import { authOptions } from '@/lib/auth'; // Adjust the path to your NextAuth options

// export async function POST(request: Request) {
//   const { username, password } = await request.json();

//   const store = useUserStore()
//   const router = useRouter()

//   const result = await signIn('credentials', {
//     redirect: false,
//     username: username,
//     password: password,
//   });
//   // alert(username)
//   // alert(password)
//   // alert(result)
      
//         if (result == undefined) {
//           console.log("invalid result")
//           return
//           // return NextResponse.json({ code: 0, message: "invalid result"}, {status: 400})
//         }
      
//         if (result.error) {
//           console.log(result.error)
//           return
//           // return NextResponse.json({ code: 0, message: result.error }, { status: 401 });
//         }
  
//         store.setUser({name: username} as User)
//         router.push("/home")
// }