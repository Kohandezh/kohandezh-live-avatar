# ADR 0003 — Server State and Client State

## Status

Accepted

## Decision

Use TanStack Query for backend-owned state and Redux Toolkit only for client-owned global state.

## Rationale

This prevents duplicated sources of truth and gives server data proper caching, synchronization, loading, error, and invalidation behavior.
