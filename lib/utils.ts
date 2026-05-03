import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges Tailwind class names — works the same in React Native (NativeWind)
 * as it does on the web.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
