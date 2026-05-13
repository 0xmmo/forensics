import { createClient, type Client, type InStatement } from '@libsql/client';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const DB_PATH = process.env.DB_PATH ?? 'data/attention.db';

export function openDb(): Client {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const client = createClient({ url: `file:${resolve(DB_PATH)}` });
  // WAL + a generous busy timeout: with high in-host parallelism the runner
  // and the viewer can be writing/reading at the same time, and the default
  // journal mode raises SQLITE_BUSY almost immediately on contention.
  void client.executeMultiple(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
  `);
  return client;
}

function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

export async function migrate(client: Client, dir = 'migrations'): Promise<void> {
  await client.execute(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const existing = await client.execute('SELECT name FROM _migrations');
  const applied = new Set(existing.rows.map(r => String(r.name)));

  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    const batch: InStatement[] = [
      ...splitStatements(sql).map(s => s),
      {
        sql: 'INSERT INTO _migrations (name, applied_at) VALUES (?, ?)',
        args: [f, new Date().toISOString()],
      },
    ];
    await client.batch(batch, 'write');
    console.log(`applied ${f}`);
  }
}
