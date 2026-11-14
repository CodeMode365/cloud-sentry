export const REFRESH_COOKIE = 'cs_refresh';
const REFRESH_PATH = '/api/v1/auth';
const THIRTY_DAYS = 30 * 24 * 3600;

export function parseCookies(header: string | undefined, list?: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = [...(list ?? []), ...(header ? header.split(';') : [])];
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

/** httpOnly + SameSite=Strict + scoped path: the refresh token is never readable by JavaScript. */
export function refreshCookie(value: string, secure: boolean): string {
  return [
    `${REFRESH_COOKIE}=${encodeURIComponent(value)}`,
    'HttpOnly',
    secure ? 'Secure' : '',
    'SameSite=Strict',
    `Path=${REFRESH_PATH}`,
    `Max-Age=${THIRTY_DAYS}`,
  ]
    .filter(Boolean)
    .join('; ');
}

export function clearRefreshCookie(secure: boolean): string {
  return [
    `${REFRESH_COOKIE}=`,
    'HttpOnly',
    secure ? 'Secure' : '',
    'SameSite=Strict',
    `Path=${REFRESH_PATH}`,
    'Max-Age=0',
  ]
    .filter(Boolean)
    .join('; ');
}
