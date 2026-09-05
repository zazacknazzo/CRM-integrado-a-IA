# Atende — CRM inteligente no WhatsApp

MVP local de Inbox, CRM e automação comercial com dois canais que alimentam o mesmo domínio:

```text
SimulatorChannel ───────┐
WhatsAppCloudApi ───────┼─> persistência ─> Professional Gate ─> Commercial Agent
WhatsAppWebGateway ─────┘                                      ─> verificação local
                                                               ─> CRM ─> dispatch
```

O caminho `PROFESSIONAL_HANDOFF` termina depois de salvar o handoff e atualizar o CRM. Ele não chama o agente comercial e não chama `sendMessage()`.

## O que está implementado

- Inbox com polling quase em tempo real, status e controle `AI_ACTIVE`, `HUMAN_CONTROL` e `PROFESSIONAL_HANDOFF`.
- `SimulatorChannel`, `WhatsAppCloudApiChannel` e o gateway local opcional sob a mesma interface `MessageChannel`.
- Webhook oficial da Meta: verificação GET, assinatura HMAC `X-Hub-Signature-256`, parsing de texto, imagem, áudio, documento, localização, interativos e status.
- Idempotência por `wamid` e registro de evento externo.
- Fila persistente do gateway, recuperação automática de entradas e idempotência de respostas mesmo após reinício.
- Status `queued`, `sent`, `delivered`, `read` e `failed`, sem regressão quando eventos chegam fora de ordem.
- Debounce configurável para mensagens consecutivas.
- Gate profissional e verificação final determinísticos; somente o agente comercial usa a Responses API em uma mensagem normal.
- Dispatch de IA centralizado com releitura do estado no banco imediatamente antes do envio.
- Takeover humano, resposta pela Inbox e retorno explícito à IA.
- CRM comercial com próxima ação, objeção, valor potencial, fila de atenção, agenda manual com bloqueio de conflito e follow-ups contextuais com limites e cancelamento automático.
- Acesso remoto por Cloudflare Tunnel protegido por senha e sessão HttpOnly de 12 horas.
- Alertas de atenção no navegador, início automático no Windows, supervisor e backups diários criptografados e verificados.
- Importação conservadora de clientes por CSV, XLSX e XLS.
- SQLite local via runtime D1/Miniflare, com migrations Drizzle versionadas.
- Página `Settings > WhatsApp`, teste seguro de configuração e diagnóstico sem revelar tokens.

## Início rápido local

Requisitos: Node.js 22.13+ e pnpm.

```bash
cp .env.example .dev.vars
pnpm install
pnpm db:local
pnpm dev
```

Abra `http://localhost:3000`.

Se o runtime gerenciado do Codex bloquear scripts nativos opcionais com `ERR_PNPM_IGNORED_BUILDS`, não aprove scripts desconhecidos apenas para contornar a política. Com as dependências já presentes, inicie com `./node_modules/.bin/vinext dev` e gere o build com `./node_modules/.bin/vinext build`.

O banco SQLite local fica sob `.wrangler/state/v3/d1` e não entra no Git. Sempre execute `pnpm db:local` depois de baixar uma migration nova.

Para testar exatamente o servidor usado no PC do salão, gere o build e inicie o preview Workers local (não use `vinext start`, pois ele não fornece o binding D1):

```bash
pnpm build
pnpm start
```

Ao iniciar o pacote do salão pela primeira vez, `data/Clientes.xlsx` é importado automaticamente e de forma idempotente. O catálogo comercial usado pelo agente está em `knowledge/business.md`; as planilhas originais ficam em `data/` como fonte local do salão.

### Testar sem Meta ou OpenAI

Abra `http://localhost:3000/simulator`. O simulador usa o mesmo pipeline comercial do WhatsApp, mas fica fora das métricas de leads e conversão.

Teste comercial:

```text
Quero marcar progressiva na sexta à tarde.
```

Teste de handoff:

```text
Queria fazer progressiva. Só que meu cabelo está quebrando depois da química.
```

No segundo caso, o resultado correto é `PROFESSIONAL_HANDOFF` e zero mensagem de saída.

## Modo rápido para o salão (WhatsApp Web)

Este modo é uma ponte temporária e não oficial. Ele permite conectar um aparelho por QR Code sem concluir o cadastro de desenvolvedor da Meta. Use somente um número exclusivo do salão, não faça disparos em massa e mantenha o computador ligado durante o atendimento. A sessão criptográfica fica em `.data/whatsapp-web-auth` e nunca entra no Git.

```bash
pnpm install
pnpm db:local
pnpm whatsapp:web
```

Depois:

1. Abra `http://127.0.0.1:8789`.
2. No celular do salão, abra **WhatsApp > Configurações > Aparelhos conectados > Conectar aparelho**.
3. Leia o QR Code.
4. Abra `http://localhost:3000/settings/whatsapp` e clique em **Testar configuração**.
5. Envie uma mensagem de outro celular e confirme a conversa na Inbox.

O comando `pnpm whatsapp:web` inicia o CRM e o gateway juntos. Um segredo temporário diferente é criado em memória a cada inicialização; ele não é exibido nem gravado em arquivo. A Cloud API oficial permanece disponível para a migração posterior.

Para instalar em um PC Windows separado, siga [GUIA-PC-DO-SALAO.md](GUIA-PC-DO-SALAO.md) ou use diretamente `INSTALAR-NO-PC.bat` e `INICIAR-ATENDE.bat`.

O acesso remoto fica bloqueado enquanto `CRM_ACCESS_PASSWORD` não estiver configurado. No Windows, `INSTALAR-NO-PC.bat` cria essa senha e `ATIVAR-ACESSO-REMOTO.bat` instala/configura o Cloudflare Tunnel. Nunca abra a porta 3000 diretamente no roteador.

### Docker opcional

O mesmo pacote pode rodar em um container no PC do salão. Preencha `.dev.vars` com `OPENAI_API_KEY`, `OPENAI_MODEL`, `CRM_ACCESS_PASSWORD` e `CRM_SESSION_SECRET`, depois execute:

```bash
docker compose up --build -d
docker compose logs -f atende
```

Abra `http://127.0.0.1:8789` para o QR Code e `http://localhost:3000` para o CRM. Banco, sessão do WhatsApp e backups ficam em volumes/pastas persistentes do host. As duas portas estão vinculadas somente ao computador local; para acesso externo, continue usando o Cloudflare Tunnel.

### Backup

`pnpm backup` cria um export consistente do D1, inclui a sessão do WhatsApp, grava hashes de integridade e usa AES-256-GCM quando `BACKUP_ENCRYPTION_KEY` está definida. `BACKUP_COPY_DIRECTORY` pode apontar para outro disco ou pasta sincronizada. Guarde a chave fora do PC: sem ela, um backup criptografado não pode ser restaurado.

## Conectar pela Cloud API oficial

Este é o caminho recomendado para produção sustentável. O canal usa diretamente a [WhatsApp Business Platform / Cloud API oficial](https://developers.facebook.com/docs/whatsapp/cloud-api/).

### 1. Criar o app na Meta

1. Entre em [Meta for Developers](https://developers.facebook.com/apps/).
2. Clique em **Create app**.
3. Escolha um caso de uso empresarial/Business quando o painel solicitar o tipo.
4. No app criado, adicione o produto **WhatsApp**.
5. Vincule ou crie um Business Portfolio quando o painel solicitar.

Esses passos são obrigatoriamente manuais no painel da Meta; o projeto não pode criar ou aprovar o app por você.

### 2. Usar primeiro o número de teste da Meta

Em **WhatsApp > API Setup**:

1. Use o número de teste exibido pela Meta.
2. Adicione seu celular como destinatário de teste e conclua a confirmação solicitada.
3. Copie o **Phone Number ID**.
4. Copie o **WhatsApp Business Account ID**.
5. Gere/use o access token de teste mostrado no painel.

O número de teste e o número comercial usam a mesma arquitetura. A troca posterior é somente configuração.

### 3. Configurar as variáveis

Copie `.env.example` para `.dev.vars` e preencha no servidor:

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-luna

WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_VERIFY_TOKEN=
META_APP_SECRET=
WHATSAPP_GRAPH_API_VERSION=

APP_URL=https://sua-url-publica.example
DATABASE_URL=.wrangler/state/v3/d1
```

- `WHATSAPP_VERIFY_TOKEN`: crie uma frase secreta longa; ela precisa ser idêntica no app e no painel da Meta.
- `META_APP_SECRET`: copie em **App settings > Basic > App secret**.
- `WHATSAPP_GRAPH_API_VERSION`: use a versão atualmente recomendada no painel/documentação da Meta, por exemplo no formato `vNN.0`. O código não fixa silenciosamente uma versão.
- Nunca coloque `.dev.vars`, tokens ou secrets no Git.

### 4. Iniciar app e banco

```bash
pnpm db:local
pnpm dev
```

Confirme `http://localhost:3000/settings/whatsapp`.

### 5. Expor o webhook com HTTPS

Em outro terminal:

```bash
pnpm tunnel
```

O script usa Cloudflare Tunnel quando `cloudflared` está instalado e aceita ngrok como alternativa. Nenhum provedor é obrigatório para a aplicação.

Anote a URL HTTPS pública e atualize:

```dotenv
APP_URL=https://<url-publica>
```

Reinicie a aplicação depois de alterar `.dev.vars`.

O callback final é:

```text
https://<url-publica>/api/webhooks/whatsapp
```

### 6. Verificar o webhook na Meta

No painel do app, abra **WhatsApp > Configuration**:

1. Clique em **Edit** na configuração do webhook.
2. Informe a callback URL acima.
3. Informe exatamente o valor de `WHATSAPP_VERIFY_TOKEN`.
4. Clique em **Verify and save**.

A Meta fará um GET com `hub.mode`, `hub.verify_token` e `hub.challenge`. O endpoint só devolve o challenge quando o token confere.

### 7. Assinar os eventos

Ainda na configuração de webhook:

1. Localize os campos do objeto WhatsApp Business Account.
2. Assine pelo menos o campo **messages**.

O mesmo campo entrega mensagens recebidas e atualizações de status. O POST só é aceito quando a assinatura HMAC calculada com `META_APP_SECRET` é válida.

### 8. Testar com o número da Meta

1. De um celular autorizado como destinatário de teste, envie uma mensagem para o número de teste.
2. Confira `Settings > WhatsApp > Último webhook`.
3. Abra a Inbox e confirme cliente, conversa e mensagem.
4. Verifique a resposta no WhatsApp.
5. Envie um relato profissional e confirme que nenhuma resposta chega.

### 9. Conectar o número comercial

No WhatsApp Manager / API Setup:

1. Conclua os requisitos de verificação empresarial solicitados pela Meta.
2. Adicione e registre o número comercial seguindo o fluxo do painel.
3. Configure um token apropriado para servidor com as permissões exigidas pela Meta.
4. Substitua `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` e `WHATSAPP_BUSINESS_ACCOUNT_ID`.
5. Reinicie e clique em **Testar configuração**.

Registro do número, verificação da empresa, permissões e aprovação de templates são passos manuais da Meta. Não há automação local que substitua essas aprovações.

### 10. Templates e janela de atendimento

- A aplicação grava `last_customer_message_at` e `customer_service_window_expires_at`.
- Dentro da janela, texto livre pode ser elegível.
- Fora da janela, follow-up é marcado `TEMPLATE_REQUIRED`.
- Cadastre no sistema somente nomes/idiomas de templates já aprovados no WhatsApp Manager.
- O sistema nunca inventa nem envia um template não aprovado.

### Troubleshooting

| Mensagem | Verificação |
|---|---|
| `WHATSAPP_ACCESS_TOKEN missing` | Preencha `.dev.vars` e reinicie. |
| `Webhook verification failed` | Callback URL ou verify token não conferem. |
| `Webhook signature invalid` | `META_APP_SECRET` está errado ou o POST não veio da Meta. |
| `Meta API returned 401` | Token expirado, inválido ou sem permissão. |
| `Phone Number ID invalid` | Confirme o ID em WhatsApp > API Setup. |
| `Customer service window expired` | Use somente template aprovado ou aguarde o cliente escrever. |
| `Message blocked because conversation is HUMAN_CONTROL` | Clique em “Devolver para IA”; a IA reativa e responde à última mensagem que ficou aguardando. |
| `Duplicate webhook ignored` | Comportamento esperado para reentrega da Meta. |

## Testes

```bash
pnpm test
pnpm typecheck
pnpm build
```

O checklist de teste real está em [docs/REAL-WHATSAPP-E2E.md](docs/REAL-WHATSAPP-E2E.md).

## Documentação técnica

- [Revisão comercial e limites do MVP](docs/COMMERCIAL-REVIEW.md)
- [Arquitetura e invariantes](docs/ARCHITECTURE.md)
- [Teste end-to-end real](docs/REAL-WHATSAPP-E2E.md)
- [Endpoints](docs/API.md)

## Fontes oficiais

- [Meta: WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/)
- [Meta: primeiros passos](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started)
- [Meta: webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks)
- [OpenAI: criar uma resposta](https://developers.openai.com/api/reference/resources/responses/methods/create)
