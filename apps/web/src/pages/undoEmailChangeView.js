// The page "Undo this change" opens (item 19's security pass, H1). Pure.

/** The token after "#" in the link, or null where it is not one of ours (64 hex characters). */
export function undoTokenFromHash(hash) {
  if (typeof hash !== 'string') return null;
  const token = hash.startsWith('#') ? hash.slice(1) : hash;
  return /^[0-9a-f]{64}$/.test(token) ? token : null;
}
