"""Local development and password setup. No dependencies needed for local use."""
import argparse
import getpass
from wsgiref.simple_server import make_server
from .security import Config, hash_password
from .web import Application


def main():
    parser = argparse.ArgumentParser(description='Evidence-led paper research desk')
    parser.add_argument('command', choices=['serve', 'password'], nargs='?', default='serve')
    parser.add_argument('--dev', action='store_true', help='Loopback-only HTTP development mode')
    args = parser.parse_args()
    if args.command == 'password':
        first = getpass.getpass('New workspace password (12+ characters): ')
        if first != getpass.getpass('Confirm password: '):
            parser.error('Passwords do not match.')
        print(hash_password(first))
        return
    if not args.dev:
        parser.error('Use --dev locally. Use gunicorn app.wsgi:application behind HTTPS in production.')
    config = Config.from_env(dev=True)
    if config.origin != 'http://127.0.0.1:8000':
        parser.error('Development server requires APP_ORIGIN=http://127.0.0.1:8000.')
    print('Paper research desk: http://127.0.0.1:8000 (local only)', flush=True)
    with make_server('127.0.0.1', 8000, Application(config)) as server:
        server.serve_forever()


if __name__ == '__main__':
    main()
