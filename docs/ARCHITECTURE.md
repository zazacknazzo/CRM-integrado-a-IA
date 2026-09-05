# Arquitetura e invariantes

## Fluxo compartilhado

```text
Webhook Meta / Gateway local / Simulador
        ↓
normalização do telefone
        ↓
cliente + conversa + mensagem (SQLite)
        ↓
debounce de mensagens consecutivas
        ↓
releitura de control_state
        ↓
Professional Gate
   ├─ PROFESSIONAL_HANDOFF → handoff + CRM + FIM
   └─ ALLOW_COMMERCIAL → Commercial Agent → verificação determinística → CRM
                                                        ↓
                                             MessageDispatchService
                                                        ↓
                                       releitura de control_state no banco
                                                        ↓
                                        canal original → mensagem persistida
                                                        ↓
                                       retry durável ou atenção humana
```

`core/pipeline.ts` não conhece detalhes da Meta. Ele depende da interface `MessageChannel`, implementada por:

- `channels/simulator-channel.ts`
- `channels/whatsapp-cloud-api-channel.ts`

## Invariantes de segurança

1. Um `wamid` só pode existir uma vez em `messages.external_id`.
2. Um evento de webhook possui chave externa única em `webhook_events.external_key`.
3. `PROFESSIONAL_HANDOFF` não cria mensagem de saída.
4. Toda resposta de IA relê `conversations.control_state` imediatamente antes do dispatch.
5. `HUMAN_CONTROL` e `PROFESSIONAL_HANDOFF` bloqueiam dispatch de IA.
6. Enviar como humano durante handoff move a conversa para `HUMAN_CONTROL`, nunca para `AI_ACTIVE`.
7. Status de mensagem não regride quando webhooks chegam fora de ordem.
8. Texto livre pelo WhatsApp é bloqueado fora da janela de atendimento.
9. Opt-out cancela follow-ups agendados e impede novos follow-ups promocionais.
10. Secrets não entram em respostas da API, UI ou logs.
11. Cada entrada aceita no pipeline possui no máximo uma resposta vinculada por `reply_to_message_id`.
12. Falhas transitórias são tentadas novamente; quatro falhas consecutivas pausam a IA e abrem atenção humana.
13. Um follow-up é reivindicado atomicamente antes do envio e reutiliza a mesma chave de idempotência em retries.
14. Uma conversa possui no máximo um handoff aberto.

## Persistência

O desenvolvimento usa D1 local/Miniflare, cujo armazenamento é SQLite em `.wrangler/state/v3/d1`. O schema vive em `db/schema.ts`; migrations geradas ficam em `drizzle/`.

Tabelas principais:

- `clients`
- `conversations`
- `messages`
- `webhook_events`
- `handoffs`
- `opportunities`
- `follow_ups`
- `appointments`
- `whatsapp_templates`
- `audit_events`
- `integration_status`
- `auth_login_attempts`

## Concorrência

O debounce é configurado por `MESSAGE_DEBOUNCE_MS` e agrupa mensagens ainda em estado `RECEIVED`. Um lock no banco serializa o processamento por conversa. A barreira final consulta novamente o estado no repositório: se a equipe assumiu enquanto a IA gerava, a resposta é descartada e o evento `reply_blocked_due_to_human_takeover` é auditado. Entradas que falham recebem backoff e são recuperadas pelo executor interno.

## IA

Uma mensagem comercial normal faz apenas uma chamada à Responses API, com JSON Schema estrito, `store: false`, raciocínio baixo e baixa verbosidade:

1. O Professional Gate usa regras locais conservadoras para identificar análise técnica, danos e compatibilidade química.
2. O Commercial Agent usa o modelo configurado.
3. A verificação final aplica localmente as regras de segurança e estilo, substitui qualquer valor pelo preço do catálogo estruturado e preserva “a partir de” nos serviços variáveis.

Sem `OPENAI_API_KEY`/`OPENAI_MODEL`, o simulador continua funcional com regras determinísticas conservadoras. Isso existe apenas para desenvolvimento; configure o modelo antes de um teste real completo.
