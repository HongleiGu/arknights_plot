// 'use client'; // Indicate that this is a Client Component

// import { useSearchParams } from 'next/navigation';

// const ErrorPage = () => {
//   const searchParams = useSearchParams(); // Access search parameters

//   // Parse the error from the URL
//   const error = searchParams.get('error');

//   return (
//     <div>
//       <h1>Error</h1>
//       {error ? (
//         <p>{decodeURIComponent(error)}</p> // Display the error message
//       ) : (
//         <p>An unknown error occurred.</p>
//       )}
//       <a href="/auth/signin">Go back to Sign In</a>
//     </div>
//   );
// };

// export default ErrorPage;