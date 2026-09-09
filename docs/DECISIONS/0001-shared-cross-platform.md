# ADR 0001 — Shared Cross-Platform Architecture

## Status

Accepted

## Decision

Use one React/TypeScript frontend for Web/PWA and Android/iOS through Capacitor.

## Rationale

This minimizes duplicated UI and business logic while preserving access to native capabilities.

## Consequences

Platform-specific behavior must be isolated behind adapters.
