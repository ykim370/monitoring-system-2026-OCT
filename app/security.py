"""Single-owner authentication. Session secrets never enter the audit ledger."""
import hashlib
import hmac
import os
import secrets
from dataclasses import dataclass
from urllib.parse import urlsplit


def hash_password(password):
    if len(password) < 12:
        raise ValueError('Use at least 12 characters.')
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 600_000).hex()
    return f'pbkdf2_sha256$600000${salt}${digest}'


def verify_password(password, encoded):
    try:
        algorithm, rounds, salt, expected = encoded.split('$')
        if algorithm != 'pbkdf2_sha256' or not 600_000 <= int(rounds) <= 2_000_000 or len(expected) != 64:
            return False
        actual = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), int(rounds)).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


@dataclass(frozen=True)
class Config:
    database: str
    password_hash: str
    origin: str = 'http://127.0.0.1:8000'
    secure_cookie: bool = True

    def __post_init__(self):
        parsed = urlsplit(self.origin)
        if not parsed.hostname or parsed.scheme not in ('http', 'https') or parsed.path or parsed.query or parsed.fragment or parsed.username:
            raise ValueError('APP_ORIGIN must be an exact origin without a trailing slash or path.')
        try:
            algorithm, rounds, salt, digest = self.password_hash.split('$')
            valid = algorithm == 'pbkdf2_sha256' and 600_000 <= int(rounds) <= 2_000_000 and len(salt) == 32 and len(bytes.fromhex(digest)) == 32
        except (ValueError, TypeError):
            valid = False
        if not valid:
            raise ValueError('Set APP_PASSWORD_HASH using python -m app password.')
        if not self.secure_cookie and parsed.hostname not in ('127.0.0.1', 'localhost', '::1'):
            raise ValueError('Insecure cookies are permitted only on loopback origins.')
        if self.secure_cookie and parsed.scheme != 'https':
            raise ValueError('Production APP_ORIGIN must use HTTPS.')

    @classmethod
    def from_env(cls, dev=False):
        return cls(os.getenv('APP_DATABASE', 'data/workspace.sqlite3'), os.getenv('APP_PASSWORD_HASH', ''),
                   os.getenv('APP_ORIGIN', 'http://127.0.0.1:8000' if dev else ''), not dev)
