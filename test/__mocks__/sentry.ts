const noop = () => {};

export const withSentry = (_opts: unknown, handler: unknown) => handler;
export const captureException = noop;
export const setUser = noop;
export const setTag = noop;
export const addBreadcrumb = noop;
export const init = noop;
export const flush = async () => {};
