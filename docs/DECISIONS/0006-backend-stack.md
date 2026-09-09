# ADR 0006 — Backend Language and Framework

## Status

Accepted

## Context

The backend is a separate application in this repository, at `apps/api/` (ADR 0008). It is reached
over HTTP, never imported (ADR 0001, `docs/API.md`).

The products this starter was written for put most of their work in the backend, and most of that work is machine learning:

- Speech to text and speaker diarization for uploaded meeting audio.
- Text embeddings and retrieval over customer documents, in Persian and English.
- A gateway in front of hosted models (OpenAI, Anthropic, Google) and locally hosted open models.
- Long-running jobs that need GPU workers, not a request thread.

Other constraints:

- Some customers require an on-premise install with no internet access.
- Persian language quality matters for speech and embeddings.

Two options were considered.

1. **Node.js with TypeScript.** Same language as this repository. The Zod schemas in `src/entities/*/types.ts` could be shared with the backend, so the API contract would have one definition.
2. **Python with FastAPI.** The language of the machine learning ecosystem. No shared Zod, so the contract needs another way to stay in sync.

## Decision

Python with FastAPI, in `apps/api/`.

The machine learning libraries this product needs are Python only: faster-whisper and pyannote for speech, sentence-transformers for embeddings, vLLM and llama.cpp for local model serving, PyTorch for anything custom. A Node backend would need a second Python service beside it, which means two authentication paths, two deployment bundles, and two on-premise installers.

Sharing Zod schemas is a real benefit, but a smaller one than losing the ecosystem. ADR 0007 replaces it with generation from the backend's OpenAPI file.

## Consequences

- The API contract is not shared code, because Zod and Pydantic cannot be the same file.
  `docs/API.md` stays the written contract until ADR 0007 is accepted.
- `apps/api` is not a pnpm workspace package. Python brings its own dependency file (ADR 0008).
- The backend runs on port 8000 in local development, not 3000.
- The backend must return the error shape in `docs/API.md`. FastAPI's default validation error is `{"detail": [...]}` with status 422, so the backend installs an exception handler that converts it.
- On-premise installs ship as containers, so the frontend must work when it is served from the same origin as the API (no CORS) and when it is not.
- This decision belongs to this product family. A product built from this starter whose backend has
  no machine learning work can choose differently. Nothing in `apps/frontend/src` depends on the
  backend language; the boundary is HTTP.
