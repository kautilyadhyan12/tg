/** The limit a service is handed on a route that spends it in `onRequest`, before a large
 *  body is read (21a-iii-c): already spent there, so here it always lets the request on. */
export const spentBeforeTheBody = (): Promise<boolean> => Promise.resolve(true);
