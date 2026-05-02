export class ApiError extends Error {
  status: number
  body: unknown

  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export interface ApiClientOptions {
  baseUrl: string
}

/**
 * Typed fetch wrapper for apps/api. Holds the JWT in memory only — never in
 * localStorage. The httpOnly cookie set by /auth/siwe-verify is the durable
 * copy; this in-memory token is the per-tab fast path.
 *
 * On every successful response, we read `x-refreshed-token` and replace the
 * in-memory token. The /me poller therefore gives us rolling 15-min sessions
 * as long as the user is active.
 */
export class ApiClient {
  private baseUrl: string
  private token: string | null = null

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '')
  }

  setToken(token: string | null): void {
    this.token = token
  }

  getToken(): string | null {
    return this.token
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body)
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`

    // No `credentials: 'include'`: this client talks to apps/api on a different
    // origin, so cookies never cross. Including credentials would also force
    // the browser to reject the response under `Access-Control-Allow-Origin: *`.
    // Auth rides on the Authorization header populated above.
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })

    const refreshed = res.headers.get('x-refreshed-token')
    if (refreshed) this.token = refreshed

    const contentType = res.headers.get('content-type') ?? ''
    const isJson = contentType.includes('application/json')
    const parsed: unknown = isJson ? await res.json().catch(() => ({})) : await res.text()

    if (!res.ok) {
      const message =
        isJson && typeof parsed === 'object' && parsed !== null && 'error' in parsed
          ? String((parsed as { error: unknown }).error)
          : `HTTP ${res.status}`
      throw new ApiError(res.status, message, parsed)
    }

    return parsed as T
  }
}

let _client: ApiClient | null = null
export function getApiClient(): ApiClient {
  if (!_client) {
    const baseUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'
    _client = new ApiClient({ baseUrl })
  }
  return _client
}
