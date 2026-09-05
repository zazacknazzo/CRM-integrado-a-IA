import { requireCrmAuth } from '../../../lib/auth.ts';
import { getRawDb } from '../../../db/index.ts';
import { commercialDashboard } from '../../../db/dashboard.ts';
export async function GET(request: Request) {
  const unauthorized = await requireCrmAuth(request);
  if (unauthorized) return unauthorized;
  return Response.json(await commercialDashboard(getRawDb()));
}
