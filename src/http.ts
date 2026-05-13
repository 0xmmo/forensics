import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { performance } from 'node:perf_hooks';
import { Buffer } from 'node:buffer';

const httpsAgent = new HttpsAgent({ keepAlive: true, maxSockets: 64 });
const httpAgent = new HttpAgent({ keepAlive: true, maxSockets: 64 });

export type TimedResponse = {
  ok: boolean;
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
  uploadMs: number | null;
  httpVersion: string | null;
  remoteAddress: string | null;
  connectionReused: boolean | null;
};

export type RequestInit = {
  method: string;
  headers: Record<string, string>;
  body: string;
};

export function httpRequestWithTiming(
  url: string,
  init: RequestInit,
  t0: number,
): Promise<TimedResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? httpsRequest : httpRequest;
    const agent = isHttps ? httpsAgent : httpAgent;
    const bodyBuf = Buffer.from(init.body, 'utf8');
    const headers: Record<string, string> = {
      ...init.headers,
      'content-length': String(bodyBuf.length),
    };

    let uploadMs: number | null = null;
    let connectionReused: boolean | null = null;
    let remoteAddress: string | null = null;

    const req = lib({
      method: init.method,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers,
      agent,
    });

    req.on('socket', socket => {
      if (socket.connecting) {
        connectionReused = false;
        socket.once('connect', () => {
          remoteAddress = socket.remoteAddress ?? null;
        });
      } else {
        connectionReused = true;
        remoteAddress = socket.remoteAddress ?? null;
      }
    });

    req.on('finish', () => {
      uploadMs = Math.round(performance.now() - t0);
    });

    req.on('error', err => reject(err));

    req.on('response', res => {
      const respHeaders = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        if (Array.isArray(v)) {
          for (const vv of v) respHeaders.append(k, vv);
        } else if (typeof v === 'string') {
          respHeaders.set(k, v);
        }
      }
      const status = res.statusCode ?? 0;
      const httpVersion = res.httpVersion ?? null;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          res.on('data', chunk => {
            const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
            controller.enqueue(u8);
          });
          res.on('end', () => controller.close());
          res.on('error', err => controller.error(err));
        },
        cancel() {
          res.destroy();
        },
      });

      let consumed = false;
      async function text(): Promise<string> {
        if (consumed) throw new Error('body already consumed');
        consumed = true;
        const chunks: Uint8Array[] = [];
        const reader = stream.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }
        let total = 0;
        for (const c of chunks) total += c.length;
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          merged.set(c, offset);
          offset += c.length;
        }
        return new TextDecoder().decode(merged);
      }

      resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: respHeaders,
        body: stream,
        text,
        uploadMs,
        httpVersion,
        remoteAddress,
        connectionReused,
      });
    });

    req.write(bodyBuf);
    req.end();
  });
}
