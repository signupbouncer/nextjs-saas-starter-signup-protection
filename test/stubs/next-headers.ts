// Test stand-in for next/headers: the request headers a test sets.
export const request = { headers: new Headers() };
export const headers = () => Promise.resolve(request.headers);
export const cookies = () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} });
