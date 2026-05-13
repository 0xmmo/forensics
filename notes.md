# Looking for Attention

## Research Goal

Infer attention mechanism characteristics of closed models from how response time scales with input token count
across models and providers. Dense O(n²) attention should show prefill time
scaling quadratically with context length; sub-quadratic scaling is suggestive
of sparse attention (or other prefill-time optimizations the provider may have
deployed — see "What we cannot conclude" below).

## What we are actually measuring

We have no ground truth on what a provider does inside its serving stack. The
HTTP latency of a single call decomposes (loosely) as:

```
total_ms ≈
    request_upload_ms                       (network up)
  + provider_ingress_ms                     (TLS, auth, safety pre-check, routing)
  + queue_ms                                (admission control / batching wait)
  + prefill_ms                              (what we actually care about)
  + first_decode_step_ms                    (model emits the first token)
  + first_response_byte_ms_overhead         (serialization, network down to first byte)
  + decode_ms                               (subsequent tokens, only if max_tokens > 1)
  + transport_overhead                      (down-stream network)
```

`ttft_ms` (defined as time from request-sent to first **content-bearing** token)
is "prefill-dominated latency", not prefill. Everything above prefill in the
decomposition is also folded into TTFT. We can subtract the parts we measure,
but we cannot subtract queue time, provider ingress, or first-decode-step time.

## Timing fields, defined

- `request_upload_ms` — time from `fetch()` call to upload complete. Not
  exposed by the Node fetch API; left null until we switch to undici with
  diagnostics channels. **Bandwidth-bound at long contexts.**
- `first_response_byte_ms` — time to first HTTP response byte. Marks server
  having accepted the request and started writing the response. Useful as a
  baseline for "the model is at least handed our prompt."
- `first_stream_event_ms` — time to first SSE event. For Gemini, the first
  event is usually metadata or role-start, **not** a content token.
- `first_content_delta_ms` — time to first event with non-empty `text`. This
  is the proper "TTFT" for our purposes.
- `last_content_delta_ms` — time to last content event. Useful for decode
  slope estimation.
- `total_ms` — full request lifetime.
- `chunk_timestamps_ms` / `chunk_byte_lengths` — full per-chunk timing,
  preserved as JSON so we can re-derive inter-token latency distributions later.

`server_processing_ms` is omitted: we do not store a value we cannot directly
measure.

## Experiment design

### Prefill mode (the load-bearing experiment for sparsity inference)

Goal: measure prefill cost as a function of input length, with everything else
held constant.

- `streaming: 1`
- `max_tokens: 16` — small but non-1. `max_tokens=1` does **not** work on
  Gemini 3: the model returns `finishReason=MAX_TOKENS` with `text=""` and
  no `candidatesTokenCount` reported, so we measure neither TTFT nor output.
  At 16 we still capture `first_content_delta_ms` on the first content event
  (prefill + 1 decode step) and the extra ~15 decode steps are a small,
  context-length-independent constant on top of `total_ms`.
- `thinking_budget: 0` (Gemini-specific) — Gemini 3 models reserve output
  budget for thinking by default; without disabling it we'd be measuring
  prefill + variable thinking compute. Explicitly zero this for prefill
  sweeps.
- `temperature: 0`, no `top_p`/`top_k` games — sampling shouldn't affect
  compute meaningfully, but we fix it anyway for reproducibility.
- No tools, no JSON/schema mode, no reasoning — these change the compute
  path and the prompt mass.
- Cache: explicitly opt out where possible; vary prompt content per call
  (per-call nonce prefix) so providers cannot silently dedupe.
- `experiment_kind = 'prefill'`.

### Test vs production runs

Every row carries `is_test` (INTEGER, **default 1**). Test is the safe default:
any caller that doesn't pass `isTest: false` is treated as a test row, so an
accidentally-launched smoke run never contaminates the analysis dataset. Real
publication-grade sweeps must explicitly opt out by passing `isTest: false` at
the recordCall site (which writes `is_test = 0`). Analysis SQL should filter
to `WHERE is_test = 0` by default.

### Decode mode (secondary)

For decode-side measurements (per-token latency vs KV-cache size), hold input
length fixed at a few representative sizes and vary `max_tokens` up to a large
value. Per-token latency drifting upward through a long output is suggestive
of dense attention over the growing KV cache. `experiment_kind = 'decode'`.

### Order and statistics

- **Randomize trial order** across (model, input_length, repeat). Never sweep
  short→long: it confounds context length with time-of-day load patterns.
- **Interleave models and providers** for the same reason.
- Run many repeats per cell (≥10 for first cuts, more for publication-quality
  curves) and analyze the **low quantile** (P10 or min) of latency, not the
  mean. The latency floor reflects compute; the upper tail reflects queue and
  contention noise we cannot disentangle.
- Run strictly sequentially (no parallel in-flight requests to the same
  provider) — keeps `in_flight_count = 1` and avoids self-induced batching.

### Prompt design

For initial sweeps we use `lorem`-style filler. To probe whether sparsity is
content-aware (e.g., sparse-attention schemes that look at attention scores)
we will later add:

- `repeated` — a single short string repeated to length. Tests redundancy
  exploitation.
- `random` — high-entropy random tokens.
- `needle` — a discriminative fact embedded at varying positions, with a
  retrieval question at the end. Tests whether sparsity preserves access to
  arbitrary positions.

Tag with `prompt_kind` so we can slice by content shape.

### Cross-provider comparability

**Token counts are not comparable across providers** — different tokenizers.
We store provider-reported `input_tokens` and slice within a single
(provider, model) pair when fitting scaling exponents. For cross-provider
plots, the x-axis should be input bytes or a single shared tokenizer's
estimate of the same prompt, not provider tokens.

## What we cannot conclude from this data

API latency curves can be **suggestive** of attention sparsity, not proof.
Confounds we cannot rule out from the outside:

- Provider-side dynamic batching, speculative decoding, MoE routing, prompt
  caching, KV-cache reuse, hardware tier changes — any of these can produce
  sub-quadratic curves without sparse attention.
- Backend migrations mid-experiment. We capture `system_fingerprint`,
  `provider_model_version`, `provider_request_id`, and full response headers
  to flag this when it happens.
- Variable hardware allocation by tier/load.

Treat a sudden change in latency regime within a sweep as evidence of
**routing/backend change**, not architecture.

## Detecting backend drift

Flag (do not discard) any sweep where:

- `provider_model_version` or `system_fingerprint` changes mid-sweep.
- Rate-limit headers change tier.
- The P10 latency at a fixed (model, input_length) shifts by more than ~2x
  between adjacent time windows.

## Open methodological TODOs

- Add `request_upload_ms` via undici diagnostics channel or a streamed body
  with a `'finish'` hook.
- Establish a per-sweep network baseline (median TTFB of N tiny no-op calls
  to the same endpoint) and persist as `network_baseline_ms` on each row.
- Decide on tokenizer for cross-provider x-axis. Probably `tiktoken` (OAI)
  for bytes→tokens normalization, with a clear caveat in plots.
