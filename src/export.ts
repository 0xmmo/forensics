// Dumps the viewer-facing slice of the calls table to a static JSON file so
// the web viewer can run on plain static hosting with no backend. Only the
// narrow set of columns the viewer reads is exported — the heavy blob columns
// (response headers, chunk timings, request bodies) are left in the DB, which
// is why a 500 MB database collapses to a ~1.4 MB JSON (~95 KB gzipped).
//
//   npm run export   ->   docs/data/calls.json
//
// docs/ is the GitHub Pages site (index.html, post.html, data/calls.json).
// The viewer computes /api/meta and /api/calls entirely client-side.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb } from './db.js';

const OUT_DIR = resolve('docs/data');
const OUT = resolve(OUT_DIR, 'calls.json');

const client = openDb();

// Same column set as the /api/calls SELECT in server.ts, plus `status` so the
// client can replicate both /api/calls (status='complete' filter) and /api/meta
// (which counts all statuses per sweep).
const result = await client.execute(`
  SELECT id, sweep_id, sweep_seq, provider, model, repeat_index, is_test, status,
         input_tokens, output_tokens, reasoning_tokens,
         cache_read_tokens, cache_write_tokens,
         prompt_bytes, request_body_bytes,
         first_response_byte_ms, first_stream_event_ms,
         first_content_delta_ms, last_content_delta_ms, total_ms,
         finish_reason, created_at,
         experiment_kind, prompt_kind, context_type,
         in_flight_count, streaming, provider_model_version
  FROM calls
  ORDER BY id ASC
`);

const json = JSON.stringify(result.rows);
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, json);
console.log(`exported ${result.rows.length} rows -> ${OUT} (${(json.length / 1024).toFixed(0)} KB)`);
