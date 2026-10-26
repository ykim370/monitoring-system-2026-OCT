"""Transactional SQLite records, optimistic versions, and append-only audit events."""
import json
import sqlite3
from contextlib import closing, contextmanager
from pathlib import Path
from uuid import uuid4

from .domain import DEFAULT_SETTINGS, stamp


SCHEMA = '''
CREATE TABLE IF NOT EXISTS records (
 kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
 version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(kind,id)
);
CREATE TABLE IF NOT EXISTS audit (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL,
 entity TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit
BEGIN SELECT RAISE(ABORT,'Audit events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit
BEGIN SELECT RAISE(ABORT,'Audit events are append-only'); END;
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT NOT NULL, at REAL NOT NULL);
CREATE INDEX IF NOT EXISTS login_attempts_ip ON login_attempts(ip,at);
PRAGMA user_version=1;
'''


def encode(data):
    return json.dumps(data, allow_nan=False, separators=(',', ':'))


class Conflict(ValueError):
    pass


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self.connect()) as db:
            version = db.execute('PRAGMA user_version').fetchone()[0]
            if version not in (0, 1):
                raise RuntimeError('Database schema is newer than this application.')
            db.executescript(SCHEMA)
            if not self.get(db, 'settings', 'account'):
                self.put(db, 'settings', DEFAULT_SETTINGS, 'account')

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('PRAGMA busy_timeout=10000')
        return db

    @contextmanager
    def transaction(self, write=False):
        db = self.connect()
        try:
            db.execute('BEGIN IMMEDIATE' if write else 'BEGIN')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def unpack(row):
        if row is None:
            return None
        return {**json.loads(row['payload']), 'id': row['id'], 'version': row['version'],
                'created_at': row['created_at'], 'updated_at': row['updated_at']}

    def get(self, db, kind, identity):
        return self.unpack(db.execute('SELECT * FROM records WHERE kind=? AND id=?', (kind, identity)).fetchone())

    def all(self, db, kind):
        return [self.unpack(r) for r in db.execute('SELECT * FROM records WHERE kind=? ORDER BY updated_at DESC,id', (kind,))]

    def audit(self, db, action, entity, payload):
        db.execute('INSERT INTO audit(action,entity,payload,created_at) VALUES(?,?,?,?)', (action, entity, encode(payload), stamp()))

    def put(self, db, kind, payload, identity=None, expected=None):
        identity = identity or uuid4().hex
        old = self.get(db, kind, identity)
        if old and expected != old['version']:
            raise Conflict('Record changed. Refresh and try again.')
        if not old and expected is not None:
            raise Conflict('Record no longer exists.')
        created, updated = old['created_at'] if old else stamp(), stamp()
        version = old['version'] + 1 if old else 1
        db.execute('INSERT INTO records VALUES(?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload,version=excluded.version,updated_at=excluded.updated_at',
                   (kind, identity, encode(payload), version, created, updated))
        new = self.get(db, kind, identity)
        self.audit(db, 'updated' if old else 'created', f'{kind}/{identity}', {'before': old, 'after': new})
        return new

    def remove(self, db, kind, identity, expected):
        old = self.get(db, kind, identity)
        if not old or old['version'] != expected:
            raise Conflict('Record changed or was removed. Refresh and try again.')
        db.execute('DELETE FROM records WHERE kind=? AND id=?', (kind, identity))
        self.audit(db, 'removed', f'{kind}/{identity}', {'before': old})
