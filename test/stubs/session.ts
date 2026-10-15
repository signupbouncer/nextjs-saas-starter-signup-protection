// Test stand-in for lib/auth/session.ts: no bcrypt, no cookies.
export const hashPassword = (password: string) => Promise.resolve(`hashed:${password}`);
export const comparePasswords = (plain: string, hashed: string) =>
  Promise.resolve(hashed === `hashed:${plain}`);
export const sessions: unknown[] = [];
export const setSession = (user: unknown) => {
  sessions.push(user);
  return Promise.resolve();
};
