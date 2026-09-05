import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { createServer } from 'node:http';
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { resolve } from 'node:path';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  normalizeMessageContent,
  useMultiFileAuthState as loadAuthState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import QRCode from 'qrcode';

process.umask(0o077);

const host = process.env.WHATSAPP_WEB_HOST || '127.0.0.1';
const port = Number(process.env.WHATSAPP_WEB_PORT || 8789);
const appWebhookUrl =
  process.env.WHATSAPP_WEB_APP_URL ||
  'http://localhost:3000/api/webhooks/whatsapp-web';
const gatewaySecret = process.env.WHATSAPP_WEB_GATEWAY_SECRET || '';
const authDirectory = resolve(
  process.env.WHATSAPP_WEB_AUTH_DIR || '.data/whatsapp-web-auth',
);

if (!gatewaySecret) throw new Error('WHATSAPP_WEB_GATEWAY_SECRET missing');

const logger = pino({ level: 'silent' });
const sentByIdempotencyKey = new Map();
const pendingDeliveries = new Set();
const activeDeliveryFiles = new Set();
const sentCacheFile = resolve(authDirectory, 'sent-idempotency.json');
const deliveryQueueDirectory = resolve(authDirectory, 'pending-webhooks');
let socket;
let connectionState = 'starting';
let qrDataUrl = null;
let reconnectTimer;
let lastMessageEventAt = null;
let lastInboundQueuedAt = null;
let lastDropReason = null;
let lastUpsertType = null;
let ignoredFromMe = 0;
let connectionGeneration = 0;
let connectionOpenedAt = null;
let lastConnectionClosedAt = null;
let lastOutboundSentAt = null;
let lastRecoveryAt = null;
let lastRecoveryReason = null;
let recoveryInProgress = false;
let shuttingDown = false;
let sentCacheWrite = Promise.resolve();

async function hardenDirectory(directory) {
  try {
    await chmod(directory, 0o700);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await hardenDirectory(path);
      else await chmod(path, 0o600);
    }
  } catch {}
}

async function loadSentCache() {
  try {
    const rows = JSON.parse(await readFile(sentCacheFile, 'utf8'));
    if (Array.isArray(rows))
      for (const [key, value] of rows)
        if (typeof key === 'string' && value?.externalId)
          sentByIdempotencyKey.set(key, value);
  } catch {}
}

function persistSentCache() {
  sentCacheWrite = sentCacheWrite
    .then(async () => {
      const rows = [...sentByIdempotencyKey.entries()].slice(-5000);
      const temporary = `${sentCacheFile}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(rows), { mode: 0o600 });
      await rename(temporary, sentCacheFile);
    })
    .catch((error) =>
      console.error(
        `Não foi possível salvar a idempotência do WhatsApp: ${error.message}`,
      ),
    );
  return sentCacheWrite;
}

function json(response, status, body) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

function authorized(request) {
  const supplied =
    request.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
  const expected = Buffer.from(gatewaySecret);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function readJson(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 64_000) throw new Error('Request body too large');
  }
  return JSON.parse(raw || '{}');
}

function maskAccount(value) {
  const digits = String(value || '')
    .split('@')[0]
    .split(':')[0]
    .replace(/\D/g, '');
  return digits.length > 4 ? `••••••${digits.slice(-4)}` : null;
}

function page() {
  const title =
    connectionState === 'connected'
      ? 'WhatsApp conectado'
      : connectionState === 'qr'
        ? 'Escaneie o QR Code'
        : 'Conectando…';
  const help =
    connectionState === 'connected'
      ? 'O Atende já pode receber e responder mensagens. Mantenha este processo aberto.'
      : connectionState === 'logged_out'
        ? 'A sessão foi desconectada. Reinicie o comando para gerar um novo QR Code.'
        : 'No celular do salão: WhatsApp → Configurações → Aparelhos conectados → Conectar aparelho.';
  const image = qrDataUrl
    ? `<img alt="QR Code para conectar o WhatsApp" src="${qrDataUrl}">`
    : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta content="width=device-width,initial-scale=1" name="viewport"><meta http-equiv="refresh" content="3"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#f6f6f2;color:#17231c;margin:0;min-height:100vh;display:grid;place-items:center}.card{width:min(92vw,460px);background:#fff;border:1px solid #dfe5df;border-radius:18px;padding:28px;text-align:center;box-shadow:0 16px 45px #263b2d14}h1{font-size:24px;margin:0 0 10px}p{font-size:15px;line-height:1.55;color:#5d6d62;margin:0}img{width:min(100%,320px);margin:22px auto 4px;display:block}.dot{width:10px;height:10px;border-radius:50%;background:${connectionState === 'connected' ? '#3f9260' : '#d39a42'};display:inline-block;margin-right:8px}</style></head><body><main class="card"><h1><span class="dot"></span>${title}</h1><p>${help}</p>${image}</main></body></html>`;
}

function secondsToIso(value) {
  if (typeof value === 'number') return new Date(value * 1000).toISOString();
  if (typeof value?.toNumber === 'function')
    return new Date(value.toNumber() * 1000).toISOString();
  const parsed = Number(value);
  return new Date(
    (Number.isFinite(parsed) ? parsed : Date.now() / 1000) * 1000,
  ).toISOString();
}

function messageAgeMilliseconds(message) {
  const timestamp = Date.parse(secondsToIso(message.messageTimestamp));
  return Number.isFinite(timestamp)
    ? Date.now() - timestamp
    : Number.POSITIVE_INFINITY;
}

function contentFrom(message) {
  const content = normalizeMessageContent(message.message);
  if (!content) return { type: 'unknown' };
  if (content.conversation) return { type: 'text', text: content.conversation };
  if (content.extendedTextMessage?.text)
    return { type: 'text', text: content.extendedTextMessage.text };
  if (content.imageMessage)
    return {
      type: 'image',
      text: content.imageMessage.caption,
      mediaId: message.key.id,
    };
  if (content.audioMessage) return { type: 'audio', mediaId: message.key.id };
  if (content.documentMessage)
    return {
      type: 'document',
      text: content.documentMessage.caption || content.documentMessage.fileName,
      mediaId: message.key.id,
    };
  if (content.locationMessage) {
    const location = content.locationMessage;
    return {
      type: 'location',
      text:
        [location.name, location.address].filter(Boolean).join(' — ') ||
        undefined,
      latitude: location.degreesLatitude,
      longitude: location.degreesLongitude,
    };
  }
  const interactiveText =
    content.buttonsResponseMessage?.selectedDisplayText ||
    content.listResponseMessage?.title ||
    content.templateButtonReplyMessage?.selectedDisplayText;
  if (interactiveText) return { type: 'interactive', text: interactiveText };
  return { type: 'unknown' };
}

async function phoneFrom(message) {
  let jid = message.key.remoteJid;
  if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return null;
  if (jid.endsWith('@lid')) {
    const alternate = message.key.remoteJidAlt;
    if (alternate?.endsWith('@s.whatsapp.net')) jid = alternate;
    else {
      try {
        jid =
          (await socket.signalRepository.lidMapping.getPNForLID(jid)) || jid;
      } catch {}
    }
  }
  if (!jid.endsWith('@s.whatsapp.net')) return null;
  return jid.split('@')[0].split(':')[0];
}

function signature(raw) {
  return createHmac('sha256', gatewaySecret).update(raw).digest('hex');
}

async function deliverWebhook(payload, attempt = 0) {
  const raw = JSON.stringify(payload);
  try {
    const response = await fetch(appWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-atende-signature': signature(raw),
      },
      body: raw,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    const delay = Math.min(60_000, 1_000 * 2 ** Math.min(attempt, 6));
    if (attempt === 0) {
      const reason =
        error instanceof Error ? error.message : 'erro desconhecido';
      console.warn(
        `O CRM está indisponível (${reason}); a mensagem será reenviada automaticamente.`,
      );
    }
    if (shuttingDown) throw error;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, delay));
    return deliverWebhook(payload, attempt + 1);
  }
}

function deliveryFileFor(payload) {
  const identity =
    payload.kind === 'message'
      ? `message:${payload.message?.externalId || randomUUID()}`
      : `status:${payload.externalId || randomUUID()}:${payload.status || ''}:${payload.timestamp || ''}`;
  return resolve(
    deliveryQueueDirectory,
    `${createHash('sha256').update(identity).digest('hex')}.json`,
  );
}

function startQueuedDelivery(file, payload) {
  if (activeDeliveryFiles.has(file)) return;
  activeDeliveryFiles.add(file);
  const delivery = deliverWebhook(payload)
    .then(() => rm(file, { force: true }))
    .catch((error) => {
      if (!shuttingDown)
        console.error(
          `[gateway] webhook ${payload.id ?? payload.externalId ?? 'sem-id'} permanece na fila:`,
          error instanceof Error ? error.message : error,
        );
    })
    .finally(() => {
      activeDeliveryFiles.delete(file);
      pendingDeliveries.delete(delivery);
    });
  pendingDeliveries.add(delivery);
}

async function queueWebhook(payload) {
  try {
    await mkdir(deliveryQueueDirectory, { recursive: true, mode: 0o700 });
    const file = deliveryFileFor(payload);
    await writeFile(file, JSON.stringify(payload), { mode: 0o600 });
    startQueuedDelivery(file, payload);
  } catch (error) {
    console.error(
      `Não foi possível persistir o evento do WhatsApp: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function recoverQueuedWebhooks() {
  await mkdir(deliveryQueueDirectory, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(deliveryQueueDirectory, {
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file = resolve(deliveryQueueDirectory, entry.name);
    try {
      startQueuedDelivery(file, JSON.parse(await readFile(file, 'utf8')));
    } catch {
      await rm(file, { force: true });
    }
  }
}

function mapStatus(value) {
  const status = Number(value);
  if (status >= 4) return 'read';
  if (status === 3) return 'delivered';
  if (status === 0) return 'failed';
  if (status >= 1) return 'sent';
  return null;
}

async function connect() {
  clearTimeout(reconnectTimer);
  connectionState = 'starting';
  const generation = ++connectionGeneration;
  await mkdir(authDirectory, { recursive: true, mode: 0o700 });
  await hardenDirectory(authDirectory);
  const { state, saveCreds } = await loadAuthState(authDirectory);
  const nextSocket = makeWASocket({
    auth: state,
    browser: Browsers.macOS('Atende Salão'),
    logger,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    keepAliveIntervalMs: 20_000,
    connectTimeoutMs: 60_000,
  });
  socket = nextSocket;

  nextSocket.ev.on('creds.update', async () => {
    await saveCreds();
    await hardenDirectory(authDirectory);
  });
  nextSocket.ev.on(
    'connection.update',
    async ({ connection, lastDisconnect, qr }) => {
      if (generation !== connectionGeneration) return;
      if (qr) {
        connectionState = 'qr';
        qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 360 });
        console.log(`QR Code pronto em http://${host}:${port}`);
      }
      if (connection === 'open') {
        connectionState = 'connected';
        connectionOpenedAt = new Date().toISOString();
        recoveryInProgress = false;
        qrDataUrl = null;
        console.log('WhatsApp conectado ao Atende.');
      }
      if (connection === 'close') {
        const code = new Boom(lastDisconnect?.error).output.statusCode;
        const shouldReconnect = code !== DisconnectReason.loggedOut;
        connectionState = shouldReconnect ? 'reconnecting' : 'logged_out';
        lastConnectionClosedAt = new Date().toISOString();
        qrDataUrl = null;
        if (shouldReconnect)
          reconnectTimer = setTimeout(() => void connect(), 2_000);
        else {
          recoveryInProgress = false;
          console.warn(
            'O WhatsApp removeu este aparelho conectado. Reinicie para vincular novamente.',
          );
        }
      }
    },
  );

  nextSocket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (generation !== connectionGeneration) return;
    lastMessageEventAt = new Date().toISOString();
    lastUpsertType = type;
    // Mensagens que chegaram durante uma reconexão podem vir como "append".
    // Aceitamos somente as muito recentes; a idempotência do CRM evita duplicatas.
    if (type !== 'notify' && type !== 'append') return;
    for (const message of messages) {
      if (type === 'append' && messageAgeMilliseconds(message) > 30 * 60_000)
        continue;
      if (message.key.fromMe) {
        ignoredFromMe += 1;
        lastDropReason = 'FROM_CONNECTED_ACCOUNT';
        continue;
      }
      if (!message.key.id) {
        lastDropReason = 'MISSING_MESSAGE_ID';
        continue;
      }
      const fromPhone = await phoneFrom(message);
      if (!fromPhone) {
        lastDropReason = String(message.key.remoteJid || '').endsWith('@lid')
          ? 'LID_WITHOUT_PHONE_MAPPING'
          : 'UNSUPPORTED_CHAT';
        continue;
      }
      const content = contentFrom(message);
      lastInboundQueuedAt = new Date().toISOString();
      lastDropReason = null;
      console.log(
        `Mensagem recebida do WhatsApp (${content.type}); encaminhando ao CRM.`,
      );
      void queueWebhook({
        kind: 'message',
        message: {
          externalId: `baileys:${message.key.id}`,
          channel: 'WHATSAPP',
          fromPhone,
          profileName: message.pushName || undefined,
          ...content,
          timestamp: secondsToIso(message.messageTimestamp),
        },
      });
    }
  });

  nextSocket.ev.on('messages.update', (updates) => {
    if (generation !== connectionGeneration) return;
    for (const { key, update } of updates) {
      if (!key.fromMe || !key.id) continue;
      const status = mapStatus(update.status);
      if (!status) continue;
      void queueWebhook({
        kind: 'status',
        externalId: `baileys:${key.id}`,
        status,
        timestamp: new Date().toISOString(),
      });
    }
  });
}

async function recoverConnection(reason) {
  if (recoveryInProgress || connectionState !== 'connected' || !socket) return;
  recoveryInProgress = true;
  lastRecoveryAt = new Date().toISOString();
  lastRecoveryReason = reason;
  connectionState = 'reconnecting';
  console.warn(`Reconectando o WhatsApp automaticamente (${reason}).`);
  try {
    await socket.end(
      new Boom('Automatic connection recovery', {
        statusCode: DisconnectReason.restartRequired,
      }),
    );
  } catch {
    recoveryInProgress = false;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => void connect(), 2_000);
  }
}

const recoveryTimer = setInterval(() => {
  if (connectionState !== 'connected' || !socket || recoveryInProgress) return;
  if (!socket.ws?.isOpen) {
    void recoverConnection('WEBSOCKET_CLOSED');
    return;
  }
}, 15_000);

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${host}:${port}`);
  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
    });
    response.end(page());
    return;
  }
  if (url.pathname === '/health') {
    if (!authorized(request))
      return json(response, 401, { error: 'Unauthorized' });
    return json(response, 200, {
      connected: connectionState === 'connected',
      account: maskAccount(socket?.user?.id),
      lastMessageEventAt,
      lastInboundQueuedAt,
      lastDropReason,
      lastUpsertType,
      ignoredFromMe,
      websocketOpen: Boolean(socket?.ws?.isOpen),
      connectionOpenedAt,
      lastConnectionClosedAt,
      lastOutboundSentAt,
      lastRecoveryAt,
      lastRecoveryReason,
    });
  }
  if (request.method === 'POST' && url.pathname === '/send') {
    if (!authorized(request))
      return json(response, 401, { error: 'Unauthorized' });
    if (connectionState !== 'connected' || !socket)
      return json(response, 503, { error: 'WhatsApp is not connected' });
    try {
      const body = await readJson(request);
      const to = String(body.to || '').replace(/\D/g, '');
      const text = String(body.text || '').trim();
      const idempotencyKey = String(body.idempotencyKey || randomUUID());
      if (!to || !text)
        return json(response, 400, { error: 'to and text are required' });
      const previous = sentByIdempotencyKey.get(idempotencyKey);
      if (previous) return json(response, 200, previous);
      const result = await socket.sendMessage(`${to}@s.whatsapp.net`, { text });
      if (!result?.key?.id) throw new Error('WhatsApp returned no message id');
      const payload = {
        externalId: `baileys:${result.key.id}`,
        acceptedAt: new Date().toISOString(),
      };
      lastOutboundSentAt = payload.acceptedAt;
      sentByIdempotencyKey.set(idempotencyKey, payload);
      await persistSentCache();
      return json(response, 200, payload);
    } catch (error) {
      return json(response, 500, {
        error:
          error instanceof Error ? error.message : 'Could not send message',
      });
    }
  }
  return json(response, 404, { error: 'Not found' });
});

async function start() {
  await mkdir(authDirectory, { recursive: true, mode: 0o700 });
  await loadSentCache();
  await recoverQueuedWebhooks();
  server.listen(port, host, () =>
    console.log(`Conexão local do WhatsApp: http://${host}:${port}`),
  );
  await connect();
}

void start().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function shutdown() {
  shuttingDown = true;
  clearTimeout(reconnectTimer);
  clearInterval(recoveryTimer);
  await Promise.allSettled(pendingDeliveries);
  server.close();
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
