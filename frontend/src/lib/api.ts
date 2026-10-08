export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';
export const HEALTH_BASE_URL = import.meta.env.VITE_API_HEALTH_URL || 'http://localhost:8000/health';

/** Optional API key — set VITE_API_KEY in your .env file */
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined;

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit & { returnFullResponse?: boolean } = {},
  isHealthCheck = false,
): Promise<T> {
  const headers = new Headers(options.headers || {});

  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  // Inject API key if configured
  if (API_KEY) {
    headers.set('X-API-Key', API_KEY);
  }

  const baseUrl = isHealthCheck ? HEALTH_BASE_URL : API_BASE_URL;
  const url = `${baseUrl}${endpoint}`;

  const response = await fetch(url, { ...options, headers });

  let data: any;
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    data = await response.json();
  }

  if (!response.ok) {
    const message =
      data?.error?.message || data?.detail || response.statusText || 'An error occurred';
    const code = data?.error?.code;
    throw new ApiError(response.status, message, code);
  }

  if (options.returnFullResponse) {
    return data;
  }

  // The backend wraps success responses as `{ data: ... }` for most routes.
  return data && data.data !== undefined ? data.data : data;
}
