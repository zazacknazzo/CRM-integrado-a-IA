import { clearSessionCookie } from '../../../../lib/auth.ts';

export async function POST(request: Request) {
  return Response.json({ authenticated: false }, { headers: { 'Set-Cookie': clearSessionCookie(request), 'Cache-Control': 'no-store' } });
}
