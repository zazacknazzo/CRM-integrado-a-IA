import type { ControlState } from '../../../../../core/contracts.ts';
import { resumeAiConversation } from '../../../../../core/pipeline.ts';
import { createRuntime } from '../../../../../lib/runtime.ts';
import { requireCrmAuth } from '../../../../../lib/auth.ts';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireCrmAuth(request); if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null) as { state?: ControlState } | null;
  if (!body?.state || !['AI_ACTIVE', 'HUMAN_CONTROL'].includes(body.state)) return Response.json({ error: 'state must be AI_ACTIVE or HUMAN_CONTROL' }, { status: 400 });
  try {
    const { id } = await context.params;
    const { pipeline, repository } = createRuntime();
    await repository.setControlState(id, body.state);
    await repository.audit(id, body.state === 'HUMAN_CONTROL' ? 'human_takeover' : 'returned_to_ai', 'HUMAN');
    let resumeStatus = 'NOT_REQUESTED';
    let resumeError: string | null = null;
    if (body.state === 'AI_ACTIVE') {
      try {
        const result = await resumeAiConversation(id, pipeline);
        resumeStatus = result.status;
      } catch (error) {
        resumeStatus = 'ERROR';
        resumeError = error instanceof Error ? error.message : 'Não foi possível responder à última mensagem';
      }
    }
    const conversation = await repository.getConversation(id);
    return Response.json({
      conversationId: id,
      controlState: conversation.controlState,
      resumeStatus,
      resumeError,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not change control state' }, { status: 500 });
  }
}
