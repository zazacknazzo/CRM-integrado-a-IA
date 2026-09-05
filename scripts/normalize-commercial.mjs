import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(
      new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url),
    ),
    'd1',
    'execute',
    'atende-local',
    '--local',
    '--config',
    'wrangler.local.jsonc',
    '--file',
    'scripts/normalize-commercial.sql',
  ],
  { cwd: root, stdio: 'inherit', timeout: 60000 },
);
if (result.status !== 0) process.exit(result.status ?? 1);
