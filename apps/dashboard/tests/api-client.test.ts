import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ApiClient, ApiError } from '@/lib/api-client'

const BASE_URL = 'http://localhost:3001'

describe('ApiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns parsed JSON on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient({ baseUrl: BASE_URL })
    const data = await client.get<{ ok: boolean }>('/health')
    expect(data.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('attaches Authorization header when a token is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient({ baseUrl: BASE_URL })
    client.setToken('test-jwt-value')
    await client.get('/me')

    const init = fetchMock.mock.calls[0]![1] as RequestInit
    const headers = new Headers(init.headers)
    expect(headers.get('Authorization')).toBe('Bearer test-jwt-value')
  })

  it('captures x-refreshed-token from the response and updates the in-memory token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-refreshed-token': 'new-rolling-jwt',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient({ baseUrl: BASE_URL })
    client.setToken('old-jwt')
    await client.get('/me')

    expect(client.getToken()).toBe('new-rolling-jwt')
  })

  it('throws ApiError with status and message for non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Subname label is already taken' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient({ baseUrl: BASE_URL })
    await expect(client.post('/agents', { subnameLabel: 'x' })).rejects.toMatchObject({
      status: 409,
      message: 'Subname label is already taken',
    })
  })

  it('ApiError instances pass instanceof', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('plain text', { status: 500, headers: { 'content-type': 'text/plain' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient({ baseUrl: BASE_URL })
    let caught: unknown
    try { await client.get('/x') } catch (err) { caught = err }
    expect(caught).toBeInstanceOf(ApiError)
  })
})
