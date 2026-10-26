"""HTTP integration, using an ephemeral local server and synthetic credentials."""
import http.cookiejar
import json
import importlib.util
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener
from wsgiref.simple_server import WSGIRequestHandler, make_server

from app.security import Config, hash_password
from app.web import Application


class QuietHandler(WSGIRequestHandler):
    def log_message(self, *args):
        pass


class HTTPIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.server = make_server('127.0.0.1', 0, None, handler_class=QuietHandler)
        cls.origin = f'http://127.0.0.1:{cls.server.server_port}'
        config = Config(str(Path(cls.directory.name) / 'http.sqlite3'), hash_password('fixture-password-only'), cls.origin, False)
        cls.server.set_app(Application(config))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)
        cls.directory.cleanup()

    def test_full_http_session_and_assets(self):
        client = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        with client.open(self.origin + '/') as page:
            self.assertIn('Axiom', page.read().decode())
            self.assertEqual(page.headers['X-Content-Type-Options'], 'nosniff')
        for asset in ('/app.js', '/style.css', '/manifest.webmanifest', '/icon.svg'):
            with client.open(self.origin + asset) as response:
                self.assertEqual(response.status, 200)
                self.assertGreater(len(response.read()), 20)
        with self.assertRaises(HTTPError) as failure:
            client.open(self.origin + '/api/workspace')
        self.assertEqual(failure.exception.code, 401)
        login = Request(self.origin + '/api/login', method='POST', data=json.dumps({'password':'fixture-password-only'}).encode(),
                        headers={'Content-Type':'application/json','Origin':self.origin})
        with client.open(login) as response:
            self.assertTrue(json.load(response)['authenticated'])
        with client.open(self.origin + '/api/workspace') as response:
            data = json.load(response)
            self.assertFalse(data['capabilities']['execution_enabled'])
            self.assertFalse(data['capabilities']['forecasting_enabled'])
            self.assertEqual(data['positions'], [])

    def test_host_mismatch_fails_closed(self):
        client = build_opener()
        with self.assertRaises(HTTPError) as failure:
            client.open(Request(self.origin + '/api/session', headers={'Host':'attacker.example'}))
        self.assertEqual(failure.exception.code,403)

    @unittest.skipUnless(importlib.util.find_spec('gunicorn'), 'Install requirements.txt for production server check')
    def test_production_wsgi_configuration(self):
        env = {**os.environ, 'APP_ORIGIN':'https://research.example', 'APP_PASSWORD_HASH':hash_password('production-fixture-only'),
               'APP_DATABASE':str(Path(self.directory.name)/'production.sqlite3')}
        run = subprocess.run([sys.executable, '-m', 'gunicorn', '--check-config', 'app.wsgi:application'],
                             env=env, capture_output=True, text=True, timeout=30)
        self.assertEqual(run.returncode,0,run.stderr)


if __name__ == '__main__':
    unittest.main()
