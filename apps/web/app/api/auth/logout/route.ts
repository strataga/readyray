import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { apiUrl, bearerToken, problem, proxyHeaders, requireSameOrigin, safeFetch, SESSION_COOKIE } from '@/lib/server-api';

export async function POST(request: Request): Promise<Response> {
  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  const token = await bearerToken();
  if (token) {
    const revoked = await safeFetch(apiUrl('/v1/sessions/current'), {
      method: 'DELETE',
      headers: proxyHeaders(token),
    });
    if (revoked instanceof NextResponse) {
      return revoked;
    }
    if (!revoked.ok && revoked.status !== 401) {
      return problem(503, 'session_revoke_failed', 'Your session could not be revoked. Please try again.');
    }
  }

  (await cookies()).set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return NextResponse.json({ authenticated: false }, { headers: { 'cache-control': 'no-store' } });
}
