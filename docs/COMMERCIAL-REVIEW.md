# Revisão comercial do MVP

## Decisão de produto

O CRM existe para transformar conversas reais do WhatsApp em pedidos de agendamento, recuperar oportunidades e mostrar à equipe a próxima ação. A agenda do salão não está conectada nesta versão. Portanto, a IA coleta serviço, dia e período preferidos, mas nunca oferece disponibilidade nem confirma uma reserva; a equipe consulta a agenda real e registra a confirmação manualmente.

## Fluxo entregue

1. O lead entra pelo WhatsApp e é salvo antes de qualquer processamento.
2. O gate profissional interrompe silenciosamente casos que exigem julgamento técnico.
3. O agente responde com os fatos do catálogo, detecta intenção e atualiza serviço, objeção, estágio e próxima ação.
4. Pedidos de agendamento são conduzidos até serviço + dia + período e entram na fila **Agir agora** para confirmação da equipe.
5. Se a cliente deixa uma conversa comercial sem resposta, um retorno curto e contextual é programado.
6. Resposta, opt-out, agendamento ou tomada de controle cancelam retornos pendentes.

## Funil e ações

Etapas: `NEW_LEAD`, `IN_CONVERSATION`, `QUALIFIED`, `WANTS_TO_BOOK`, `BOOKED`, `ATTENDED` e `LOST`. Handoff profissional, controle humano e falta de resposta são estados paralelos apresentados nos cartões e na fila.

A etapa `BOOKED` só vem de um agendamento persistido pela equipe. O modelo nunca pode fechar a venda apenas por texto.

## Follow-up

- Alta prioridade: intenção de agendamento abandonada.
- Média: serviço ou preço discutido.
- Baixa: “vou pensar”.
- Primeira tentativa entre 2 e 20 horas, conforme o contexto.
- Máximo de 2 retornos em 30 dias por cliente.
- Apenas um retorno pendente por vez.
- Fora da janela permitida do WhatsApp, o retorno aguarda um template aprovado.
- Uma resposta explícita de recusa ou opt-out não é contada como lead recuperado.

## Métricas

Leads e conversão usam somente conversas reais do WhatsApp; o simulador e contatos importados sem conversa ficam fora. A conversão semanal usa a coorte de leads recebidos desde segunda-feira e conta no máximo uma conversão por lead. Valor agendado usa o preço capturado na criação manual do agendamento; valores ausentes permanecem ausentes, sem estimativa inventada.

## Limite conhecido e próximo passo

O fechamento ainda depende da equipe conferir a agenda e registrar o horário. Quando o salão decidir integrar uma agenda real, o ponto de extensão é substituir essa confirmação manual por consulta e reserva atômicas. Até lá, o comportamento seguro é captar a preferência e priorizar o pedido para a equipe.
