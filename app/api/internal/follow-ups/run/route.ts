import { createRuntime } from '../../../../../lib/runtime.ts';
import { getRawDb } from '../../../../../db/index.ts';
import { requireInternalAuth } from '../../../../../lib/internal-auth.ts';
import { runFollowUps } from '../../../../../db/follow-up-runner.ts';

export async function POST(request: Request) {
  const unauthorized = requireInternalAuth(request);
  if (unauthorized) return unauthorized;
  return Response.json(
    await runFollowUps(getRawDb(), createRuntime().pipeline),
  );
}
