import { NextResponse } from 'next/server'

const COOKIE_NAME = 'oa_session'
const FIFTEEN_MIN_SECONDS = 15 * 60

/**
 * POST /api/session
 * Body: { token: string }
 * Sets `oa_session` as an httpOnly, SameSite=Lax cookie.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const token = (body as { token?: unknown } | null)?.token
  if (typeof token !== 'string' || token.split('.').length !== 3) {
    return NextResponse.json({ error: 'Missing or malformed token' }, { status: 400 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
    maxAge: FIFTEEN_MIN_SECONDS,
  })
  return res
}

/**
 * DELETE /api/session — clears the cookie.
 */
export async function DELETE(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true })
  res.cookies.set({
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
    maxAge: 0,
  })
  return res
}

/**
 * GET /api/session — returns whether the cookie is present.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const cookieHeader = req.headers.get('cookie') ?? ''
  const has = cookieHeader.split(';').some((c) => c.trim().startsWith(`${COOKIE_NAME}=`))
  return NextResponse.json({ authenticated: has })
}
