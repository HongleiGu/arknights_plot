import { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime"
// import { NextRouter } from "next/router"
// import { NextRouter } from "next/router"

export const goToNav = (item: string, router: AppRouterInstance, pathname: string) => {
  console.log(`gotoNav, ${item}`)
  router.push(pathname + '/' + item)
}


// export const goToNav1 = (item: string, router: NextRouter, pathname: string) => {
//   router.push(pathname + '/' + item)
// }

export const useImageProxy = (url: string) => `/api/imageProxy?imageUrl=${url}`

// Function to convert snake_case to camelCase
function toCamelCase(snakeCase: string): string {
  return snakeCase.replace(/(_\w)/g, (matches) => matches[1].toUpperCase());
}

// Generic function to convert all keys of an object from snake_case to camelCase, excluding arrays
export function convertKeysToCamelCase<T extends object>(obj: T): {
  [K in keyof T as K extends string ? (K extends `${infer P}_${infer R}` ? `${P}${Capitalize<R>}` : K) : K]: T[K]
} {
  // Check if the input is an object (not an array)
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return obj as any; // Return as is if it's not an object
  }

  return Object.keys(obj).reduce((acc, key) => {
    const camelKey = toCamelCase(key);
    acc[camelKey as keyof T] = obj[key as keyof T];
    return acc;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }, {} as any); // Use 'any' to avoid type errors
}
