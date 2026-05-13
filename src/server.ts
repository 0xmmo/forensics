import express, { type Request, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb } from './db.js';

const client = openDb();
const app = express();
const port = Number(process.env.PORT ?? 3000);

const HTML_PATH     = resolve('src/web/index.html');
const FINDINGS_PATH = resolve('src/web/findings.html');
const RESEARCH_PATH = resolve('src/web/research.html');
const EXPERT_RESEARCH_PATH = resolve('src/web/expert_research.html');
const POST_PATH = resolve('src/web/post.html');

app.get('/', (_req: Request, res: Response) => {
  res.type('html').send(readFileSync(HTML_PATH, 'utf8'));
});

app.get('/findings', (_req: Request, res: Response) => {
  res.type('html').send(readFileSync(FINDINGS_PATH, 'utf8'));
});

app.get('/research', (_req: Request, res: Response) => {
  res.type('html').send(readFileSync(RESEARCH_PATH, 'utf8'));
});

app.get('/expert_research', (_req: Request, res: Response) => {
  res.type('html').send(readFileSync(EXPERT_RESEARCH_PATH, 'utf8'));
});

app.get('/post', (_req: Request, res: Response) => {
  res.type('html').send(readFileSync(POST_PATH, 'utf8'));
});

app.get('/expert-research', (_req: Request, res: Response) => {
  res.type('html').send(readFileSync(EXPERT_RESEARCH_PATH, 'utf8'));
});

app.get('/api/expert_research', (_req: Request, res: Response) => {
  res.type('html').send(readFileSync(EXPERT_RESEARCH_PATH, 'utf8'));
});

app.get('/api/expert-research', (_req: Request, res: Response) => {
  res.type('html').send(readFileSync(EXPERT_RESEARCH_PATH, 'utf8'));
});

app.get('/api/meta', async (_req: Request, res: Response) => {
  const sweeps = await client.execute(`
    SELECT sweep_id,
           MIN(created_at) AS started_at,
           COUNT(*)        AS n,
           SUM(CASE WHEN status='complete' THEN 1 ELSE 0 END) AS n_ok,
           SUM(is_test)    AS n_test,
           GROUP_CONCAT(DISTINCT context_type) AS context_types,
           GROUP_CONCAT(DISTINCT provider)     AS providers
    FROM calls
    WHERE sweep_id IS NOT NULL
    GROUP BY sweep_id
    ORDER BY started_at DESC
  `);
  const models = await client.execute(`
    SELECT DISTINCT provider, model FROM calls ORDER BY provider, model
  `);
  const contextTypes = await client.execute(`
    SELECT DISTINCT context_type FROM calls WHERE context_type IS NOT NULL ORDER BY context_type
  `);
  const providers = await client.execute(`
    SELECT DISTINCT provider FROM calls ORDER BY provider
  `);
  const promptKinds = await client.execute(`
    SELECT DISTINCT prompt_kind FROM calls WHERE prompt_kind IS NOT NULL ORDER BY prompt_kind
  `);
  res.json({
    sweeps: sweeps.rows,
    models: models.rows,
    context_types: contextTypes.rows,
    providers: providers.rows,
    prompt_kinds: promptKinds.rows,
  });
});

app.get('/api/calls', async (req: Request, res: Response) => {
  const where: string[] = ["status = 'complete'"];
  const args: (string | number)[] = [];
  const addEq = (col: string, raw: unknown) => {
    if (typeof raw === 'string' && raw.length > 0) {
      where.push(`${col} = ?`);
      args.push(raw);
    }
  };
  addEq('sweep_id', req.query.sweep);
  addEq('provider', req.query.provider);
  addEq('model', req.query.model);
  addEq('context_type', req.query.context_type);
  addEq('prompt_kind', req.query.prompt_kind);
  addEq('experiment_kind', req.query.experiment_kind);
  if (req.query.is_test === '0' || req.query.is_test === '1') {
    where.push('is_test = ?');
    args.push(Number(req.query.is_test));
  }
  const sql = `
    SELECT id, sweep_id, sweep_seq, provider, model, repeat_index, is_test,
           input_tokens, output_tokens, reasoning_tokens,
           cache_read_tokens, cache_write_tokens,
           prompt_bytes, request_body_bytes,
           first_response_byte_ms, first_stream_event_ms,
           first_content_delta_ms, last_content_delta_ms, total_ms,
           finish_reason, created_at,
           experiment_kind, prompt_kind, context_type,
           in_flight_count, streaming, provider_model_version
    FROM calls
    WHERE ${where.join(' AND ')}
    ORDER BY id ASC
  `;
  const result = await client.execute({ sql, args });
  res.json(result.rows);
});

app.listen(port, () => {
  console.log(`viewer: http://localhost:${port}`);
});
