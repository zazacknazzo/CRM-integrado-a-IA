import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';

const gatewaySecret = randomBytes(32).toString('hex');
const internalSecret = randomBytes(32).toString('hex');
const appCommand =
  process.env.ATENDE_RUN_MODE === 'production' ? 'start' : 'dev';
const sharedEnvironment = {
  ...process.env,
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
  WHATSAPP_PROVIDER: 'baileys',
  WHATSAPP_WEB_GATEWAY_URL: 'http://127.0.0.1:8789',
  WHATSAPP_WEB_GATEWAY_SECRET: gatewaySecret,
  INTERNAL_JOB_SECRET: internalSecret,
  ALLOW_LOCAL_PASSWORDLESS: 'true',
  WHATSAPP_WEB_APP_URL: 'http://localhost:3000/api/webhooks/whatsapp-web',
};

const pnpmCli = process.env.npm_execpath;
const app = pnpmCli
  ? spawn(process.execPath, [pnpmCli, appCommand], {
      env: sharedEnvironment,
      stdio: 'inherit',
    })
  : spawn('pnpm', [appCommand], { env: sharedEnvironment, stdio: 'inherit' });
const gateway = spawn(process.execPath, ['gateway/whatsapp-web.mjs'], {
  env: sharedEnvironment,
  stdio: 'inherit',
});
const children = [app, gateway];
let stopping = false;

const clientsSource = new URL('../data/Clientes.xlsx', import.meta.url);
const clientsMarker = new URL(
  '../.data/base-clientes-v1.imported.json',
  import.meta.url,
);
const localDataDirectory = new URL('../.data/', import.meta.url);
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function importInitialClientBase() {
  if (!(await exists(clientsSource)) || (await exists(clientsMarker))) return;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const health = await fetch('http://localhost:3000/api/auth/session', {
        signal: AbortSignal.timeout(2000),
      });
      if (health.ok) break;
    } catch {}
    await delay(1000);
  }
  const bytes = await readFile(clientsSource);
  const form = new FormData();
  form.set(
    'file',
    new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    'Clientes.xlsx',
  );
  const response = await fetch('http://localhost:3000/api/clients/import', {
    method: 'POST',
    headers: { Authorization: `Bearer ${internalSecret}` },
    body: form,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      result.error || 'Falha ao importar a base inicial de clientes',
    );
  await mkdir(localDataDirectory, { recursive: true });
  await writeFile(
    clientsMarker,
    JSON.stringify(
      { importedAt: new Date().toISOString(), ...result },
      null,
      2,
    ),
  );
  console.log(
    `Base inicial pronta: ${result.imported ?? 0} clientes importados.`,
  );
}

void importInitialClientBase().catch((error) => {
  console.error(
    `A base inicial de clientes não foi importada: ${error instanceof Error ? error.message : String(error)}`,
  );
});

async function runDueFollowUps() {
  try {
    const response = await fetch(
      'http://localhost:3000/api/internal/follow-ups/run',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${internalSecret}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (result.sent || result.failed || result.cancelled)
      console.log(
        `Follow-ups: ${result.sent} enviados, ${result.failed} falharam, ${result.cancelled} cancelados.`,
      );
  } catch (error) {
    if (!stopping)
      console.error(
        `Agendador de follow-up indisponível: ${error instanceof Error ? error.message : String(error)}`,
      );
  }
}

const followUpTimer = setInterval(() => void runDueFollowUps(), 30_000);
setTimeout(() => void runDueFollowUps(), 5_000);

async function recoverInboundMessages() {
  try {
    const response = await fetch(
      'http://localhost:3000/api/internal/inbound/run',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${internalSecret}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (result.checked)
      console.log(
        `Recuperação automática: ${result.checked} conversa(s) verificada(s).`,
      );
  } catch (error) {
    if (!stopping)
      console.error(
        `Recuperação de mensagens indisponível: ${error instanceof Error ? error.message : String(error)}`,
      );
  }
}

const inboundRecoveryTimer = setInterval(
  () => void recoverInboundMessages(),
  15_000,
);
setTimeout(() => void recoverInboundMessages(), 8_000);

function runBackup() {
  const backup = spawn(process.execPath, ['scripts/backup.mjs'], {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  backup.on('error', (error) =>
    console.error(`Backup não iniciado: ${error.message}`),
  );
}

const backupTimer = setInterval(runBackup, 24 * 60 * 60 * 1000);
setTimeout(runBackup, 15_000);

function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  clearInterval(followUpTimer);
  clearInterval(inboundRecoveryTimer);
  clearInterval(backupTimer);
  for (const child of children) if (!child.killed) child.kill(signal);
}

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (!stopping && code !== 0)
      console.error(`Um processo do WhatsApp encerrou (${signal || code}).`);
    stop();
  });
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
