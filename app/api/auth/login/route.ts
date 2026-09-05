import { clearLoginFailures, createSessionCookie, loginThrottle, recordLoginFailure, verifyCrmPassword } from '../../../../lib/auth.ts';

export async function POST(request: Request) {
  const throttle = await loginThrottle(request);
  if (throttle.retryAfterSeconds) {
    return Response.json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, {
      status: 429, headers: { 'Retry-After': String(throttle.retryAfterSeconds) },
    });
  }
  const body = await request.json().catch(() => null) as { password?: string } | null;
  if (!body?.password || !await verifyCrmPassword(body.password)) {
    await recordLoginFailure(throttle.clientKey);
    return Response.json({ error: 'Senha incorreta' }, { status: 401 });
  }
  await clearLoginFailures(throttle.clientKey);
  return Response.json({ authenticated: true }, { headers: { 'Set-Cookie': await createSessionCookie(request), 'Cache-Control': 'no-store' } });
}
