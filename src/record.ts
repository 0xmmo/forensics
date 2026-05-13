import type { Client } from '@libsql/client';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { httpRequestWithTiming } from './http.js';
import { redactHeaders, redactUrl } from './redact.js';
import type {
  BuildRequestParams,
  HttpRequest,
  NormalizedUsage,
  ProviderAdapter,
} from './providers/types.js';

export type RecordParams = BuildRequestParams & {
  provider: string;
  sweepId?: string;
  sweepSeq?: number;
  repeatIndex?: number;
  experimentKind?: 'prefill' | 'decode' | 'mixed';
  promptKind?: string;
  contextType: string;
  inFlightCount?: number;
  runnerId?: string;
  runnerGitSha?: string;
  attemptIndex?: number;
  isTest?: boolean;
};

export type RecordResult = {
  id: number;
  status: 'complete' | 'failed';
  totalMs: number;
  firstContentMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  errorMessage: string | null;
};

export type CallTrace = {
  request: HttpRequest;
  requestStartedAt: string;
  promptHash: string;
  promptBytes: number;
  requestBodyBytes: number;
  status: 'complete' | 'failed';
  errorMessage: string | null;
  httpStatus: number | null;
  responseHeaders: Record<string, string>;
  rateLimitHeaders: string | null;
  responseBodyText: string;
  requestUploadMs: number | null;
  firstResponseByteMs: number | null;
  firstStreamEventMs: number | null;
  firstContentDeltaMs: number | null;
  lastContentDeltaMs: number | null;
  totalMs: number;
  chunkTimestamps: number[];
  chunkBytes: number[];
  finishReason: string | null;
  usage: NormalizedUsage | null;
  usageRaws: unknown[];
  modelVersion: string | null;
  providerApiVersion: string | null;
  providerRequestId: string | null;
  httpVersion: string | null;
  remoteAddress: string | null;
  connectionReused: boolean | null;
};

const INSERT_SQL = `INSERT INTO calls (
  created_at, provider, model, streaming,
  request_url, request_method, request_headers, request_body, request_body_bytes,
  prompt_bytes, prompt_hash,
  max_tokens, temperature, top_p, top_k, reasoning_effort, stop_sequences, tools_hash, tools_bytes,
  cache_requested, cache_control, prompt_cache_key, previous_response_id,
  request_started_at, request_upload_ms, first_response_byte_ms, first_stream_event_ms,
  first_content_delta_ms, last_content_delta_ms, total_ms,
  chunk_timestamps_ms, chunk_byte_lengths, network_baseline_ms,
  http_status, response_headers, response_body, response_body_bytes,
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
  usage_raw, token_count_source, finish_reason,
  provider_request_id, provider_model_version, provider_api_version, system_fingerprint,
  service_tier, rate_limit_headers,
  http_version, connection_reused, remote_address, client_region,
  runner_id, runner_git_sha, node_version, retry_count, attempt_index, client_request_id,
  sweep_id, sweep_seq, repeat_index, experiment_kind, prompt_kind, context_type, in_flight_count, is_test,
  status, error_message
) VALUES (
  :created_at, :provider, :model, :streaming,
  :request_url, :request_method, :request_headers, :request_body, :request_body_bytes,
  :prompt_bytes, :prompt_hash,
  :max_tokens, :temperature, :top_p, :top_k, :reasoning_effort, :stop_sequences, :tools_hash, :tools_bytes,
  :cache_requested, :cache_control, :prompt_cache_key, :previous_response_id,
  :request_started_at, :request_upload_ms, :first_response_byte_ms, :first_stream_event_ms,
  :first_content_delta_ms, :last_content_delta_ms, :total_ms,
  :chunk_timestamps_ms, :chunk_byte_lengths, :network_baseline_ms,
  :http_status, :response_headers, :response_body, :response_body_bytes,
  :input_tokens, :output_tokens, :cache_read_tokens, :cache_write_tokens, :reasoning_tokens,
  :usage_raw, :token_count_source, :finish_reason,
  :provider_request_id, :provider_model_version, :provider_api_version, :system_fingerprint,
  :service_tier, :rate_limit_headers,
  :http_version, :connection_reused, :remote_address, :client_region,
  :runner_id, :runner_git_sha, :node_version, :retry_count, :attempt_index, :client_request_id,
  :sweep_id, :sweep_seq, :repeat_index, :experiment_kind, :prompt_kind, :context_type, :in_flight_count, :is_test,
  :status, :error_message
)`;

const EVENT_SEPARATOR = /\r?\n\r?\n/;

const USAGE_FIELDS = [
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'reasoning_tokens',
] as const;

function mergeUsage(prev: NormalizedUsage | null, next: NormalizedUsage): NormalizedUsage {
  const out: NormalizedUsage = prev ? { ...prev } : {};
  for (const k of USAGE_FIELDS) {
    if (next[k] !== undefined) out[k] = next[k];
  }
  return out;
}

function extractRateLimitHeaders(headers: Headers): string | null {
  const out: Record<string, string> = {};
  for (const [k, v] of headers.entries()) {
    const lk = k.toLowerCase();
    if (lk.startsWith('x-ratelimit') || lk.startsWith('ratelimit') || lk === 'retry-after') {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? JSON.stringify(out) : null;
}

export async function executeCall(
  adapter: ProviderAdapter,
  params: BuildRequestParams,
): Promise<CallTrace> {
  const req = adapter.buildRequest(params);
  const requestStartedAt = new Date().toISOString();
  const t0 = performance.now();
  const elapsed = () => Math.round(performance.now() - t0);

  const promptHash = createHash('sha256').update(params.prompt).digest('hex');
  const promptBytes = Buffer.byteLength(params.prompt, 'utf8');
  const requestBodyBytes = Buffer.byteLength(req.body, 'utf8');

  let httpStatus: number | null = null;
  let responseHeaders: Record<string, string> = {};
  let rawHeaders: Headers | null = null;
  let responseBodyText = '';
  let requestUploadMs: number | null = null;
  let firstResponseByteMs: number | null = null;
  let firstStreamEventMs: number | null = null;
  let firstContentDeltaMs: number | null = null;
  let lastContentDeltaMs: number | null = null;
  let httpVersion: string | null = null;
  let remoteAddress: string | null = null;
  let connectionReused: boolean | null = null;
  const chunkTimestamps: number[] = [];
  const chunkBytes: number[] = [];

  let finishReason: string | null = null;
  let usage: NormalizedUsage | null = null;
  const usageRaws: unknown[] = [];
  let modelVersion: string | null = null;
  let providerRequestId: string | null = null;
  let status: 'complete' | 'failed' = 'complete';
  let errorMessage: string | null = null;

  try {
    const res = await httpRequestWithTiming(
      req.url,
      { method: req.method, headers: req.headers, body: req.body },
      t0,
    );
    requestUploadMs = res.uploadMs;
    httpVersion = res.httpVersion;
    remoteAddress = res.remoteAddress;
    connectionReused = res.connectionReused;
    httpStatus = res.status;
    rawHeaders = res.headers;
    responseHeaders = redactHeaders(res.headers);
    providerRequestId =
      res.headers.get('x-request-id') ??
      res.headers.get('request-id') ??
      res.headers.get('x-goog-trace-id') ??
      null;

    if (!res.ok) {
      responseBodyText = await res.text();
      status = 'failed';
      errorMessage = `HTTP ${res.status}`;
    } else if (params.streaming && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const now = elapsed();
        if (firstResponseByteMs === null) firstResponseByteMs = now;
        chunkTimestamps.push(now);
        chunkBytes.push(value.length);
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        responseBodyText += chunk;

        for (;;) {
          const match = EVENT_SEPARATOR.exec(buffer);
          if (!match) break;
          const eventBlock = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          const parsed = adapter.parseStreamEvent(eventBlock);
          if (!parsed) continue;
          if (firstStreamEventMs === null) firstStreamEventMs = elapsed();
          if (parsed.text) {
            if (firstContentDeltaMs === null) firstContentDeltaMs = elapsed();
            lastContentDeltaMs = elapsed();
          }
          if (parsed.finishReason) finishReason = parsed.finishReason;
          if (parsed.usage) {
            usage = mergeUsage(usage, parsed.usage);
            if (parsed.usage.raw !== undefined) usageRaws.push(parsed.usage.raw);
          }
          if (parsed.modelVersion) modelVersion = parsed.modelVersion;
          if (parsed.responseId && !providerRequestId) providerRequestId = parsed.responseId;
        }
      }
      const tail = decoder.decode();
      if (tail) {
        buffer += tail;
        responseBodyText += tail;
      }
      if (buffer.trim().length > 0) {
        const parsed = adapter.parseStreamEvent(buffer);
        if (parsed) {
          if (firstStreamEventMs === null) firstStreamEventMs = elapsed();
          if (parsed.text && firstContentDeltaMs === null) firstContentDeltaMs = elapsed();
          if (parsed.text) lastContentDeltaMs = elapsed();
          if (parsed.finishReason) finishReason = parsed.finishReason;
          if (parsed.usage) {
            usage = mergeUsage(usage, parsed.usage);
            if (parsed.usage.raw !== undefined) usageRaws.push(parsed.usage.raw);
          }
          if (parsed.modelVersion) modelVersion = parsed.modelVersion;
          if (parsed.responseId && !providerRequestId) providerRequestId = parsed.responseId;
        }
      }
    } else {
      responseBodyText = await res.text();
      firstResponseByteMs = elapsed();
      const parsed = adapter.parseFinalResponse(responseBodyText);
      if (parsed.text) {
        firstContentDeltaMs = elapsed();
        lastContentDeltaMs = elapsed();
      }
      finishReason = parsed.finishReason ?? null;
      if (parsed.usage) {
        usage = mergeUsage(usage, parsed.usage);
        if (parsed.usage.raw !== undefined) usageRaws.push(parsed.usage.raw);
      }
      modelVersion = parsed.modelVersion ?? null;
      if (parsed.responseId && !providerRequestId) providerRequestId = parsed.responseId;
    }
  } catch (e) {
    status = 'failed';
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  const totalMs = elapsed();
  const rateLimitHeaders = rawHeaders ? extractRateLimitHeaders(rawHeaders) : null;

  return {
    request: req,
    requestStartedAt,
    promptHash,
    promptBytes,
    requestBodyBytes,
    status,
    errorMessage,
    httpStatus,
    responseHeaders,
    rateLimitHeaders,
    responseBodyText,
    requestUploadMs,
    firstResponseByteMs,
    firstStreamEventMs,
    firstContentDeltaMs,
    lastContentDeltaMs,
    totalMs,
    chunkTimestamps,
    chunkBytes,
    finishReason,
    usage,
    usageRaws,
    modelVersion,
    providerApiVersion: adapter.apiVersion ?? null,
    providerRequestId,
    httpVersion,
    remoteAddress,
    connectionReused,
  };
}

function buildRow(trace: CallTrace, params: RecordParams): Record<string, string | number | null> {
  return {
    created_at: new Date().toISOString(),
    provider: params.provider,
    model: params.model,
    streaming: params.streaming ? 1 : 0,

    request_url: redactUrl(trace.request.url),
    request_method: trace.request.method,
    request_headers: JSON.stringify(redactHeaders(trace.request.headers)),
    request_body: trace.request.body,
    request_body_bytes: trace.requestBodyBytes,
    prompt_bytes: trace.promptBytes,
    prompt_hash: trace.promptHash,

    max_tokens: params.maxTokens,
    temperature: params.temperature,
    top_p: null,
    top_k: null,
    reasoning_effort: params.reasoningEffort ?? null,
    stop_sequences: null,
    tools_hash: null,
    tools_bytes: null,

    cache_requested: 0,
    cache_control: null,
    prompt_cache_key: null,
    previous_response_id: null,

    request_started_at: trace.requestStartedAt,
    request_upload_ms: trace.requestUploadMs,
    first_response_byte_ms: trace.firstResponseByteMs,
    first_stream_event_ms: trace.firstStreamEventMs,
    first_content_delta_ms: trace.firstContentDeltaMs,
    last_content_delta_ms: trace.lastContentDeltaMs,
    total_ms: trace.totalMs,
    chunk_timestamps_ms: trace.chunkTimestamps.length > 0 ? JSON.stringify(trace.chunkTimestamps) : null,
    chunk_byte_lengths: trace.chunkBytes.length > 0 ? JSON.stringify(trace.chunkBytes) : null,
    network_baseline_ms: null,

    http_status: trace.httpStatus,
    response_headers: Object.keys(trace.responseHeaders).length > 0 ? JSON.stringify(trace.responseHeaders) : null,
    response_body: trace.responseBodyText || null,
    response_body_bytes: trace.responseBodyText ? Buffer.byteLength(trace.responseBodyText, 'utf8') : null,

    input_tokens: trace.usage?.input_tokens ?? null,
    output_tokens: trace.usage?.output_tokens ?? null,
    cache_read_tokens: trace.usage?.cache_read_tokens ?? null,
    cache_write_tokens: trace.usage?.cache_write_tokens ?? null,
    reasoning_tokens: trace.usage?.reasoning_tokens ?? null,
    usage_raw: trace.usageRaws.length === 0
      ? null
      : JSON.stringify(trace.usageRaws.length === 1 ? trace.usageRaws[0] : trace.usageRaws),
    token_count_source: trace.usage ? 'provider' : null,
    finish_reason: trace.finishReason,

    provider_request_id: trace.providerRequestId,
    provider_model_version: trace.modelVersion,
    provider_api_version: trace.providerApiVersion,
    system_fingerprint: null,
    service_tier: null,
    rate_limit_headers: trace.rateLimitHeaders,

    http_version: trace.httpVersion,
    connection_reused: trace.connectionReused == null ? null : trace.connectionReused ? 1 : 0,
    remote_address: trace.remoteAddress,
    client_region: process.env.CLIENT_REGION ?? null,

    runner_id: params.runnerId ?? null,
    runner_git_sha: params.runnerGitSha ?? null,
    node_version: process.version,
    retry_count: 0,
    attempt_index: params.attemptIndex ?? 0,
    client_request_id: null,

    sweep_id: params.sweepId ?? null,
    sweep_seq: params.sweepSeq ?? null,
    repeat_index: params.repeatIndex ?? null,
    experiment_kind: params.experimentKind ?? null,
    prompt_kind: params.promptKind ?? null,
    context_type: params.contextType,
    in_flight_count: params.inFlightCount ?? 1,
    is_test: params.isTest === false ? 0 : 1,

    status: trace.status,
    error_message: trace.errorMessage,
  };
}

export async function recordCall(
  client: Client,
  adapter: ProviderAdapter,
  params: RecordParams,
): Promise<RecordResult> {
  const trace = await executeCall(adapter, params);
  const row = buildRow(trace, params);
  const result = await client.execute({ sql: INSERT_SQL, args: row });
  return {
    id: Number(result.lastInsertRowid ?? 0n),
    status: trace.status,
    totalMs: trace.totalMs,
    firstContentMs: trace.firstContentDeltaMs,
    inputTokens: trace.usage?.input_tokens ?? null,
    outputTokens: trace.usage?.output_tokens ?? null,
    errorMessage: trace.errorMessage,
  };
}
