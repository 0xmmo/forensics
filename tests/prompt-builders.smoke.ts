import { buildPromptBuilder } from '../src/prompts.js';
import { readFileSync, existsSync } from 'node:fs';

const FILLER = existsSync('contexts/wiki-songs.md') ? readFileSync('contexts/wiki-songs.md', 'utf8') : 'lorem ipsum '.repeat(2000);
const SIZES = [500, 5000, 50000, 200000];

for (const kind of ['song-toads', 'random', 'needle'] as const) {
  const builder = buildPromptBuilder(kind, { filler: FILLER, needlePosition: 0.5 });
  console.log(`\n=== kind=${kind} ===`);
  for (const size of SIZES) {
    const { prompt, promptKind } = builder(size);
    const bytes = Buffer.byteLength(prompt, 'utf8');
    const head = prompt.slice(0, 60).replace(/\n/g, '\\n');
    const tail = prompt.slice(-60).replace(/\n/g, '\\n');
    console.log(`  size=${size.toString().padStart(7)}  actual_bytes=${bytes.toString().padStart(7)}  tag=${promptKind}  head=${head}  tail=${tail}`);
    if (kind === 'needle') {
      const m = prompt.match(/secret code is ([0-9A-F]{8})/);
      console.log(`    needle_code=${m?.[1] ?? 'MISSING'}  prompt_contains_question=${prompt.includes('What is the secret code?')}`);
    }
  }
}
