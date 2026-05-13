# Cost estimates

Estimates only. Per-token rates are confirmed against each provider's public
pricing page as of 2026-05-12 except where noted. Verify before any large run —
prices change.

## Inputs (from `src/runner.ts`)

- **9 models × 15 sizes × 3 reps = 405 calls per full sweep**
- `max_output_tokens = 100` (output cost is negligible at this cap)
- Caching disabled (per-call nonces) → no cached-input discount
- Char→token approximation: **~4 chars per token**
- Per-model size caps removed — APIs reject overflows; failed calls are recorded but not billed

Sizes and approximate input-token counts per call:

| Chars | ≈ Input tokens |
|---:|---:|
| 250 | 63 |
| 500 | 125 |
| 1,000 | 250 |
| 2,000 | 500 |
| 4,000 | 1,000 |
| 8,000 | 2,000 |
| 16,000 | 4,000 |
| 32,000 | 8,000 |
| 64,000 | 16,000 |
| 128,000 | 32,000 |
| 256,000 | 64,000 |
| 400,000 | 100,000 |
| 600,000 | 150,000 |
| 800,000 | 200,000 |
| 1,000,000 | 250,000 |
| **Sum (per rep, per model)** | **~828,000** |

## Models and prices ($ / 1M tokens)

| Model | Input | Output | Context window |
|---|---:|---:|---:|
| gemini-3-flash-preview | 0.30 | 2.50 | ~1M tokens |
| gemini-3.1-flash-lite | 0.10 | 0.40 | ~1M tokens |
| gemini-2.5-flash | 0.30 | 2.50 | 1M tokens |
| claude-haiku-4-5-20251001 | 1.00 | 5.00 | 200k tokens |
| gpt-5.4-mini | 0.75 | 4.50 | 400k tokens |
| gpt-4o-mini | 0.15 | 0.60 | 128k tokens |
| gpt-4.1-mini | 0.40 | 1.60 | 1M tokens |
| gpt-4.1-nano | 0.10 | 0.40 | 1M tokens |
| gpt-3.5-turbo-0125 | 0.50 | 1.50 | 16k tokens |

## Per-call cost (input + 100 output tokens), by price tier

Models with identical rates share a column.

| Chars | Tokens | g3-flash / g2.5-flash | g3.1-lite / gpt-4.1-nano | claude-haiku-4.5 | gpt-5.4-mini | gpt-4o-mini | gpt-4.1-mini | gpt-3.5-turbo |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 250 | 63 | $0.000269 | $0.000046 | $0.000563 | $0.000497 | $0.000069 | $0.000185 | $0.000182 |
| 500 | 125 | $0.000288 | $0.000053 | $0.000625 | $0.000544 | $0.000079 | $0.000210 | $0.000213 |
| 1,000 | 250 | $0.000325 | $0.000065 | $0.000750 | $0.000638 | $0.000098 | $0.000260 | $0.000275 |
| 2,000 | 500 | $0.000400 | $0.000090 | $0.001000 | $0.000825 | $0.000135 | $0.000360 | $0.000400 |
| 4,000 | 1,000 | $0.000550 | $0.000140 | $0.001500 | $0.001200 | $0.000210 | $0.000560 | $0.000650 |
| 8,000 | 2,000 | $0.000850 | $0.000240 | $0.002500 | $0.001950 | $0.000360 | $0.000960 | $0.001150 |
| 16,000 | 4,000 | $0.001450 | $0.000440 | $0.004500 | $0.003450 | $0.000660 | $0.001760 | $0.002150 |
| 32,000 | 8,000 | $0.002650 | $0.000840 | $0.008500 | $0.006450 | $0.001260 | $0.003360 | $0.004150 |
| 64,000 | 16,000 | $0.005050 | $0.001640 | $0.016500 | $0.012450 | $0.002460 | $0.006560 | *rejected* |
| 128,000 | 32,000 | $0.009850 | $0.003240 | $0.032500 | $0.024450 | $0.004860 | $0.012960 | *rejected* |
| 256,000 | 64,000 | $0.019450 | $0.006440 | $0.064500 | $0.048450 | $0.009660 | $0.025760 | *rejected* |
| 400,000 | 100,000 | $0.030250 | $0.010040 | $0.100500 | $0.075450 | $0.015060 | $0.040160 | *rejected* |
| 600,000 | 150,000 | $0.045250 | $0.015040 | $0.150500 | $0.112950 | *rejected* | $0.060160 | *rejected* |
| 800,000 | 200,000 | $0.060250 | $0.020040 | *rejected (at limit)* | $0.150450 | *rejected* | $0.080160 | *rejected* |
| 1,000,000 | 250,000 | $0.075250 | $0.025040 | *rejected* | $0.187950 | *rejected* | $0.100160 | *rejected* |

Range across the suite: ~$0.00005 (smallest Lite/nano call) → **~$0.19**
(gpt-5.4-mini @ 1M chars). Haiku 4.5 hits ~$0.15 at 600k chars, then rejects.

## Expected context-window rejections

| Model | Sizes rejected | Reason |
|---|---|---|
| gpt-3.5-turbo-0125 | 128k chars and up | 16k token context (~64k chars max) |
| gpt-4o-mini | 600k chars and up | 128k token context (~512k chars max) |
| claude-haiku-4-5 | 800k, 1M chars | 200k token context, no headroom for output |

Rejected calls bill $0 but are recorded with `status='failed'`.

## Per full sweep (3 reps)

Per-model totals, accounting for expected rejections:

| Model | Calls run | Input tokens | **Sweep $** |
|---|---:|---:|---:|
| gemini-3-flash-preview | 45 | 2.48 M | **$0.76** |
| gemini-3.1-flash-lite | 45 | 2.48 M | **$0.25** |
| gemini-2.5-flash | 45 | 2.48 M | **$0.76** |
| claude-haiku-4-5 | 39 | 1.13 M | **$1.15** |
| gpt-5.4-mini | 45 | 2.48 M | **$1.89** |
| gpt-4o-mini | 36 | 0.68 M | **$0.10** |
| gpt-4.1-mini | 45 | 2.48 M | **$1.00** |
| gpt-4.1-nano | 45 | 2.48 M | **$0.25** |
| gpt-3.5-turbo-0125 | 27 | 0.10 M | **$0.05** |
| **Total** | **372** of 405 | **~14.3 M** | **~$6.21** |

Of 405 trials, ~33 will be rejected on context (gpt-3.5-turbo 18, gpt-4o-mini 9,
Haiku 6).

Linear scaling for higher rep counts:

| Reps | Calls (intended) | Total $ |
|---:|---:|---:|
| 3 | 405 | ~$6.21 |
| 5 | 675 | ~$10.35 |
| 10 | 1,350 | ~$20.70 |

## Where the money goes

The four largest sizes (256k–1M chars) carry **~92%** of input tokens per
model — and gpt-5.4-mini + Haiku 4.5 alone are **~49%** of the total sweep
cost. The two new low-end additions (gpt-4.1-mini, gpt-3.5-turbo) add roughly
**$1.05** combined per sweep — gpt-3.5-turbo is essentially free because it
rejects most of the bill-driving sizes.

Cheapest models in the lineup are essentially free per call below ~64k chars
(<$0.002 each); cost only starts to matter above the 256k-char rows.

## Caveats

- Prices for `gemini-3-*` are extrapolated from the Gemini 2.5 tier their names
  imply — Google hasn't published official rates. Confirm before large runs.
- `claude-haiku-4-5` and `gpt-5.4-mini` prices are confirmed from
  [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
  and [OpenAI pricing](https://developers.openai.com/api/docs/pricing). Note
  gpt-5.4-mini was previously listed at $0.25/$2.00 here — that was wrong; the
  standard rate is $0.75/$4.50.
- If Gemini 3 introduces a >128k-token surcharge (as 1.5 Flash had), Gemini
  costs roughly double on the top three size buckets, adding ~$0.40 / sweep.
- API rejections are assumed not billed (standard for 4xx context-overflow
  errors). If a provider changes this, gpt-3.5-turbo, gpt-4o-mini, and Haiku
  rejections become charged.
