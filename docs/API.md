# Endpoints do MVP

| Método | Endpoint | Função |
|---|---|---|
| GET | `/api/webhooks/whatsapp` | Verificação do webhook Meta. |
| POST | `/api/webhooks/whatsapp` | Mensagens e status assinados pela Meta. |
| POST | `/api/webhooks/whatsapp-web` | Mensagens e status assinados pelo gateway local. |
| POST | `/api/simulator/messages` | Entrada pelo SimulatorChannel. |
| GET | `/api/conversations` | Lista da Inbox/CRM. |
| GET | `/api/conversations/:id/messages` | Histórico da conversa. |
| POST | `/api/conversations/:id/messages` | Mensagem humana pelo canal original. |
| POST | `/api/conversations/:id/control` | Assumir ou devolver para IA. |
| POST | `/api/conversations/:id/read` | Zera o contador de não lidas. |
| GET | `/api/catalog` | Serviços, preços, duração e profissionais válidos para a agenda. |
| GET | `/api/clients` | Lista de clientes. |
| POST | `/api/clients/import` | Importação CSV/XLSX/XLS. |
| GET/POST | `/api/follow-ups` | Infraestrutura de follow-up e elegibilidade. |
| PATCH | `/api/follow-ups/:id` | Cancela um follow-up pendente. |
| GET/POST | `/api/appointments` | Lista e cria agendamentos. |
| PATCH | `/api/appointments/:id` | Confirma, conclui ou cancela; a confirmação avisa o cliente quando elegível. |
| GET/POST | `/api/whatsapp/templates` | Registro local de templates aprovados. |
| GET | `/api/settings/whatsapp` | Diagnóstico sem secrets. |
| POST | `/api/settings/whatsapp/test` | Consulta segura de metadados do número. |
| POST | `/api/internal/inbound/run` | Recupera mensagens de entrada pendentes. Exige `INTERNAL_JOB_SECRET`. |
| POST | `/api/internal/follow-ups/run` | Processa follow-ups vencidos com claim e retry. Exige `INTERNAL_JOB_SECRET`. |

As APIs operacionais exigem a sessão privada do CRM. Webhooks usam assinatura própria, e executores internos usam um segredo efêmero separado do segredo do gateway. Login incorreto é limitado por cliente e bloqueado temporariamente depois de cinco falhas.
