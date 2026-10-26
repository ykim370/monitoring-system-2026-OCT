# Axiom — hosted research desk

Cloud-compatible version of the paper research app in ykim370/monitoring-system-2026-OCT. Runs on Sites with ChatGPT sign-in and durable D1 records. No local Python server or separate workspace password is required.

The Site is owner-private. The API also requires identity and scopes all records to the authenticated user ID. Each mutation uses an optimistic revision check and an atomic D1 batch with append-only audit events. Conflicting mutations do not partially save.

Portfolio imports, evidence, thesis revisions, decision snapshots, journal notes, paper limits and optional fictional examples are supported. Quotes and research are manually entered. Live feeds, forecasting, broker execution and notifications remain disabled.

## Validation

```
node --test tests/domain.test.mjs
node node_modules/typescript/bin/tsc --noEmit
node --check public/app.js
```

Financial comparisons use 8-place fixed-point BigInt arithmetic. Tests cover allocation boundaries, malformed input, stale marks, CSV parsing, snapshots and acceptance-time revalidation.

Schema and migrations are in db/ and drizzle/. Request handlers never create schema. Cloud and local preview databases are separate. Current workspace state has a 1.5 MB limit; export before reaching it. Audit history is separate. This model supports a single research desk, not high-volume institutional ingestion.

Publish through the maintained Sites workflow. Do not deploy the Python entrypoint to a Worker. Never commit database files, tokens, local preview state or environment files.
