'use client';

import { useEffect } from 'react';

type ModelContext = {
  registerTool(tool: {
    name: string;
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
    execute(input: unknown): unknown;
  }, options?: { signal?: AbortSignal }): void | Promise<void>;
};

declare global {
  interface Document { readonly modelContext?: ModelContext }
}

export function useAtendeWebMcp(input: {
  conversationId: string;
  setControlState: (state: 'AI_ACTIVE' | 'HUMAN_CONTROL') => void;
}) {
  const { conversationId, setControlState } = input;
  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool({
        name: 'set_current_conversation_control',
        title: 'Alterar controle da conversa',
        description: 'Assume a conversa atual para um humano ou devolve a conversa atual para a IA, atualizando a mesma Inbox visível.',
        inputSchema: {
          type: 'object', additionalProperties: false,
          properties: { state: { type: 'string', enum: ['AI_ACTIVE', 'HUMAN_CONTROL'] } },
          required: ['state'],
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(value) {
          const state = value && typeof value === 'object' ? (value as { state?: unknown }).state : undefined;
          if (state !== 'AI_ACTIVE' && state !== 'HUMAN_CONTROL') throw new Error('state must be AI_ACTIVE or HUMAN_CONTROL');
          setControlState(state);
          return { conversationId, controlState: state };
        },
      }, { signal: lifecycle.signal });
    };
    void register().catch(() => undefined);
    return () => lifecycle.abort();
  }, [conversationId, setControlState]);
}
