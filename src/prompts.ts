import { randomBytes } from 'node:crypto';

export type PromptBuilder = (approxChars: number) => {
  prompt: string;
  promptKind: string;
};

export type PromptKindName = 'song-toads' | 'random' | 'needle';

function songToadsBuilder(filler: string): PromptBuilder {
  return approxChars => {
    const nonce = randomBytes(8).toString('hex');
    const tail = '\nWrite a full feature song about toads.';
    const fillerNeeded = Math.max(0, approxChars - nonce.length - tail.length - 2);
    const body = filler.repeat(Math.ceil(fillerNeeded / filler.length)).slice(0, fillerNeeded);
    return {
      prompt: `${nonce} ${body}${tail}`,
      promptKind: 'song-toads',
    };
  };
}

function randomBuilder(): PromptBuilder {
  // High-entropy filler: random hex bytes broken into 8-char words.
  // Goal: defeat any prompt caching / dedup / content-aware sparsity that
  // exploits redundancy in natural text.
  // Tail asks for long natural-language output so we get a usable per-token
  // decode-rate measurement (cap is the runner's MAX_OUTPUT_TOKENS).
  return approxChars => {
    const tail =
      '\nIgnore the preceding random tokens. Write a long, detailed, original short story about a topic of your choosing. Aim for at least a thousand words; keep going until you reach a natural ending.';
    const fillerNeeded = Math.max(0, approxChars - tail.length);
    const hex = randomBytes(Math.ceil(fillerNeeded / 2) + 4).toString('hex');
    const chunks: string[] = [];
    for (let i = 0; i + 8 <= hex.length; i += 8) chunks.push(hex.slice(i, i + 8));
    const body = chunks.join(' ').slice(0, fillerNeeded);
    return {
      prompt: `${body}${tail}`,
      promptKind: 'random',
    };
  };
}

function needleBuilder(filler: string, position: number): PromptBuilder {
  // Embed a unique 8-hex-char code at relative position `position` within
  // the filler, then ask for it back at the end. Retrieval succeeds iff the
  // model's response begins with the code — first line of the output gives
  // us the position-sensitivity signal. The rest is a long-form essay
  // request so decode actually exercises the MAX_OUTPUT_TOKENS budget.
  const bucket = Math.round(position * 100);
  const tag = `needle-p${bucket.toString().padStart(2, '0')}`;
  return approxChars => {
    const code = randomBytes(4).toString('hex').toUpperCase();
    const needle = ` The secret code is ${code}. Remember this code. `;
    const tail =
      `\nFirst, on its own line, repeat the secret code exactly. Then, on the following lines, write a long, detailed original essay about why secrets matter in human history. Aim for at least a thousand words; keep going until you reach a natural ending.`;
    const fillerNeeded = Math.max(0, approxChars - needle.length - tail.length);
    const insertAt = Math.min(fillerNeeded, Math.max(0, Math.floor(fillerNeeded * position)));
    const body = filler.repeat(Math.ceil(fillerNeeded / filler.length)).slice(0, fillerNeeded);
    const prompt = `${body.slice(0, insertAt)}${needle}${body.slice(insertAt)}${tail}`;
    return { prompt, promptKind: tag };
  };
}

export function buildPromptBuilder(
  kind: PromptKindName,
  opts: { filler: string; needlePosition?: number },
): PromptBuilder {
  switch (kind) {
    case 'song-toads':
      return songToadsBuilder(opts.filler);
    case 'random':
      return randomBuilder();
    case 'needle':
      return needleBuilder(opts.filler, opts.needlePosition ?? 0.5);
    default: {
      const _exhaustive: never = kind;
      throw new Error(`unknown prompt kind: ${_exhaustive as string}`);
    }
  }
}
