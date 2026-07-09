// Native-only loader for the optional document-scanner module. Metro resolves
// `nativeScanner.web.ts` on web instead of this file, so the native package is
// never pulled into the web bundle.

export function getNativeScanner(): any {
  try {
    return require("react-native-document-scanner-plugin").default ?? null;
  } catch {
    return null;
  }
}
