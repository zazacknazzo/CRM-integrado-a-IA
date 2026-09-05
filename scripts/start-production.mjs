import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

process.umask(0o077);

const root = resolve(import.meta.dirname, '..');
const previewDirectory = resolve(root, 'dist/server');
const runtimeKeys = [
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'WHATSAPP_PROVIDER',
  'WHATSAPP_WEB_GATEWAY_URL',
  'WHATSAPP_WEB_GATEWAY_SECRET',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_BUSINESS_ACCOUNT_ID',
  'WHATSAPP_VERIFY_TOKEN',
  'META_APP_SECRET',
  'WHATSAPP_GRAPH_API_VERSION',
  'APP_URL',
  'MESSAGE_DEBOUNCE_MS',
  'WHATSAPP_WINDOW_HOURS',
  'MAX_PROMOTIONAL_FOLLOWUPS',
  'FOLLOWUP_LIMIT_WINDOW_DAYS',
  'LOG_LEVEL',
  'CRM_ACCESS_PASSWORD',
  'CRM_SESSION_SECRET',
  'INTERNAL_JOB_SECRET',
  'ALLOW_LOCAL_PASSWORDLESS',
];

let localVariables = '';
try {
  localVariables = await readFile(resolve(root, '.dev.vars'), 'utf8');
} catch {}
const overrides = runtimeKeys.flatMap((key) =>
  process.env[key] === undefined
    ? []
    : [`${key}=${JSON.stringify(process.env[key])}`],
);
await mkdir(previewDirectory, { recursive: true, mode: 0o700 });
await writeFile(
  resolve(previewDirectory, '.dev.vars'),
  `${localVariables.trim()}\n${overrides.join('\n')}\n`,
  { mode: 0o600 },
);

const vite = resolve(root, 'node_modules/vite/bin/vite.js');
const host = process.env.HOST || '0.0.0.0';
const port = process.env.PORT || '3000';
const child = spawn(
  process.execPath,
  [vite, 'preview', '--host', host, '--port', port, '--strictPort'],
  {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  },
);

for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => child.kill(signal));
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
