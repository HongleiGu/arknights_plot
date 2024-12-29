"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const HomeRedirect = () => {
  const router = useRouter();

  useEffect(() => {
    // Redirect to /home
    router.push('/home');
  }, [router]);

  return null; // Optionally return null or a loading spinner
};

export default HomeRedirect;