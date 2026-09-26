import { NextResponse } from 'next/server';
import { apiUrl, bearerToken, problem, proxyHeaders, safeFetch } from '@/lib/server-api';

export async function GET() {
  const token = await bearerToken();
  if (!token) {
    return NextResponse.json({ authenticated: false, workspaces: [] });
  }
  const result = await safeFetch(apiUrl('/v1/workspaces'), {
    headers: proxyHeaders(token),
  });
  if (result instanceof NextResponse) {
    return result;
  }
  if (result.status === 401) {
    return NextResponse.json({ authenticated: false, sessionExpired: true, workspaces: [] }, { headers: { 'cache-control': 'no-store' } });
  }
  if (!result.ok) {
    return problem(503, 'service_unavailable', 'ArchGauge is temporarily unavailable. Try again shortly.');
  }
  const workspaces: unknown = await result.json().catch(() => undefined);
  if (!Array.isArray(workspaces)) {
    return problem(503, 'service_unavailable', 'ArchGauge returned an unexpected response.');
  }
  return NextResponse.json({ authenticated: true, workspaces });
}
