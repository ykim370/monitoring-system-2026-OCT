# Axiom — Evidence-led research desk

A private, responsive investment research workspace. This is the first operational foundation of a larger monitoring and decision-support platform.

**Current scope: manual paper records and deterministic risk checks. No live market feed, AI forecast, background alert service or order execution is connected.** The repository contains application code and deliberately fictional examples; it does not contain an investor's real portfolio.

## Working features

- Password-protected, single-owner workspace with server-side sessions.
- Durable SQLite positions, evidence, theses, decisions and journal notes.
- CSV portfolio merge with complete validation before any row is committed.
- Marked exposure, cost difference, theme concentration and stale-mark flags.
- Paper-entry assessment against single-name, theme, gross and planned-loss limits.
- Thesis lifecycle, contradictory evidence, invalidation conditions and source links.
- Frozen decision snapshots and optimistic versions to prevent stale edits.
- Acceptance rechecks expiry, thesis version, source review and current risk limits. Accepting a decision never sends an order or creates a holding.
- Append-only audit events, JSON record exports and optional fictional examples.
- Responsive phone/MacBook interface and a home-screen manifest. Push and offline access are not implemented.
- Automated backend, HTTP and DOM workflow checks with GitHub Actions CI.

## Open the private hosted app

[Open Axiom Research Desk](https://axiom-research-desk.muddy-mite-5466.chatgpt.site)

Choose **Continue with ChatGPT** and use the account that owns this Site. The hosted version uses ChatGPT sign-in and cloud storage; it does not require the local Python server or a separate workspace password. Its complete source is in [hosted/](hosted/README.md). It remains a paper research workspace with manual records.

## Run locally — Python 3.12+

The application and tests use the Python standard library. No package installation is needed for local development.

```bash
git clone https://github.com/ykim370/monitoring-system-2026-OCT.git
cd monitoring-system-2026-OCT
export APP_PASSWORD_HASH="$(python3 -m app password)"
export APP_ORIGIN=http://127.0.0.1:8000
python3 -m app serve --dev
```

The password helper prompts without echoing your password. Open **http://127.0.0.1:8000**, sign in, and add your records or choose **Load example workspace**. Local development binds to loopback only. The password hash and database must be retained privately to keep using the same workspace after restarting.

The default USD 10,000 equity and allocation limits are editable **paper experiment settings**, not a statement about a real account. Marks and source reviews are user-provided. The app does not validate that a market quote or financial claim is true.

## Import portfolio records

Download the CSV template from Portfolio → Import CSV. Required columns:

```csv
symbol,quantity,average_cost,price,sector,theme,as_of,currency
ACME,10,40,42,Technology,Example theme,2026-10-27T01:00:00Z,USD
```

The row above is fictional. Enter the actual observation time of each mark. Old timestamps remain old; opening the website does not refresh prices. All timestamps need a timezone. Only USD long equity positions are supported in this release. Theme grouping is case-insensitive.

Imports **merge by symbol**, retain omitted positions, reject duplicate symbols, and roll back the entire import on any invalid row. Use Edit → Remove position to remove a holding. Clear the fictional example workspace before importing your own CSV. Changes made while exploring examples are cleared with the examples; audit history remains.

## Verify

```bash
python3 -m unittest discover -s tests -v
python3 -m compileall -q app
node --check app/static/app.js
```

Node is not needed to run the application. With Node 24, run the optional DOM workflow suite:

```bash
npm ci --ignore-scripts
npm test
```

The initial build passes **43 backend/HTTP/production-configuration tests and 8 DOM workflow tests** when production requirements are installed. Without Gunicorn the production-configuration test is skipped. Tests cover authentication, persistent rate limits, atomic imports, stale prices, allocation checks, snapshot/version integrity, paper-decision acceptance, safe source rendering and form workflows. DOM emulation does not replace full rendered browser/device QA, which remains pending on a reachable deployment.

## Publish privately

This repository does not automatically deploy a website. Use an HTTPS host with a persistent disk/volume and the production WSGI server. See [deployment](docs/deployment.md). Do not put this application on static GitHub Pages: it needs a backend and private durable records.

```bash
python3 -m pip install -r requirements.txt
```

Set `APP_PASSWORD_HASH`, `APP_ORIGIN` and `APP_DATABASE` in your host's secret/environment settings, then run:

```bash
gunicorn app.wsgi:application --bind 127.0.0.1:8000 --workers 1 --threads 4
```

Place an HTTPS reverse proxy in front. Production refuses a missing password hash or a non-HTTPS origin and uses Secure, HttpOnly, SameSite=Strict cookies. Phone access requires the deployed HTTPS origin; your phone cannot access your MacBook's loopback address.

## Design and next milestones

Read [architecture and research roadmap](docs/architecture.md), [API contract](docs/api.md), and [deployment and backup](docs/deployment.md).

Next: point-in-time provider adapters and caching → one predeclared strategy with realistic baselines → expectations/relationship features evaluated through ablation → forward paper evaluation and attribution → separately authorized broker integration.

Complexity earns its place through measured incremental usefulness. A working website does not establish predictive skill. Stops and configured limits cannot guarantee a maximum drawdown or prevent losses during price gaps.

## Sector radar

Open the **Sector radar** tab in the private app. It checks the broad market before evaluating the eleven sector ETF proxies and separates today's US session from the next 2–5 sessions. A conditional bullish outlook needs three sourced evidence families and no blocking market/event risk. Connect an entitled Alpha Vantage key in the private form; macro/news review and catalyst extraction currently remain owner-supplied. No key belongs in GitHub or chat. See [the implementation and limitations](hosted/SECTOR_RADAR.md).
