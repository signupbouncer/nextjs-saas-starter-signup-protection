// Test stand-in for next/navigation: redirect() throws, as Next's does.
export class Redirect extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}
export function redirect(url: string): never {
  throw new Redirect(url);
}
