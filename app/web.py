"""Small WSGI JSON application with same-origin writes and durable paper records."""
import hashlib
import json
import logging
import secrets
import time
from http import HTTPStatus
from http.cookies import SimpleCookie
from pathlib import Path

from . import domain as d
from .security import verify_password
from .storage import Conflict, Store

ASSETS = Path(__file__).parent / 'static'
KINDS = ('positions', 'evidence', 'theses', 'decisions', 'journal')


class HTTPError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class Application:
    def __init__(self, config):
        self.config, self.store = config, Store(config.database)

    def __call__(self, environ, start_response):
        headers = [('Cache-Control', 'no-store'), ('X-Content-Type-Options', 'nosniff'),
                   ('Referrer-Policy', 'no-referrer'), ('X-Frame-Options', 'DENY'),
                   ('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"),
                   ('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')]
        try:
            status, value, extra = self.handle(environ)
            headers += extra
        except HTTPError as exc:
            status, value = exc.status, {'error': exc.message}
        except d.Invalid as exc:
            status, value = 400, {'error': str(exc)}
        except Conflict as exc:
            status, value = 409, {'error': str(exc)}
        except Exception:
            logging.exception('Request failed')
            status, value = 500, {'error': 'Request failed. No partial change was saved.'}
        if isinstance(value, bytes):
            body = value
        else:
            body = json.dumps(value, allow_nan=False).encode()
            headers.append(('Content-Type', 'application/json; charset=utf-8'))
        headers.append(('Content-Length', str(len(body))))
        start_response(f'{status} {HTTPStatus(status).phrase}', headers)
        return [body]

    def body(self, env):
        if env.get('CONTENT_TYPE', '').split(';')[0] != 'application/json':
            raise HTTPError(415, 'Use application/json.')
        try:
            length = int(env.get('CONTENT_LENGTH', '0'))
        except ValueError:
            raise HTTPError(400, 'Invalid content length.') from None
        if not 0 < length <= 1_100_000:
            raise HTTPError(413, 'Request body must be between 1 byte and 1.1 MB.')
        try:
            value = json.loads(env['wsgi.input'].read(length), parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        except (ValueError, UnicodeError):
            raise HTTPError(400, 'Invalid JSON.') from None
        if not isinstance(value, dict):
            raise HTTPError(400, 'JSON body must be an object.')
        return value

    @staticmethod
    def token_hash(env):
        cookie = SimpleCookie()
        try:
            cookie.load(env.get('HTTP_COOKIE', ''))
            token = cookie['workspace_session'].value if 'workspace_session' in cookie else ''
        except Exception:
            token = ''
        return hashlib.sha256(token.encode()).hexdigest()

    def authenticated(self, db, env):
        return db.execute('SELECT 1 FROM sessions WHERE token_hash=? AND expires>?', (self.token_hash(env), time.time())).fetchone() is not None

    def cookie(self, token='', expires=False):
        return ('Set-Cookie', f'workspace_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={0 if expires else 43200}' + ('; Secure' if self.config.secure_cookie else ''))

    def handle(self, env):
        method, path = env.get('REQUEST_METHOD', 'GET'), env.get('PATH_INFO', '/')
        if env.get('HTTP_HOST') != self.config.origin.split('://', 1)[1]:
            raise HTTPError(403, 'Unexpected host.')
        if method not in ('GET', 'POST', 'PATCH', 'DELETE'):
            raise HTTPError(405, 'Method not allowed.')
        if method == 'GET' and path in ('/', '/app.js', '/style.css', '/icon.svg', '/manifest.webmanifest'):
            asset = 'index.html' if path == '/' else path[1:]
            mime = {'js': 'text/javascript', 'css': 'text/css', 'html': 'text/html', 'svg': 'image/svg+xml', 'webmanifest': 'application/manifest+json'}[asset.rsplit('.', 1)[1]]
            return 200, (ASSETS / asset).read_bytes(), [('Content-Type', mime + '; charset=utf-8')]
        if method == 'GET' and path == '/health':
            return 200, {'status': 'ok', 'execution_enabled': False}, []
        if not path.startswith('/api/'):
            raise HTTPError(404, 'Not found.')
        data = {}
        if method != 'GET':
            if env.get('HTTP_ORIGIN') != self.config.origin:
                raise HTTPError(403, 'Write requests require the configured same origin.')
            data = self.body(env)
        with self.store.transaction(write=method != 'GET') as db:
            if path == '/api/login' and method == 'POST':
                return self.login(db, env, data)
            if path == '/api/session' and method == 'GET':
                return 200, {'authenticated': self.authenticated(db, env), 'mode': 'paper', 'execution_enabled': False}, []
            if not self.authenticated(db, env):
                raise HTTPError(401, 'Sign in to your workspace.')
            if path == '/api/logout' and method == 'POST':
                db.execute('DELETE FROM sessions WHERE token_hash=?', (self.token_hash(env),))
                return 200, {'ok': True}, [self.cookie(expires=True)]
            return self.api(db, method, path, data)

    def login(self, db, env, data):
        ip, current = env.get('REMOTE_ADDR', 'unknown'), time.time()
        db.execute('DELETE FROM login_attempts WHERE at<?', (current - 900,))
        if db.execute('SELECT count(*) FROM login_attempts WHERE ip=?', (ip,)).fetchone()[0] >= 5:
            return 429, {'error': 'Too many attempts. Try again in 15 minutes.'}, []
        password = data.get('password')
        if not isinstance(password, str) or len(password) > 1024 or not verify_password(password, self.config.password_hash):
            db.execute('INSERT INTO login_attempts VALUES(?,?)', (ip, current))
            return 401, {'error': 'Incorrect password.'}, []
        db.execute('DELETE FROM login_attempts WHERE ip=?', (ip,))
        db.execute('DELETE FROM sessions WHERE expires<?', (current,))
        token = secrets.token_urlsafe(32)
        db.execute('INSERT INTO sessions VALUES(?,?)', (hashlib.sha256(token.encode()).hexdigest(), current + 43200))
        return 200, {'authenticated': True}, [self.cookie(token)]

    def require(self, db, kind, identity):
        identity = d.text(identity, 'Record ID', 80)
        row = self.store.get(db, kind, identity)
        if not row:
            raise HTTPError(404, f'{kind} record not found.')
        return row

    def workspace(self, db):
        out = {kind: self.store.all(db, kind) for kind in KINDS}
        out['settings'] = self.store.get(db, 'settings', 'account')
        out['summary'] = d.portfolio(out['positions'], out['settings'])
        out['dataset'] = 'example' if self.store.get(db, 'meta', 'example') else 'user'
        out['audit'] = [dict(r, payload=json.loads(r['payload'])) for r in db.execute('SELECT * FROM audit ORDER BY sequence DESC LIMIT 100')]
        out['capabilities'] = dict(mode='paper', feeds_connected=False, forecasting_enabled=False, execution_enabled=False,
                                   monitoring_scope='Manual records and deterministic paper risk checks')
        out['generated_at'] = d.stamp()
        return out

    def api(self, db, method, path, data):
        s = self.store
        if path == '/api/workspace' and method == 'GET':
            return 200, self.workspace(db), []
        if path == '/api/settings' and method == 'PATCH':
            return 200, s.put(db, 'settings', d.settings(data), 'account', expected=data.get('version')), []
        if path == '/api/positions/import' and method == 'POST':
            if s.get(db, 'meta', 'example'):
                raise HTTPError(409, 'Clear the example workspace before importing your own portfolio.')
            rows = d.csv_positions(data.get('csv'))
            for row in rows:
                old = s.get(db, 'positions', row['symbol'])
                s.put(db, 'positions', row, row['symbol'], expected=old['version'] if old else None)
            return 200, {'imported': len(rows), 'mode': 'merge', 'message': 'Other positions were retained.'}, []
        if path == '/api/risk/assess' and method == 'POST':
            return 200, d.assess(data, s.all(db, 'positions'), s.get(db, 'settings', 'account')), []
        if path == '/api/examples' and method == 'POST':
            if any(s.all(db, kind) for kind in KINDS) or s.get(db, 'meta', 'example'):
                raise HTTPError(409, 'Example data can only be loaded into an empty workspace.')
            from .sample import load
            load(s, db)
            return 201, {'ok': True}, []
        if path == '/api/examples' and method == 'DELETE':
            if not s.get(db, 'meta', 'example') or data.get('confirmation') != 'CLEAR EXAMPLES':
                raise HTTPError(400, 'Type CLEAR EXAMPLES to clear this example workspace.')
            for kind in (*KINDS, 'meta'):
                for row in s.all(db, kind):
                    s.remove(db, kind, row['id'], row['version'])
            return 200, {'ok': True, 'audit_preserved': True}, []
        parts = path.removeprefix('/api/').split('/')
        kind, identity = parts[0], parts[1] if len(parts) > 1 else None
        if kind == 'decisions' and identity and len(parts) == 3 and parts[2] == 'review' and method == 'POST':
            return 200, self.review(db, identity, data), []
        if len(parts) > 2:
            raise HTTPError(404, 'Not found.')
        if kind == 'positions':
            if method == 'POST' and identity is None:
                row = d.position(data)
                if s.get(db, kind, row['symbol']):
                    raise HTTPError(409, 'Position exists. Edit it or merge a CSV import.')
                return 201, s.put(db, kind, row, row['symbol']), []
            if identity and method == 'PATCH':
                self.require(db, kind, identity)
                row = d.position(data)
                if row['symbol'] != identity:
                    raise d.Invalid('Position symbol cannot be changed.')
                return 200, s.put(db, kind, row, identity, data.get('version')), []
            if identity and method == 'DELETE':
                s.remove(db, kind, identity, data.get('version'))
                return 200, {'ok': True}, []
        if kind == 'evidence' and method == 'POST' and identity is None:
            return 201, s.put(db, kind, d.evidence(data)), []
        if kind == 'theses' and method in ('POST', 'PATCH') and ((method == 'POST' and identity is None) or (method == 'PATCH' and identity)):
            row = d.thesis(data)
            for eid in row['evidence_ids']:
                ev = self.require(db, 'evidence', eid)
                if ev['symbol'] != row['symbol']:
                    raise d.Invalid('Linked evidence must match the thesis symbol.')
            if identity:
                self.require(db, kind, identity)
            return (201 if method == 'POST' else 200), s.put(db, kind, row, identity, data.get('version')), []
        if kind == 'decisions' and method == 'POST' and identity is None:
            return 201, self.decision(db, data), []
        if kind == 'journal' and method == 'POST' and identity is None:
            decision = self.require(db, 'decisions', data.get('decision_id'))
            return 201, s.put(db, 'journal', dict(decision_id=decision['id'], symbol=decision['symbol'],
                       note=d.text(data.get('note'), 'Journal note'), category=d.choice(data.get('category'), ('observation', 'override', 'outcome'), 'Category'))), []
        raise HTTPError(404, 'Not found.')

    def decision(self, db, data):
        s = self.store
        thesis = self.require(db, 'theses', data.get('thesis_id'))
        action = d.choice(data.get('action'), ('investigate', 'wait', 'enter', 'maintain', 'reduce', 'exit'), 'Action')
        expiry = d.moment(data.get('expires_at'), 'Expiry', future=True)
        if not 0 < (expiry - d.now()).total_seconds() <= 7 * 86400:
            raise d.Invalid('Expiry must be in the next seven days.')
        evidence = [self.require(db, 'evidence', eid) for eid in thesis['evidence_ids']]
        config = s.get(db, 'settings', 'account')
        positions = s.all(db, 'positions')
        risk = None
        if action == 'enter':
            risk_input = data.get('risk_input')
            if not isinstance(risk_input, dict) or d.symbol(risk_input.get('symbol')) != thesis['symbol']:
                raise d.Invalid('An entry needs risk inputs matching the thesis symbol.')
            risk = d.assess(risk_input, positions, config)
        return s.put(db, 'decisions', dict(symbol=thesis['symbol'], thesis_id=thesis['id'], action=action,
                     rationale=d.text(data.get('rationale'), 'Decision rationale'), expires_at=expiry.isoformat(),
                     status='pending', origin='user_authored', execution_enabled=False,
                     snapshot=dict(thesis=thesis, evidence=evidence, portfolio=positions, settings=config, risk=risk)))

    def review(self, db, identity, data):
        s = self.store
        decision = self.require(db, 'decisions', identity)
        if decision['version'] != data.get('version') or decision['status'] != 'pending':
            raise Conflict('Decision changed or was already reviewed.')
        status = d.choice(data.get('status'), ('accepted', 'declined'), 'Review decision')
        if status == 'accepted':
            if d.moment(decision['expires_at'], future=True) <= d.now():
                raise HTTPError(409, 'Decision expired. Record a new decision.')
            current = self.require(db, 'theses', decision['thesis_id'])
            if current['version'] != decision['snapshot']['thesis']['version']:
                raise HTTPError(409, 'Thesis changed. Record a new decision.')
            if decision['action'] == 'enter':
                if current['status'] not in ('qualified', 'active'):
                    raise HTTPError(409, 'An entry needs a qualified or active thesis.')
                if not any(e['verification'] == 'reviewed' and e['classification'] != 'inference' and e['url'] for e in decision['snapshot']['evidence']):
                    raise HTTPError(409, 'An entry needs reviewed primary or secondary source evidence.')
                risk = d.assess(decision['snapshot']['risk']['proposed'], s.all(db, 'positions'), s.get(db, 'settings', 'account'))
                if not risk['passed']:
                    raise HTTPError(409, 'Current paper risk checks block acceptance: ' + ' '.join(risk['blocks']))
                decision['review_risk'] = risk
        payload = {k: v for k, v in decision.items() if k not in ('id', 'version', 'created_at', 'updated_at')}
        payload.update(status=status, review_note=d.text(data.get('note'), 'Review reason'), reviewed_at=d.stamp())
        return s.put(db, 'decisions', payload, identity, data['version'])
