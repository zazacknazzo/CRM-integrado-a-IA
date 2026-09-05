import { createDecipheriv, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, resolve, sep } from 'node:path';

process.umask(0o077);

const root = resolve(import.meta.dirname, '..');
const backupRoot = resolve(root, 'backups');
const requested = resolve(process.argv[2] || '');
if (!process.argv[2] || !requested.startsWith(`${backupRoot}${sep}`))
  throw new Error('Informe uma pasta existente dentro de backups.');
if (!(await stat(requested)).isDirectory())
  throw new Error('Backup não encontrado.');
const stamp = new Date()
  .toISOString()
  .replaceAll(':', '-')
  .replaceAll('.', '-');

async function localVars() {
  try {
    const raw = await readFile(resolve(root, '.dev.vars'), 'utf8');
    return Object.fromEntries(
      raw
        .split(/\r?\n/)
        .filter(
          (line) => line && !line.trim().startsWith('#') && line.includes('='),
        )
        .map((line) => [
          line.slice(0, line.indexOf('=')).trim(),
          parseDevVarValue(line.slice(line.indexOf('=') + 1).trim()),
        ]),
    );
  } catch {
    return {};
  }
}

function parseDevVarValue(value) {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {}
  }
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('`') && value.endsWith('`'))
  )
    return value.slice(1, -1);
  return value;
}

function encryptionKey(value) {
  if (!value) return null;
  return /^[a-f0-9]{64}$/i.test(value)
    ? Buffer.from(value, 'hex')
    : createHash('sha256').update(value).digest();
}

const manifest = JSON.parse(
  await readFile(resolve(requested, 'backup.json'), 'utf8'),
);
const vars = await localVars();
const key = encryptionKey(
  process.env.BACKUP_ENCRYPTION_KEY || vars.BACKUP_ENCRYPTION_KEY,
);
if (manifest.encrypted && !key)
  throw new Error(
    'BACKUP_ENCRYPTION_KEY é obrigatória para restaurar este backup.',
  );

const targets = [
  ['database', resolve(root, '.wrangler/state/v3/d1')],
  ['whatsapp-session', resolve(root, '.data/whatsapp-web-auth')],
];
for (const [name, target] of targets) {
  if (!manifest.copied?.includes(name)) continue;
  const staging = `${target}.restore-${stamp}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true, mode: 0o700 });
  if (manifest.encrypted) {
    for (const file of manifest.files.filter((item) =>
      item.path.startsWith(`${name}/`),
    )) {
      const relativePath = file.path.slice(name.length + 1);
      const output = resolve(staging, relativePath);
      if (!output.startsWith(`${staging}${sep}`))
        throw new Error('Manifesto de backup inválido.');
      const encrypted = await readFile(resolve(requested, `${file.path}.enc`));
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        encrypted.subarray(0, 12),
      );
      decipher.setAuthTag(encrypted.subarray(12, 28));
      const plaintext = Buffer.concat([
        decipher.update(encrypted.subarray(28)),
        decipher.final(),
      ]);
      if (createHash('sha256').update(plaintext).digest('hex') !== file.sha256)
        throw new Error(`Arquivo corrompido: ${file.path}`);
      await mkdir(dirname(output), { recursive: true, mode: 0o700 });
      await writeFile(output, plaintext, { mode: 0o600 });
    }
  } else {
    await rm(staging, { recursive: true, force: true });
    await cp(resolve(requested, name), staging, { recursive: true });
    for (const file of manifest.files ?? []) {
      if (!file.path.startsWith(`${name}/`)) continue;
      const hash = createHash('sha256')
        .update(await readFile(resolve(requested, file.path)))
        .digest('hex');
      if (hash !== file.sha256)
        throw new Error(`Arquivo corrompido: ${file.path}`);
    }
  }
  await mkdir(resolve(target, '..'), { recursive: true, mode: 0o700 });
  const previous = `${target}.pre-restore-${stamp}`;
  try {
    await rename(target, previous);
  } catch {}
  if (name === 'database' && manifest.databaseFormat === 'd1-sql-export') {
    const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
    const imported = spawnSync(
      process.execPath,
      [
        wrangler,
        'd1',
        'execute',
        'atende-local',
        '--local',
        '--config',
        'wrangler.local.jsonc',
        '--file',
        resolve(staging, 'atende.sql'),
      ],
      {
        cwd: root,
        stdio: 'inherit',
        timeout: 120_000,
      },
    );
    if (imported.status !== 0) {
      await rm(target, { recursive: true, force: true });
      try {
        await rename(previous, target);
      } catch {}
      throw new Error(
        `Falha ao importar o snapshot do banco (código ${imported.status ?? 'desconhecido'}). Os dados anteriores foram preservados.`,
      );
    }
    await rm(staging, { recursive: true, force: true });
  } else {
    await rename(staging, target);
  }
}
console.log(
  `Backup ${basename(requested)} verificado e restaurado. A cópia anterior foi preservada com o sufixo pre-restore.`,
);
