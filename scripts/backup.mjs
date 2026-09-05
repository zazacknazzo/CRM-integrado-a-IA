import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve, sep } from 'node:path';
import { makeD1ExportRestorable } from './d1-export.mjs';

process.umask(0o077);

const root = resolve(import.meta.dirname, '..');
const backups = resolve(root, 'backups');
const stamp = new Date()
  .toISOString()
  .replaceAll(':', '-')
  .replaceAll('.', '-');
const destination = resolve(backups, stamp);
const temporary = await mkdtemp(resolve(tmpdir(), 'atende-backup-'));
const databaseSnapshotDirectory = resolve(temporary, 'database');
await mkdir(databaseSnapshotDirectory, { recursive: true, mode: 0o700 });
const databaseSnapshot = resolve(databaseSnapshotDirectory, 'atende.sql');
const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
const exported = spawnSync(
  process.execPath,
  [
    wrangler,
    'd1',
    'export',
    'atende-local',
    '--local',
    '--config',
    'wrangler.local.jsonc',
    '--output',
    databaseSnapshot,
  ],
  {
    cwd: root,
    stdio: 'inherit',
    timeout: 120_000,
  },
);
if (exported.status !== 0)
  throw new Error(
    `Não foi possível criar o snapshot consistente do banco (código ${exported.status ?? 'desconhecido'}).`,
  );

await writeFile(
  databaseSnapshot,
  makeD1ExportRestorable(await readFile(databaseSnapshot, 'utf8')),
  { mode: 0o600 },
);
const sources = [
  ['database', databaseSnapshotDirectory],
  ['whatsapp-session', resolve(root, '.data/whatsapp-web-auth')],
];

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

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

function encryptionKey(value) {
  if (!value) return null;
  return /^[a-f0-9]{64}$/i.test(value)
    ? Buffer.from(value, 'hex')
    : createHash('sha256').update(value).digest();
}

async function encryptedCopy(source, target, key) {
  const plaintext = await readFile(source);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(
    target,
    Buffer.concat([iv, cipher.getAuthTag(), ciphertext]),
    { mode: 0o600 },
  );
  return createHash('sha256').update(plaintext).digest('hex');
}

const vars = await localVars();
const key = encryptionKey(
  process.env.BACKUP_ENCRYPTION_KEY || vars.BACKUP_ENCRYPTION_KEY,
);
await mkdir(destination, { recursive: true, mode: 0o700 });
const copied = [];
const manifestFiles = [];
for (const [name, source] of sources) {
  try {
    if (!(await stat(source)).isDirectory()) continue;
    copied.push(name);
    if (!key) {
      await cp(source, resolve(destination, name), { recursive: true });
      for (const path of await files(source)) {
        manifestFiles.push({
          path: `${name}/${relative(source, path).split(sep).join('/')}`,
          sha256: createHash('sha256')
            .update(await readFile(path))
            .digest('hex'),
        });
      }
    } else {
      for (const path of await files(source)) {
        const relativePath = `${name}/${relative(source, path).split(sep).join('/')}`;
        manifestFiles.push({
          path: relativePath,
          sha256: await encryptedCopy(
            path,
            resolve(destination, `${relativePath}.enc`),
            key,
          ),
        });
      }
    }
  } catch (error) {
    console.warn(
      `Fonte de backup ignorada (${name}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
const manifest = {
  version: 3,
  databaseFormat: 'd1-sql-export',
  createdAt: new Date().toISOString(),
  copied,
  encrypted: Boolean(key),
  files: manifestFiles,
};
await writeFile(
  resolve(destination, 'backup.json'),
  JSON.stringify(manifest, null, 2),
  { mode: 0o600 },
);
await rm(temporary, { recursive: true, force: true });

const entries = (await readdir(backups, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
  .reverse();
for (const old of entries.slice(14))
  await rm(resolve(backups, old), { recursive: true });

const externalDirectory =
  process.env.BACKUP_COPY_DIRECTORY || vars.BACKUP_COPY_DIRECTORY;
if (externalDirectory) {
  const externalTarget = resolve(externalDirectory, stamp);
  await mkdir(externalDirectory, { recursive: true, mode: 0o700 });
  await cp(destination, externalTarget, { recursive: true });
  console.log(`Cópia externa criada em ${externalTarget}`);
}
if (!key)
  console.warn(
    'Backup criado sem criptografia. Defina BACKUP_ENCRYPTION_KEY antes de usar em produção.',
  );
console.log(`Backup criado e verificado em ${destination}`);
