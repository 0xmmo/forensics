import { migrate, openDb } from '../src/db.js';
import { anthropic } from '../src/providers/anthropic.js';
import { gemini } from '../src/providers/gemini.js';
import { openai } from '../src/providers/openai.js';
import { recordCall } from '../src/record.js';

const client = openDb();
await migrate(client);

const filler = 'lorem ipsum dolor sit amet '.repeat(5000);
const prompt = `${Math.random().toString(36).slice(2)} ${filler}\nReply ok.`;
console.log(`prompt_bytes=${Buffer.byteLength(prompt, 'utf8')}`);

for (const spec of [
  { provider: 'gemini', adapter: gemini, model: 'gemini-3.1-flash-lite', extra: { thinkingBudget: 0 } },
  { provider: 'anthropic', adapter: anthropic, model: 'claude-haiku-4-5-20251001', extra: {} },
  { provider: 'openai', adapter: openai, model: 'gpt-5.4-mini', extra: { reasoningEffort: 'none' as const } },
]) {
  const r = await recordCall(client, spec.adapter, {
    provider: spec.provider, model: spec.model, prompt,
    maxTokens: 16, temperature: 0, streaming: true,
    ...(spec.extra as any),
    experimentKind: 'prefill', contextType: 'smoke', promptKind: 'upload-timing-smoke', isTest: true,
  });
  console.log(`${spec.provider}/${spec.model}  id=${r.id} ttft=${r.firstContentMs} total=${r.totalMs}`);
}
client.close();
