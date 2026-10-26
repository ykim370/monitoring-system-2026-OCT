import io
import json
import sqlite3
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

from app import domain as d
from app.security import Config, hash_password
from app.web import Application


class WorkspaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password = 'test-only-not-a-real-secret'
        cls.password_hash = hash_password(cls.password)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = str(Path(self.directory.name) / 'workspace.sqlite3')
        self.config = Config(self.path, self.password_hash, 'http://127.0.0.1:8000', False)
        self.app = Application(self.config)
        self.cookie = ''
        status, _, headers = self.request('login', 'POST', {'password': self.password})
        self.assertEqual(status, 200)
        self.cookie = dict(headers)['Set-Cookie'].split(';')[0]

    def tearDown(self):
        self.directory.cleanup()

    def request(self, path, method='GET', body=None, origin='http://127.0.0.1:8000', cookie=None, raw=False):
        data = body if raw else json.dumps(body).encode() if body is not None else b''
        env = {'REQUEST_METHOD': method, 'PATH_INFO': '/api/' + path, 'HTTP_HOST': '127.0.0.1:8000',
               'HTTP_ORIGIN': origin, 'HTTP_COOKIE': self.cookie if cookie is None else cookie,
               'CONTENT_TYPE': 'application/json', 'CONTENT_LENGTH': str(len(data)),
               'REMOTE_ADDR': '127.0.0.1', 'wsgi.input': io.BytesIO(data)}
        result = []
        payload = b''.join(self.app(env, lambda status, headers: result.extend([status, headers])))
        return int(result[0].split()[0]), json.loads(payload), result[1]

    def post(self, path, body):
        status, value, _ = self.request(path, 'POST', body)
        self.assertEqual(status, 201, value)
        return value

    def workspace(self):
        return self.request('workspace')[1]

    def evidence(self):
        return self.post('evidence', dict(symbol='ACME', title='Operating update', source='Company release',
                    url='https://example.com/release', classification='primary', verification='reviewed',
                    summary='A manually reviewed source record, not a model forecast.', published_at=d.stamp(), observed_at=d.stamp()))

    def thesis(self, linked=True, status='qualified'):
        evidence = [self.evidence()['id']] if linked else []
        return self.post('theses', dict(symbol='ACME', title='Test a margin change', hypothesis='Higher sales may improve margins.',
                         invalidation='Margins fail to improve.', catalyst='Next operating update', contradiction='Capacity costs could rise.',
                         horizon='20 days', status=status, evidence_ids=evidence))

    def position(self, **overrides):
        return dict(symbol='ACME', quantity='10', average_cost='40', price='42', sector='Technology', theme='Compute', as_of=d.stamp(), **overrides)

    def risk(self):
        return dict(symbol='ACME', quantity='5', entry='50', stop='48', theme='Compute', as_of=d.stamp())

    def decision(self, **overrides):
        body = dict(thesis_id=self.thesis()['id'], action='enter', rationale='A paper decision for testing only.',
                    expires_at=(d.now() + timedelta(hours=1)).isoformat(), risk_input=self.risk())
        body.update(overrides)
        return self.post('decisions', body)

    def review(self, dec, status='accepted'):
        return self.request(f"decisions/{dec['id']}/review", 'POST', dict(status=status, note='Reviewed the paper record.', version=dec['version']))

    def test_private_api_requires_session(self):
        self.assertEqual(self.request('workspace', cookie='')[0], 401)

    def test_logout_revokes_cookie(self):
        self.assertEqual(self.request('logout', 'POST', {})[0], 200)
        self.assertEqual(self.request('workspace')[0], 401)

    def test_cross_origin_write_rejected(self):
        self.assertEqual(self.request('positions', 'POST', self.position(), origin='https://attacker.example')[0], 403)

    def test_missing_origin_rejected(self):
        self.assertEqual(self.request('positions', 'POST', self.position(), origin='')[0], 403)

    def test_persistent_login_rate_limit(self):
        for _ in range(5):
            self.assertEqual(self.request('login', 'POST', {'password': 'incorrect'})[0], 401)
        self.app = Application(self.config)
        self.assertEqual(self.request('login', 'POST', {'password': self.password})[0], 429)

    def test_sessions_store_only_token_hash(self):
        with sqlite3.connect(self.path) as db:
            token = db.execute('SELECT token_hash FROM sessions').fetchone()[0]
        self.assertNotIn(self.cookie.split('=', 1)[1], token)
        self.assertEqual(len(token), 64)

    def test_cookie_and_security_headers(self):
        status, _, headers = self.request('login', 'POST', {'password': self.password})
        self.assertEqual(status, 200)
        headers = dict(headers)
        self.assertIn('HttpOnly', headers['Set-Cookie'])
        self.assertIn('SameSite=Strict', headers['Set-Cookie'])
        self.assertIn("script-src 'self'", headers['Content-Security-Policy'])
        self.assertEqual(headers['Cache-Control'], 'no-store')

    def test_production_rejects_insecure_configuration(self):
        with self.assertRaises(ValueError):
            Config(self.path, self.password_hash, 'http://public.example', False)
        with self.assertRaises(ValueError):
            Config(self.path, self.password_hash, 'http://public.example', True)
        self.assertIn('; Secure', Application(Config(self.path, self.password_hash, 'https://desk.example', True)).cookie('x')[1])

    def test_malformed_json_and_nan_rejected(self):
        self.assertEqual(self.request('positions', 'POST', b'{bad', raw=True)[0], 400)
        self.assertEqual(self.request('positions', 'POST', b'{"price":NaN}', raw=True)[0], 400)

    def test_position_saved_across_restart(self):
        self.post('positions', self.position())
        self.app = Application(self.config)
        self.assertEqual(self.workspace()['positions'][0]['symbol'], 'ACME')

    def test_nonfinite_and_short_positions_rejected(self):
        for value in ('NaN', 'Infinity', '-1', '0'):
            p = self.position(); p['quantity'] = value
            self.assertEqual(self.request('positions', 'POST', p)[0], 400)

    def test_future_and_unzoned_marks_rejected(self):
        for stamp in ('2026-01-01T10:00:00', (d.now() + timedelta(days=2)).isoformat()):
            p=self.position(); p['as_of']=stamp
            self.assertEqual(self.request('positions', 'POST', p)[0], 400)

    def test_csv_import_atomic_on_bad_row(self):
        csv='symbol,quantity,average_cost,price,sector,theme,as_of\nACME,10,40,42,Tech,Compute,'+d.stamp()+'\nOTHER,-1,40,42,Tech,Compute,'+d.stamp()+'\n'
        self.assertEqual(self.request('positions/import', 'POST', {'csv':csv})[0],400)
        self.assertEqual(self.workspace()['positions'],[])

    def test_csv_merge_retains_other_positions(self):
        self.post('positions',self.position())
        csv='symbol,quantity,average_cost,price,sector,theme,as_of,currency\nOTHER,2,30,31,Power,Grid,'+d.stamp()+',USD\n'
        self.assertEqual(self.request('positions/import','POST',{'csv':csv})[0],200)
        self.assertEqual(len(self.workspace()['positions']),2)

    def test_csv_duplicate_rejected(self):
        csv='symbol,quantity,average_cost,price,sector,theme,as_of\n'+('ACME,10,40,42,Tech,Compute,'+d.stamp()+'\n')*2
        self.assertEqual(self.request('positions/import','POST',{'csv':csv})[0],400)

    def test_optimistic_update_conflict(self):
        p=self.post('positions',self.position())
        self.assertEqual(self.request('positions/ACME','PATCH',{**p,'price':'43'})[0],200)
        self.assertEqual(self.request('positions/ACME','PATCH',{**p,'price':'44'})[0],409)
        self.assertEqual(self.workspace()['positions'][0]['price'],'43')

    def test_manual_mark_math(self):
        self.post('positions',self.position())
        s=self.workspace()['summary']
        self.assertEqual(s['gross_value'],420)
        self.assertEqual(s['unrealized_pnl'],20)
        self.assertEqual(s['gross_pct'],4.2)

    def test_risk_valid_entry_and_no_execution(self):
        status,r,_=self.request('risk/assess','POST',self.risk())
        self.assertEqual(status,200)
        self.assertTrue(r['passed'])
        self.assertEqual(r['metrics']['planned_loss'],10)
        self.assertFalse(r['execution_enabled'])

    def test_position_and_theme_caps(self):
        r=self.risk();r['quantity']='100'
        result=self.request('risk/assess','POST',r)[1]
        self.assertFalse(result['passed'])
        self.assertTrue(any('Single-name' in x for x in result['blocks']))
        self.assertTrue(any('Theme' in x for x in result['blocks']))

    def test_stale_portfolio_blocks_entry(self):
        p=self.position();p['as_of']=(d.now()-timedelta(hours=3)).isoformat()
        self.post('positions',p)
        self.assertFalse(self.request('risk/assess','POST',self.risk())[1]['passed'])

    def test_stale_proposed_quote_blocks_entry(self):
        r=self.risk();r['as_of']=(d.now()-timedelta(hours=3)).isoformat()
        result=self.request('risk/assess','POST',r)[1]
        self.assertIn('Proposed entry quote is stale.',result['blocks'])

    def test_wrong_existing_theme_rejected(self):
        self.post('positions',self.position())
        r=self.risk();r['theme']='Different'
        self.assertEqual(self.request('risk/assess','POST',r)[0],400)

    def test_stop_must_be_below_entry(self):
        r=self.risk();r['stop']='50'
        self.assertEqual(self.request('risk/assess','POST',r)[0],400)

    def test_evidence_rejects_script_url(self):
        ev=self.evidence();ev['url']='javascript:alert(1)'
        self.assertEqual(self.request('evidence','POST',ev)[0],400)

    def test_evidence_time_order(self):
        ev=self.evidence();ev['observed_at']=(d.now()-timedelta(days=1)).isoformat()
        self.assertEqual(self.request('evidence','POST',ev)[0],400)

    def test_evidence_symbol_must_match_thesis(self):
        t=self.thesis();t['symbol']='OTHER'
        self.assertEqual(self.request('theses/'+t['id'],'PATCH',t)[0],400)

    def test_acceptance_is_paper_only_and_no_holding_created(self):
        decision=self.decision()
        status,value,_=self.review(decision)
        self.assertEqual(status,200,value)
        self.assertEqual(value['status'],'accepted')
        self.assertFalse(value['execution_enabled'])
        self.assertEqual(self.workspace()['positions'],[])

    def test_duplicate_review_rejected(self):
        decision=self.decision()
        self.assertEqual(self.review(decision)[0],200)
        self.assertEqual(self.review(decision)[0],409)

    def test_acceptance_rechecks_limits(self):
        decision=self.decision()
        cfg=self.workspace()['settings'];cfg['risk_per_trade_pct']='0.01'
        self.assertEqual(self.request('settings','PATCH',cfg)[0],200)
        self.assertEqual(self.review(decision)[0],409)
        self.assertEqual(self.workspace()['decisions'][0]['status'],'pending')

    def test_acceptance_rechecks_thesis_version(self):
        decision=self.decision();t=self.workspace()['theses'][0];t['status']='under_review'
        self.assertEqual(self.request('theses/'+t['id'],'PATCH',t)[0],200)
        self.assertEqual(self.review(decision)[0],409)
        self.assertEqual(decision['snapshot']['thesis']['status'],'qualified')

    def test_acceptance_requires_reviewed_evidence(self):
        t=self.thesis(linked=False)
        dec=self.decision(thesis_id=t['id'])
        self.assertEqual(self.review(dec)[0],409)

    def test_expired_decision_rejected(self):
        decision=self.decision()
        with self.app.store.transaction(True) as db:
            row=self.app.store.get(db,'decisions',decision['id'])
            row['expires_at']=(d.now()-timedelta(seconds=1)).isoformat()
            row=self.app.store.put(db,'decisions',{k:v for k,v in row.items() if k not in ('id','version','created_at','updated_at')},row['id'],row['version'])
        self.assertEqual(self.review(row)[0],409)

    def test_audit_cannot_be_updated_or_deleted(self):
        for sql in ('UPDATE audit SET action=\'changed\'', 'DELETE FROM audit'):
            with sqlite3.connect(self.path) as db:
                with self.assertRaises(sqlite3.IntegrityError):
                    db.execute(sql)

    def test_notes_append_without_rewriting_decision(self):
        dec=self.decision()
        self.post('journal',{'decision_id':dec['id'],'category':'observation','note':'Track the operating update.'})
        self.assertEqual(self.workspace()['decisions'][0]['version'],dec['version'])
        self.assertEqual(len(self.workspace()['journal']),1)

    def test_examples_do_not_mix_with_user_import(self):
        self.assertEqual(self.request('examples','POST',{})[0],201)
        self.assertEqual(self.workspace()['dataset'],'example')
        self.assertEqual(self.request('positions/import','POST',{'csv':'anything'})[0],409)
        self.assertEqual(self.request('examples','DELETE',{'confirmation':'wrong'})[0],400)
        self.assertEqual(self.request('examples','DELETE',{'confirmation':'CLEAR EXAMPLES'})[0],200)
        self.assertEqual(self.workspace()['positions'],[])
        self.assertGreater(len(self.workspace()['audit']),0)

    def test_no_example_overwrite(self):
        self.post('positions',self.position())
        self.assertEqual(self.request('examples','POST',{})[0],409)

    def test_case_insensitive_theme_exposure(self):
        p=self.position();p['theme']='COMPUTE'
        self.post('positions',p)
        r=self.risk();r['theme']='compute'
        status,result,_=self.request('risk/assess','POST',r)
        self.assertEqual(status,200)
        self.assertAlmostEqual(result['metrics']['theme_pct'],6.7)

    def test_exact_limit_and_excess(self):
        r=self.risk();r.update(quantity='20',entry='50',stop='49.5')
        self.assertTrue(self.request('risk/assess','POST',r)[1]['passed'])
        r['quantity']='20.00000001'
        self.assertFalse(self.request('risk/assess','POST',r)[1]['passed'])

    def test_malformed_url_is_validation_error(self):
        ev=self.evidence();ev['url']='https://[broken'
        self.assertEqual(self.request('evidence','POST',ev)[0],400)

    def test_invalid_foreign_id_is_validation_error(self):
        self.assertEqual(self.request('journal','POST',{'decision_id':[],'note':'test','category':'outcome'})[0],400)


if __name__ == '__main__':
    unittest.main()
