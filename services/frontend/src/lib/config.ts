const RAW_API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

/**
 * Normalise the configured API URL.  Vercel commonly sets the origin only
 * (https://api.example.com), while local dev sets the full /api/v1 prefix.
 */
export const API_BASE = RAW_API_BASE.replace(/\/+$/, '').endsWith('/api/v1')
  ? RAW_API_BASE.replace(/\/+$/, '')
  : `${RAW_API_BASE.replace(/\/+$/, '')}/api/v1`;

export const API_ORIGIN = API_BASE.replace(/\/api\/v1$/, '');

export function apiUrl(path: string): string {
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}
