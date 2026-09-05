# Instalar no PC do salão

Use um PC com Windows 10 ou 11 que possa permanecer ligado e conectado à internet durante o atendimento.

## Primeira instalação

1. Instale o Node.js LTS em <https://nodejs.org/>. O instalador do Atende instala a versão correta do pnpm automaticamente.
2. Copie e descompacte a pasta inteira do Atende no PC do salão.
3. Abra `INSTALAR-NO-PC.bat`.
4. Quando solicitado, cole a chave da OpenAI e crie uma senha exclusiva para o CRM. As duas entradas ficam ocultas e são salvas somente naquele PC.
5. Abra `ATIVAR-ACESSO-REMOTO.bat`.
   - Sem uma conta Cloudflare configurada, ele cria um link rápido que muda quando o PC reinicia.
   - Com um token de Cloudflare Tunnel, ele usa o endereço permanente configurado no painel Cloudflare.
6. Abra `INICIAR-ATENDE.bat` na primeira vez.
7. No próprio PC, abra <http://127.0.0.1:8789> e leia o QR Code em **WhatsApp > Configurações > Aparelhos conectados > Conectar aparelho**.
8. Abra <http://localhost:3000> para conferir a Inbox.

O instalador adiciona o Atende à inicialização do usuário. O backup roda ao iniciar e depois a cada 24 horas. Se o processo falhar, o supervisor tenta iniciá-lo de novo após cinco segundos.

## Acesso pelo link

O link remoto nunca libera os dados sem autenticação. Ao abri-lo, use a senha criada na instalação. A sessão expira depois de 12 horas.

No modo rápido, procure o endereço `https://...trycloudflare.com` em `logs\tunnel-error.log` ou `logs\tunnel.log`. Esse endereço muda depois de cada reinício. Para ter um endereço fixo, crie um Tunnel no painel da Cloudflare, associe seu domínio e execute novamente `ATIVAR-ACESSO-REMOTO.bat` informando o token.

Não exponha diretamente as portas 3000 ou 8789 no roteador. A porta 8789 é apenas local e mostra o vínculo do WhatsApp.

## Uso diário

- Basta ligar o PC e fazer login no Windows.
- O CRM, WhatsApp e link remoto são iniciados automaticamente.
- Para conferir a operação, veja `logs\atende.log`, `logs\atende-error.log` e `logs\supervisor.log`.
- Clique em **Alertas** na Inbox em cada navegador que deve avisar sobre handoffs profissionais.

O PC não deve entrar em suspensão. Configure o Windows para permanecer acordado quando estiver ligado à tomada.

## Backup e restauração

- O backup diário cria um export consistente do banco, guarda a sessão do WhatsApp em `backups\`, verifica cada arquivo e mantém os 14 mais recentes.
- Os backups são criptografados com AES-256-GCM pela chave criada durante a instalação.
- Para manter uma cópia fora do PC, defina `BACKUP_COPY_DIRECTORY` em `.dev.vars` com uma pasta de outro disco ou do OneDrive.
- Para criar um backup na hora, abra `BACKUP-ATENDE.bat`.
- Para restaurar, feche o Atende, abra `RESTAURAR-BACKUP.bat` e informe o nome de uma pasta dentro de `backups`.
- A restauração renomeia os dados atuais com o sufixo `pre-restore`, para que a operação seja reversível.
- A chave da OpenAI, a senha do CRM e a chave do backup não entram no backup. Guarde-as em um gerenciador de senhas; sem `BACKUP_ENCRYPTION_KEY`, a restauração de um backup criptografado é impossível.

## Limitações do modo rápido

- A conexão por WhatsApp Web/Baileys não é oficial; pode exigir novo QR Code ou deixar de funcionar após mudanças do WhatsApp.
- Use um número exclusivo do salão e não faça disparos em massa.
- O PC precisa ficar ligado.
- Migre para a Cloud API oficial quando o fluxo comercial estiver validado.
