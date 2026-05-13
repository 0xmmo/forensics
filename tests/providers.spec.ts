import { performance } from 'node:perf_hooks';
import { anthropic } from '../src/providers/anthropic.js';
import { bedrock } from '../src/providers/bedrock.js';
import { gemini } from '../src/providers/gemini.js';
import { openai } from '../src/providers/openai.js';
import type { BuildRequestParams, ProviderAdapter } from '../src/providers/types.js';
import { executeCall } from '../src/record.js';

type ModelSpec = {
  provider: string;
  model: string;
  adapter: ProviderAdapter;
  streaming?: boolean;
  extra?: Partial<BuildRequestParams>;
};

const SPECS: ModelSpec[] = [
  { provider: 'gemini',    model: 'gemini-3-flash-preview',    adapter: gemini,    extra: { thinkingBudget: 0 } },
  { provider: 'gemini',    model: 'gemini-3.1-flash-lite',     adapter: gemini,    extra: { thinkingBudget: 0 } },
  { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', adapter: anthropic },
  { provider: 'openai',    model: 'gpt-5.4-mini',              adapter: openai,    extra: { reasoningEffort: 'none' } },
  { provider: 'openai',    model: 'gpt-4.1-mini',              adapter: openai },
  { provider: 'openai',    model: 'gpt-3.5-turbo-0125',        adapter: openai },
];

const PROMPT = 'Reply with exactly the single word: ok';
const MAX_TOKENS = 16;

type Check = { name: string; pass: boolean; value: unknown };

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

function pad(s: string, n: number, right = false): string {
  if (s.length >= n) return s;
  const p = ' '.repeat(n - s.length);
  return right ? p + s : s + p;
}

async function smoke(spec: ModelSpec): Promise<{ ok: boolean; checks: Check[] }> {
  const label = `${spec.provider}/${spec.model}`;
  const tStart = performance.now();
  console.log(`[${ts()}] →  ${label}`);
  const trace = await executeCall(spec.adapter, {
    model: spec.model,
    prompt: PROMPT,
    maxTokens: MAX_TOKENS,
    temperature: 0,
    streaming: spec.streaming ?? true,
    ...(spec.extra ?? {}),
  });
  const wall = Math.round(performance.now() - tStart);
  const isStreaming = spec.streaming ?? true;
  const inTokens = trace.usage?.input_tokens ?? null;
  const outTokens = trace.usage?.output_tokens ?? null;
  const reasoning = trace.usage?.reasoning_tokens ?? null;
  const checks: Check[] = [
    { name: 'status=complete',  pass: trace.status === 'complete',                            value: trace.status },
    { name: 'http_status=200',  pass: trace.httpStatus === 200,                               value: trace.httpStatus },
    { name: 'total_ms > 0',     pass: trace.totalMs > 0,                                      value: trace.totalMs },
    { name: 'input_tokens > 0', pass: !!inTokens && inTokens > 0,                             value: inTokens },
    { name: 'output_tokens>=1', pass: !!outTokens && outTokens >= 1,                          value: outTokens },
    { name: 'ttft populated',   pass: !isStreaming || trace.firstContentDeltaMs != null,      value: trace.firstContentDeltaMs },
    { name: 'finish_reason',    pass: trace.finishReason != null,                             value: trace.finishReason },
  ];
  const ok = checks.every(c => c.pass);
  console.log(
    `[${ts()}] ${ok ? '✓' : '✗'}  ${pad(label, 44)}  wall=${wall}ms total=${trace.totalMs}ms ttft=${trace.firstContentDeltaMs ?? '–'}ms  in=${inTokens ?? '–'} out=${outTokens ?? '–'} reasoning=${reasoning ?? '–'} finish=${trace.finishReason ?? '–'}${trace.errorMessage ? '  err=' + trace.errorMessage : ''}`,
  );
  if (!ok) {
    for (const c of checks) {
      if (!c.pass) console.log(`[${ts()}]    ✗ ${c.name}  got=${JSON.stringify(c.value)}`);
    }
  }
  return { ok, checks };
}

const only = process.env.TEST_PROVIDER;
const targets = only ? SPECS.filter(s => s.provider === only) : SPECS;
if (targets.length === 0) {
  console.error(`no providers matched TEST_PROVIDER=${only}; available: ${SPECS.map(s => s.provider).join(', ')}`);
  process.exit(2);
}

console.log(`[${ts()}] smoke-testing ${targets.length} provider${targets.length === 1 ? '' : 's'} (no DB writes)`);
const results = await Promise.all(
  targets.map(spec => smoke(spec).catch(e => ({ ok: false, checks: [], err: e }))),
);
const failed = results.filter(r => !r.ok).length;
console.log(`[${ts()}] ── ${results.length - failed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
