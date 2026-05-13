import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { migrate, openDb } from './db.js';
import { anthropic } from './providers/anthropic.js';
import { bedrock } from './providers/bedrock.js';
import { gemini } from './providers/gemini.js';
import { openai } from './providers/openai.js';
import type { BuildRequestParams, ProviderAdapter } from './providers/types.js';
import { buildPromptBuilder, type PromptKindName } from './prompts.js';
import { recordCall } from './record.js';

const CONTEXT_TYPE = process.env.CONTEXT_TYPE ?? 'wiki-songs';
const CONTEXT_PATH = process.env.CONTEXT_PATH ?? `contexts/${CONTEXT_TYPE}.md`;
const PROMPT_KIND = (process.env.PROMPT_KIND ?? 'song-toads') as PromptKindName;
const NEEDLE_POSITION = process.env.NEEDLE_POSITION ? Number(process.env.NEEDLE_POSITION) : 0.5;
// Concurrent in-flight requests *within* a single host. Default 1 preserves
// the original methodology (one outstanding request per provider at a time).
// Crank up for fast sweeps — note that in_flight_count is recorded per row
// so analysis can filter to in_flight=1 if needed.
const MAX_IN_FLIGHT_PER_HOST = Math.max(1, Number(process.env.MAX_IN_FLIGHT_PER_HOST ?? '1'));

type ModelSpec = {
  provider: string;
  model: string;
  adapter: ProviderAdapter;
  streaming?: boolean;
  extra?: Partial<BuildRequestParams>;
};

const SWEEP_MODELS: ModelSpec[] = [
  { provider: 'gemini',    model: 'gemini-3-flash-preview',       adapter: gemini,    extra: { thinkingBudget: 0 } },
  { provider: 'gemini',    model: 'gemini-3.1-flash-lite',        adapter: gemini,    extra: { thinkingBudget: 0 } },
  { provider: 'gemini',    model: 'gemini-2.5-flash',             adapter: gemini,    extra: { thinkingBudget: 0 } },
  { provider: 'anthropic', model: 'claude-haiku-4-5-20251001',    adapter: anthropic },
  { provider: 'openai',    model: 'gpt-5.4-mini',                 adapter: openai,    extra: { reasoningEffort: 'none' } },
  { provider: 'openai',    model: 'gpt-4o-mini',                  adapter: openai },
  { provider: 'openai',    model: 'gpt-4.1-mini',                 adapter: openai },
  { provider: 'openai',    model: 'gpt-4.1-nano',                 adapter: openai },
  { provider: 'openai',    model: 'gpt-3.5-turbo-0125',           adapter: openai },
];

const HOST_BY_PROVIDER: Record<string, string> = {
  gemini: 'google-genai',
  gemma: 'google-genai',
  anthropic: 'anthropic',
  openai: 'openai',
};

const INPUT_SIZES_CHARS = [
  250,
  500,
  1_000,
  2_000,
  4_000,
  8_000,
  16_000,
  32_000,
  64_000,
  128_000,
  256_000,
  400_000,
  600_000,
  800_000,
  1_000_000,
];
const REPEATS = 3;
const MAX_OUTPUT_TOKENS = 1000;

const NEEDS_FILLER = PROMPT_KIND === 'song-toads' || PROMPT_KIND === 'needle';
let FILLER = '';
if (NEEDS_FILLER) {
  if (!existsSync(CONTEXT_PATH)) {
    console.error(
      `context file not found: ${CONTEXT_PATH}\nFetch it first: npm run fetch-context  (or set CONTEXT_TYPE)`,
    );
    process.exit(1);
  }
  FILLER = readFileSync(CONTEXT_PATH, 'utf8');
  if (FILLER.length < 1000) {
    console.error(`context file too short (${FILLER.length} chars); re-fetch with npm run fetch-context`);
    process.exit(1);
  }
}

const promptBuilder = buildPromptBuilder(PROMPT_KIND, {
  filler: FILLER,
  needlePosition: NEEDLE_POSITION,
});

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function ts(): string {
  const d = new Date();
  return d.toISOString().slice(11, 23);
}

function pad(s: string, n: number, right = false): string {
  if (s.length >= n) return s;
  const pad = ' '.repeat(n - s.length);
  return right ? pad + s : s + pad;
}

type Trial = { spec: ModelSpec; size: number; repeat: number };

const client = openDb();
try {
  await migrate(client);

  const sweepStartedAt = performance.now();
  const sweepId = `sweep-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(2).toString('hex')}`;
  const runnerId = `runner-${randomUUID().slice(0, 8)}`;

  const trials: Trial[] = shuffle(
    SWEEP_MODELS.flatMap(spec =>
      INPUT_SIZES_CHARS.flatMap(size =>
        Array.from({ length: REPEATS }, (_, repeat) => ({ spec, size, repeat })),
      ),
    ),
  );

  const trialsByHost = new Map<string, Trial[]>();
  for (const trial of trials) {
    const host = HOST_BY_PROVIDER[trial.spec.provider] ?? trial.spec.provider;
    if (!trialsByHost.has(host)) trialsByHost.set(host, []);
    trialsByHost.get(host)!.push(trial);
  }

  console.log(`[${ts()}] sweep=${sweepId}`);
  console.log(`[${ts()}] runner=${runnerId}  node=${process.version}`);
  console.log(
    `[${ts()}] config: ${SWEEP_MODELS.length} models × ${INPUT_SIZES_CHARS.length} sizes × ${REPEATS} reps = ${trials.length} trials`,
  );
  console.log(
    `[${ts()}] sizes: ${INPUT_SIZES_CHARS[0]}..${INPUT_SIZES_CHARS[INPUT_SIZES_CHARS.length - 1]} chars  max_output_tokens=${MAX_OUTPUT_TOKENS}`,
  );
  console.log(
    `[${ts()}] prompt: kind=${PROMPT_KIND}${PROMPT_KIND === 'needle' ? `  needle_pos=${NEEDLE_POSITION}` : ''}${NEEDS_FILLER ? `  context=${CONTEXT_TYPE}` : ''}`,
  );
  console.log(`[${ts()}] models:`);
  for (const m of SWEEP_MODELS) {
    const host = HOST_BY_PROVIDER[m.provider] ?? m.provider;
    const stream = m.streaming === false ? 'non-streaming' : 'streaming';
    const extra = m.extra ? JSON.stringify(m.extra) : '{}';
    console.log(`[${ts()}]   - ${pad(m.provider, 10)} ${pad(m.model, 32)} host=${pad(host, 14)} ${stream}  extra=${extra}`);
  }
  console.log(
    `[${ts()}] parallelism: ${trialsByHost.size} hosts in parallel, ${MAX_IN_FLIGHT_PER_HOST}-way per host`,
  );
  for (const [host, list] of trialsByHost) {
    console.log(`[${ts()}]   - host=${pad(host, 14)} queue=${list.length}`);
  }
  console.log(`[${ts()}] starting...`);

  let inFlight = 0;
  let submitted = 0;
  let completed = 0;
  let failed = 0;

  const hostResults = await Promise.all(
    [...trialsByHost.entries()].map(async ([host, hostTrials]) => {
      const hostStartedAt = performance.now();
      let hostOk = 0;
      let hostFail = 0;
      let cursor = 0;

      async function runOne(trial: Trial) {
        const mySeq = ++submitted;
        inFlight += 1;
        const inFlightAtStart = inFlight;
        const label = `${trial.spec.provider}/${trial.spec.model}`;
        const built = promptBuilder(trial.size);
        const prompt = built.prompt;
        const promptKindForRow = built.promptKind;
        const tStart = performance.now();
        console.log(
          `[${ts()}] →  seq=${pad(String(mySeq), 3, true)}/${trials.length}  host=${pad(host, 14)}  ${pad(label, 44)}  size=${pad(String(trial.size), 7, true)}  r${trial.repeat}  in_flight=${inFlight}`,
        );
        try {
          const result = await recordCall(client, trial.spec.adapter, {
            provider: trial.spec.provider,
            model: trial.spec.model,
            prompt,
            maxTokens: MAX_OUTPUT_TOKENS,
            temperature: 0,
            streaming: trial.spec.streaming ?? true,
            ...(trial.spec.extra ?? {}),
            sweepId,
            sweepSeq: mySeq,
            repeatIndex: trial.repeat,
            experimentKind: 'prefill',
            promptKind: promptKindForRow,
            contextType: CONTEXT_TYPE,
            inFlightCount: inFlightAtStart,
            runnerId,
          });
          const wall = Math.round(performance.now() - tStart);
          if (result.status === 'failed') {
            hostFail += 1;
            failed += 1;
            console.log(
              `[${ts()}] ✗  seq=${pad(String(mySeq), 3, true)}/${trials.length}  host=${pad(host, 14)}  ${pad(label, 44)}  size=${pad(String(trial.size), 7, true)}  r${trial.repeat}  failed  wall=${wall}ms  total=${result.totalMs}ms  err=${result.errorMessage ?? ''}`,
            );
          } else {
            hostOk += 1;
            completed += 1;
            console.log(
              `[${ts()}] ✓  seq=${pad(String(mySeq), 3, true)}/${trials.length}  host=${pad(host, 14)}  ${pad(label, 44)}  size=${pad(String(trial.size), 7, true)}  r${trial.repeat}  ok      wall=${wall}ms  total=${result.totalMs}ms  ttft=${result.firstContentMs ?? '?'}ms  in=${result.inputTokens ?? '?'}  out=${result.outputTokens ?? '?'}`,
            );
          }
        } catch (e) {
          hostFail += 1;
          failed += 1;
          console.log(
            `[${ts()}] ✗  seq=${pad(String(mySeq), 3, true)}/${trials.length}  host=${host}  ${label}  THREW: ${e instanceof Error ? e.message : String(e)}`,
          );
        } finally {
          inFlight -= 1;
        }
      }

      const workers = Array.from({ length: Math.min(MAX_IN_FLIGHT_PER_HOST, hostTrials.length) }, async () => {
        while (cursor < hostTrials.length) {
          const idx = cursor++;
          await runOne(hostTrials[idx]!);
        }
      });
      await Promise.all(workers);
      const hostElapsed = ((performance.now() - hostStartedAt) / 1000).toFixed(1);
      console.log(
        `[${ts()}] ◆  host=${pad(host, 14)} done  ok=${hostOk}  fail=${hostFail}  elapsed=${hostElapsed}s`,
      );
      return { host, ok: hostOk, fail: hostFail, elapsedMs: performance.now() - hostStartedAt };
    }),
  );

  const totalElapsed = ((performance.now() - sweepStartedAt) / 1000).toFixed(1);
  console.log(`[${ts()}] ── summary ──`);
  for (const r of hostResults.sort((a, b) => b.elapsedMs - a.elapsedMs)) {
    console.log(
      `[${ts()}]   ${pad(r.host, 14)}  ok=${r.ok}  fail=${r.fail}  elapsed=${(r.elapsedMs / 1000).toFixed(1)}s`,
    );
  }
  console.log(
    `[${ts()}] sweep ${sweepId} complete: ${completed} ok, ${failed} failed, ${trials.length} total, wall=${totalElapsed}s`,
  );
} finally {
  client.close();
}
