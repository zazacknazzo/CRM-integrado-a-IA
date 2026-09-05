import { isCrmAuthenticated } from '../../../../lib/auth.ts';

export async function GET(request: Request) {
  return Response.json({ authenticated: await isCrmAuthenticated(request) });
}
