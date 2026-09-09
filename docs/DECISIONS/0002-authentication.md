# ADR 0002 — Web and Native Authentication

## Status

Accepted

## Decision

Use secure cookie sessions for Web and bearer access tokens for Native where cross-origin WebView constraints require them.

## Consequences

Native tokens require OS-backed secure storage. Both mechanisms must resolve to the same backend identity and authorization model.
