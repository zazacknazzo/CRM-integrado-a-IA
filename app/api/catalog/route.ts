import { requireCrmAuth } from '../../../lib/auth.ts';
import { catalog, professionals } from '../../../knowledge/catalog.ts';

export async function GET(request: Request) {
  const unauthorized = await requireCrmAuth(request);
  if (unauthorized) return unauthorized;
  return Response.json({
    services: catalog.map(({ aliases: _aliases, ...service }) => service),
    professionals,
  });
}
