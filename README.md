# Small Model Forensics

Probing how closed-weight model providers scale inference — prefill, decode, and
tokenization — from API latency alone. ~2,000 timed calls across nine small
models and three providers.

**[Read the writeup →](https://mmoustafa.com/blog/forensics/)** &nbsp;·&nbsp;
**[Interactive viewer →](https://mmoustafa.com/blog/forensics/)**

## Reading

The site is fully static and lives in [`docs/`](docs/) — served by GitHub Pages,
no backend:

- `docs/post.html` — the writeup
- `docs/index.html` — interactive viewer over the full dataset
- `docs/data/calls.json` — the measurements, exported from the local SQLite DB

## Running

Reproducing the dataset needs provider API keys.

```sh
cp .env.example .env   # add GEMINI / ANTHROPIC / OPENAI keys
npm install
npm run migrate        # create the SQLite schema (data/attention.db)
npm run run            # run a measurement sweep
npm run export         # dump docs/data/calls.json for the viewer
```

`npm run run` sweeps the models in `src/runner.ts` across a range of prompt
sizes; tune it with env vars (`CONTEXT_TYPE`, `PROMPT_KIND`, `MAX_IN_FLIGHT_PER_HOST`,
…). The ~500 MB working DB stays local (gitignored); only the ~1.4 MB JSON
export ships with the site.

The writeup covers the measurement methodology — and what API latency curves
can and cannot tell you about a provider's serving stack.
