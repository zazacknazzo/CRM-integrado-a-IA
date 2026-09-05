import { getRawDb, getRuntimeEnv } from '../db/index.ts';

const COOKIE_NAME = 'atende_session';
const SESSION_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

function isLoopback(request: Request) {
  const hostname = new URL(request.url).hostname.toLocaleLowerCase();
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  );
}

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1)
    difference |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get('cookie') ?? '';
  return (
    cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? null
  );
}

function toHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function signature(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

function sessionSecret() {
  const env = getRuntimeEnv();
  return env.CRM_SESSION_SECRET || env.CRM_ACCESS_PASSWORD || '';
}

export async function isCrmAuthenticated(request: Request) {
  const env = getRuntimeEnv();
  if (!env.CRM_ACCESS_PASSWORD)
    return env.ALLOW_LOCAL_PASSWORDLESS === 'true' && isLoopback(request);
  const token = cookieValue(request, COOKIE_NAME);
  const secret = sessionSecret();
  if (!token || !secret) return false;
  const [expires, nonce, supplied] = token.split('.');
  if (
    !expires ||
    !nonce ||
    !supplied ||
    Number(expires) <= Math.floor(Date.now() / 1000)
  )
    return false;
  return constantTimeEqual(
    supplied,
    await signature(`${expires}.${nonce}`, secret),
  );
}

export async function requireCrmAuth(request: Request) {
  if (await isCrmAuthenticated(request)) return null;
  const env = getRuntimeEnv();
  return Response.json(
    {
      error: env.CRM_ACCESS_PASSWORD
        ? 'Faça login para continuar'
        : 'Defina CRM_ACCESS_PASSWORD antes de liberar o acesso remoto',
    },
    { status: env.CRM_ACCESS_PASSWORD ? 401 : 503 },
  );
}

export async function verifyCrmPassword(password: string) {
  const expected = getRuntimeEnv().CRM_ACCESS_PASSWORD ?? '';
  return Boolean(expected) && constantTimeEqual(password, expected);
}

async function loginClientKey(request: Request) {
  const address =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'local-client';
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(address)));
}

export async function loginThrottle(request: Request) {
  const clientKey = await loginClientKey(request);
  const record = await getRawDb()
    .prepare(
      'SELECT failed_attempts, first_failed_at, blocked_until FROM auth_login_attempts WHERE client_key = ?',
    )
    .bind(clientKey)
    .first<{
      failed_attempts: number;
      first_failed_at: string;
      blocked_until: string | null;
    }>();
  const blockedUntil = record?.blocked_until
    ? Date.parse(record.blocked_until)
    : 0;
  return {
    clientKey,
    retryAfterSeconds:
      blockedUntil > Date.now()
        ? Math.max(1, Math.ceil((blockedUntil - Date.now()) / 1000))
        : 0,
  };
}

export async function recordLoginFailure(clientKey: string) {
  const db = getRawDb();
  const timestamp = new Date().toISOString();
  const existing = await db
    .prepare(
      'SELECT failed_attempts, first_failed_at FROM auth_login_attempts WHERE client_key = ?',
    )
    .bind(clientKey)
    .first<{ failed_attempts: number; first_failed_at: string }>();
  const windowExpired =
    !existing ||
    Date.now() - Date.parse(existing.first_failed_at) > 15 * 60_000;
  const attempts = windowExpired ? 1 : existing.failed_attempts + 1;
  const firstFailedAt = windowExpired ? timestamp : existing.first_failed_at;
  const blockedUntil =
    attempts >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
  await db
    .prepare(
      `INSERT INTO auth_login_attempts (client_key, failed_attempts, first_failed_at, blocked_until, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(client_key) DO UPDATE SET failed_attempts = excluded.failed_attempts,
     first_failed_at = excluded.first_failed_at, blocked_until = excluded.blocked_until, updated_at = excluded.updated_at`,
    )
    .bind(clientKey, attempts, firstFailedAt, blockedUntil, timestamp)
    .run();
}

export async function clearLoginFailures(clientKey: string) {
  await getRawDb()
    .prepare('DELETE FROM auth_login_attempts WHERE client_key = ?')
    .bind(clientKey)
    .run();
}

export async function createSessionCookie(request: Request) {
  const expires = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const value = `${expires}.${nonce}`;
  const token = `${value}.${await signature(value, sessionSecret())}`;
  const secure =
    new URL(request.url).protocol === 'https:' ||
    request.headers.get('x-forwarded-proto') === 'https';
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(request: Request) {
  const secure =
    new URL(request.url).protocol === 'https:' ||
    request.headers.get('x-forwarded-proto') === 'https';
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}
