import { NextResponse } from 'next/server'

const COOKIE_NAME = 'oa_session'
const FIFTEEN_MIN_SECONDS = 15 * 60

function readCookie(req: Request): string | null {
  const header = req.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const [k, v] = part.trim().split('=')
    if (k === COOKIE_NAME) return v ?? null
  }
  return null
}

/**
 * GET /api/me — server-side proxy.
 * Reads the httpOnly oa_session cookie, attaches it as a Bearer header,
 * forwards to apps/api's /me. Mirrors x-refreshed-token + rotates the cookie.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const token = readCookie(req)
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'
  const upstream = await fetch(`${apiUrl}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  const body = await upstream.text()
  const res = new NextResponse(body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  })

  const refreshed = upstream.headers.get('x-refreshed-token')
  if (refreshed && refreshed !== token) {
    res.cookies.set({
      name: COOKIE_NAME,
      value: refreshed,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env['NODE_ENV'] === 'production',
      path: '/',
      maxAge: FIFTEEN_MIN_SECONDS,
    })
    res.headers.set('x-refreshed-token', refreshed)
  }

  return res
}
