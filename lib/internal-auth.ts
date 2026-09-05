import { getRuntimeEnv } from '../db/index.ts';
import { requireCrmAuth } from './auth.ts';

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1)
    difference |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}

export function isInternalRequest(request: Request) {
  const secret = getRuntimeEnv().INTERNAL_JOB_SECRET ?? '';
  const supplied =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  return Boolean(secret && supplied && constantTimeEqual(secret, supplied));
}

export function requireInternalAuth(request: Request) {
  return isInternalRequest(request)
    ? null
    : Response.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function requireCrmOrInternalAuth(request: Request) {
  return isInternalRequest(request) ? null : requireCrmAuth(request);
}
