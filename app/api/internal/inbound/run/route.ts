import { processPendingConversation } from '../../../../../core/pipeline.ts';
import { createRuntime } from '../../../../../lib/runtime.ts';
import { requireInternalAuth } from '../../../../../lib/internal-auth.ts';

export async function POST(request: Request) {
  const unauthorized = requireInternalAuth(request);
  if (unauthorized) return unauthorized;
  const { pipeline, repository } = createRuntime();
  const conversationIds =
    (await repository.listRecoverableConversationIds?.(20)) ?? [];
  const results: Record<string, number> = {};
  for (const conversationId of conversationIds) {
    const result = await processPendingConversation(conversationId, pipeline);
    results[result.status] = (results[result.status] ?? 0) + 1;
  }
  return Response.json({ checked: conversationIds.length, results });
}
