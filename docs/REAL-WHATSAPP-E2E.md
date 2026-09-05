# Teste end-to-end com WhatsApp real

Pré-condições:

- `.dev.vars` preenchido.
- Migration local aplicada.
- Número de teste ou comercial configurado na Meta.
- Callback HTTPS verificado e campo `messages` assinado.
- Celular externo autorizado quando estiver usando o número de teste.

## Execução

1. Execute `pnpm db:local`.
2. Execute `pnpm dev`.
3. Execute `pnpm tunnel` em outro terminal.
4. Atualize `APP_URL`, reinicie o app e confirme a callback na Meta.
5. Envie uma mensagem comercial de um celular externo.
6. Confirme que `Último webhook` mudou em `Settings > WhatsApp`.
7. Confirme que o cliente foi criado na tela Clientes.
8. Confirme que a conversa e a mensagem aparecem na Inbox.
9. Confirme que a IA respondeu no mesmo WhatsApp.
10. Confirme que a oportunidade apareceu no Pipeline.
11. Envie: “Queria fazer progressiva. Só que meu cabelo está quebrando depois de uma química.”
12. Confirme `PROFESSIONAL_HANDOFF` na Inbox.
13. Aguarde e confirme que nenhuma mensagem automática chegou ao celular.
14. Clique em `Assumir conversa`.
15. Responda manualmente pela caixa da Inbox.
16. Confirme que a mensagem chegou no mesmo WhatsApp e aparece com `sender_type = HUMAN`.
17. Envie outra mensagem do celular.
18. Confirme que ela foi salva, mas a IA não respondeu.
19. Clique em `Devolver para IA`.
20. Confirme que a IA responde à última mensagem que ficou aguardando, sem exigir uma nova mensagem do cliente.
21. Clique em `Assumir conversa` e depois em `Devolver para IA`, sem uma nova mensagem do cliente, e confirme que a resposta não é duplicada.
22. Envie uma nova mensagem comercial.
23. Confirme que a automação continua ativa e que os status evoluem de `sent` para `delivered`/`read` quando a Meta enviar os receipts.

## Critérios de reprovação

- Qualquer resposta automática após o relato profissional.
- Duas respostas ao reenviar o mesmo webhook/`wamid`.
- Resposta da IA depois que o profissional assumiu.
- Texto livre fora da janela de atendimento.
- Token ou secret exposto na UI/log.
- Mensagem humana abrindo outro canal ou reativando a IA automaticamente.
