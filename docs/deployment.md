# Private deployment and recovery

## Deployment contract

The current release is a single-owner WSGI application. Use a trusted HTTPS host, one application replica, and a **persistent local disk** for SQLite. Ephemeral/serverless filesystems and network-mounted SQLite are not supported. Multiple service replicas require a shared database redesign and appropriate distributed session/rate-limit handling.

Production environment:

| Variable | Value |
| --- | --- |
| `APP_PASSWORD_HASH` | Output of `python3 -m app password`; keep private |
| `APP_ORIGIN` | Exact HTTPS origin without a trailing slash/path |
| `APP_DATABASE` | Private persistent database path, e.g. `/data/workspace.sqlite3` |

Keep the original password hash securely. Never commit credentials, real portfolio CSVs, exports, SQLite files or backups. The git and Docker ignore files exclude common local data paths; review additions before pushing.

## Docker

Copy `.env.example` to a private `.env`, set your values, then:

```bash
docker build -t axiom-research .
docker volume create axiom_data
docker run -d --name axiom --restart unless-stopped --env-file .env -p 127.0.0.1:8000:8000 -v axiom_data:/data axiom-research
```

Put an HTTPS reverse proxy on the same host in front of port 8000, forwarding the original Host header. Limit inbound access to the intended audience. Configure the proxy's body/header limits and request timeouts. Do not expose a development server or the application port directly to the Internet. The image uses a non-root UID and does not contain local data or `.env` files.

`GET /health` returns basic liveness without private records. It requires the configured Host header. It is not a full backup, feed-freshness or broker-readiness test. Application `/api/session` can be checked without signing in; private endpoints require a valid session.

## Backup

Use SQLite's online backup API rather than copying only the database file while WAL writes may be active. Run on the host against the mounted database with paths appropriate to your deployment:

```python
import sqlite3
with sqlite3.connect('/private/data/workspace.sqlite3') as source:
    with sqlite3.connect('/private/backups/workspace-backup.sqlite3') as target:
        source.backup(target)
```

Restrict backup permissions, encrypt backup storage, and retain tested generations. To restore, stop the app, preserve the current database and WAL/SHM files privately, restore into a clean database path, and restart with `APP_DATABASE` pointing at it. Verify the latest positions, thesis versions, decision snapshots and audit sequence. **Sessions in a restored backup are also restored**; clear the sessions table during recovery if old sessions should be revoked.

Password rotation: replace the environment hash, clear `sessions` in a controlled maintenance window, and restart. Merely changing the hash does not revoke already-issued sessions. Login failures are persisted and limited to five per source IP over 15 minutes. The app intentionally does not trust arbitrary forwarded-IP headers; configure any additional edge rate limiting at the trusted proxy.

## Phone and MacBook

Open the same deployed HTTPS origin and sign in on either device. Records live on the server. Add the page to your home screen if your browser supports the manifest. This release has no service worker, offline portfolio cache, push subscriptions or background market ingestion. Device notifications must not be treated as protective orders when added later.

## Verification limits for this first implementation

The backend is covered by automated application, HTTP integration and production WSGI configuration tests. JavaScript syntax and DOM workflow tests pass. Full rendered layout and real-device behavior still require browser QA on a reachable deployment. The authoring cloud browser could not access the local development origin. Docker build/hosting readiness should be verified on the target host before enabling access.
