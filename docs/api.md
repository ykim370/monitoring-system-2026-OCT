# API contract — paper research foundation

All writes require the exact configured `Origin`, `Content-Type: application/json`, and a JSON object. Except login, all private operations require the session cookie. Production cookies are HttpOnly, Secure and SameSite=Strict. Host headers must match `APP_ORIGIN`.

| Method / path | Behavior |
| --- | --- |
| `GET /health` | Public basic liveness; no portfolio data |
| `GET /api/session` | Authentication state and paper-only capability |
| `POST /api/login` | `{password}`; creates expiring server session |
| `POST /api/logout` | `{}`; revokes current session |
| `GET /api/workspace` | Authorized records, exposure summary, settings and latest 100 audit events |
| `PATCH /api/settings` | Paper equity/limits and expected `version` |
| `POST /api/positions` | New USD long equity record |
| `PATCH /api/positions/{symbol}` | Full validated replacement with expected `version` |
| `DELETE /api/positions/{symbol}` | `{version}`; remove holding, preserve audit |
| `POST /api/positions/import` | `{csv}`; atomic merge by symbol; at most 1000 rows/1 MB |
| `POST /api/evidence` | Source, classification, review status, symbol and timestamps |
| `POST /api/theses` | Hypothesis, invalidation, lifecycle, horizon and evidence IDs |
| `PATCH /api/theses/{id}` | Full validated revision with expected `version` |
| `POST /api/risk/assess` | Quantity, entry, stop, theme, symbol, quote `as_of` |
| `POST /api/decisions` | Thesis ID, action, rationale, expiry, and `risk_input` for entry |
| `POST /api/decisions/{id}/review` | Expected `version`, `status` accepted/declined, mandatory `note` |
| `POST /api/journal` | Decision ID, category and note |
| `POST /api/examples` | `{}`; fictional data only into an empty workspace |
| `DELETE /api/examples` | `{confirmation:"CLEAR EXAMPLES"}`; clears example-mode records, retains audit |

Position fields: `symbol`, `quantity`, `average_cost`, `price`, `sector`, `theme`, `as_of`, optional `currency` (USD only). Financial inputs accept positive finite decimal strings with up to 8 decimal places. Marks need timezone-aware timestamps and may not be future-dated.

Evidence fields: `symbol`, `title`, `source`, `url` (optional http[s]), `classification` (primary/secondary/inference), `verification` (unreviewed/reviewed), `summary`, `published_at`, `observed_at`. Source records are not fetched or independently verified by the server. Observation cannot precede publication.

Thesis fields: `symbol`, `title`, `hypothesis`, `invalidation`, optional `catalyst`/`contradiction`, `horizon` (5 days/20 days), `status` (investigating/qualified/active/under_review/invalidated/closed), `evidence_ids`. Evidence symbols must match.

Decisions are user-authored. Actions: investigate/wait/enter/maintain/reduce/exit. Expiry must be within seven days. Entries require matching-symbol risk inputs. Acceptance is a **paper record review**, never financial execution. An entry needs a qualified/active unchanged thesis, reviewed primary/secondary evidence with a source link, non-expired decision and current passing checks. It does not reserve capital; repeated accepted paper decisions are not a simulated order book.

Journal categories: observation/override/outcome. Free-text notes are qualitative; they do not constitute realized P&L attribution.

Errors return `{error: "..."}` with 400 validation, 401 authentication, 403 origin/host, 404 missing record, 409 stale version/state, 413 size, 415 content type, or 429 login rate limit. Writes are transactional; failures do not partially save records. No route places orders or stores broker credentials.
