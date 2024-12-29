import { create } from 'zustand';
import { User as NextAuthUser } from 'next-auth'; // Import User type from NextAuth

// Define the store state interface
interface UserState {
  user: NextAuthUser | null; // The user object from NextAuth, initially null
  setUser: (user: NextAuthUser | null) => void; // Function to set the user
  verifyJwt: () => void
}

const useUserStore = create<UserState>((set) => {
  const verifyJwt = async () => {
    const response = await fetch(`${process.env.URL}/api/auth/verifyJwt`, {
      method: 'GET',
      credentials: 'include', // Include credentials for cookie-based sessions
    });

    const data = await response.json();
    
    if (response.ok) {
      const { user } = data; // Deconstruct the user attribute from the data
      set({ user }); // Update the user state with the deconstructed user
    } else {
      set({ user: null }); // Clear user state if verification fails
    }
  };

  // Call verifyJwt on store initialization
  verifyJwt();

  return {
    user: null, // Initial state
    setUser: (user) => set({ user }), // Update the user state
    verifyJwt: verifyJwt, // Make verifyJwt available to the store
  };
});




export default useUserStore;