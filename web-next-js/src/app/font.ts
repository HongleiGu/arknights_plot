
import { Noto_Sans } from 'next/font/google';

export const getHanSans = (weight: "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900" | "variable" | ("100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900")[] | undefined) => {
  return Noto_Sans({
    weight: weight,
    subsets: ['latin'], // Adjust subsets as needed
  });
};