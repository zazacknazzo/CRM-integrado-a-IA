import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export function getDb() {
  if (!env.DB) throw new Error('DATABASE_URL / D1 binding DB is unavailable');
  return drizzle(env.DB, { schema });
}

export function getRawDb(): D1Database {
  if (!env.DB) throw new Error('DATABASE_URL / D1 binding DB is unavailable');
  return env.DB;
}

export function getRuntimeEnv(): Cloudflare.Env {
  return env;
}
