import { createRuntime } from '../../../lib/runtime.ts';
import { requireCrmAuth } from '../../../lib/auth.ts';

export async function GET(request: Request) {
  const unauthorized = await requireCrmAuth(request); if (unauthorized) return unauthorized;
  try {
    const { repository } = createRuntime();
    return Response.json({ conversations: await repository.listConversationSummaries() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not list conversations' }, { status: 500 });
  }
}
