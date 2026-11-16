// The web's only door to data (DP-05/RNF-02): same-origin `/api/v1`, the
// session travels in the HttpOnly cookie (credentials: 'include') — no token
// or Supabase key ever lives in the web. Failures surface as `ApiError`,
// carrying the API envelope `{ error: { code, message, details? } }`.

const API_BASE = '/api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** status 0 = the request never got an HTTP answer (offline, DNS, CORS…). */
export const NETWORK_ERROR = 'NETWORK_ERROR';

export interface RequestOptions {
  /**
   * The active store for a tenant-scoped call made by the platform admin
   * (architecture §5.2) — sent as `X-Tenant-Id`. Store roles never send it:
   * their store is implicit (layout.md §Tenant context block). Get it from
   * `useStoreScope()`, never by hand.
   */
  tenantId?: string;
}

async function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  // Absolute URL from the page origin: same as a relative path in the browser,
  // and also valid for Node's fetch under the test environment.
  const url = new URL(API_BASE + path, window.location.origin);
  const headers: Record<string, string> = {};
  // FormData (a file upload) goes as-is: fetch sets the multipart content type with its boundary.
  const multipart = body instanceof FormData;
  if (body !== undefined && !multipart) headers['Content-Type'] = 'application/json';
  if (options.tenantId) headers['X-Tenant-Id'] = options.tenantId;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'include',
      headers,
      body: multipart ? body : body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, NETWORK_ERROR, 'Network error. Check your connection and try again.');
  }

  if (!res.ok) {
    const envelope = (await res.json().catch(() => null)) as {
      error?: { code?: unknown; message?: unknown; details?: unknown };
    } | null;
    const error = envelope?.error;
    if (typeof error?.code === 'string' && typeof error.message === 'string') {
      throw new ApiError(res.status, error.code, error.message, error.details);
    }
    throw new ApiError(res.status, 'HTTP_ERROR', `Request failed with status ${res.status}.`);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PATCH', path, body, options),
  delete: <T = void>(path: string, options?: RequestOptions) => request<T>('DELETE', path, undefined, options),
};
