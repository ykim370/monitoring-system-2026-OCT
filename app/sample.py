"""Explicitly fictional examples. Never loaded automatically."""
from datetime import timedelta
from .domain import now, stamp


def load(store, db):
    store.put(db, 'meta', {'fictional': True}, 'example')
    for symbol, quantity, price, sector, theme, age in [('ALFA', '8', '50', 'Technology', 'Compute', 10), ('NOVA', '8', '80', 'Industrials', 'Power', 120), ('ORBT', '6', '90', 'Technology', 'Compute', 15)]:
        store.put(db, 'positions', dict(symbol=symbol, quantity=quantity, average_cost=str(float(price) * .95),
                  price=price, sector=sector, theme=theme, as_of=(now() - timedelta(minutes=age)).isoformat(), currency='USD', source='Fictional example'), symbol)
    ev = store.put(db, 'evidence', dict(symbol='ALFA', title='Example: demand improvement needs verification', source='Fictional company release',
                   url='', classification='inference', verification='unreviewed', summary='Synthetic narrative used to demonstrate the workflow. No real company, contract or forecast is represented.',
                   published_at=(now() - timedelta(hours=3)).isoformat(), observed_at=stamp()))
    store.put(db, 'theses', dict(symbol='ALFA', title='Test whether better demand can improve margins', hypothesis='Investigate whether demand translates into higher margins after capacity costs.',
              invalidation='Customer evidence contradicts demand assumptions, or margin improvement fails to appear.', catalyst='Next fictional operating update',
              contradiction='Capacity expenses may offset revenue growth.', horizon='20 days', status='investigating', evidence_ids=[ev['id']]))
