"""Pure validation and portfolio arithmetic. No forecasts or order execution."""
import csv
import io
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit


class Invalid(ValueError):
    pass


def now():
    return datetime.now(timezone.utc)


def stamp():
    return now().isoformat()


def text(value, label, maximum=4000, required=True):
    if not isinstance(value, str) or len(value.strip()) > maximum:
        raise Invalid(f"{label} must be text with at most {maximum} characters.")
    value = value.strip()
    if required and not value:
        raise Invalid(f"{label} is required.")
    return value


def number(value, label, minimum=Decimal('0'), maximum=Decimal('1000000000000')):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise Invalid(f"{label} must be a finite number.") from None
    if not result.is_finite() or not minimum < result <= maximum or result.as_tuple().exponent < -8:
        raise Invalid(f"{label} must be greater than {minimum}, at most {maximum}, with up to 8 decimal places.")
    return result


def moment(value, label='Timestamp', future=False):
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except (ValueError, TypeError, AttributeError):
        raise Invalid(f"{label} must be an ISO timestamp with a timezone.") from None
    if parsed.tzinfo is None:
        raise Invalid(f"{label} needs a timezone.")
    if not future and (parsed - now()).total_seconds() > 60:
        raise Invalid(f"{label} cannot be in the future.")
    return parsed.astimezone(timezone.utc)


def symbol(value):
    value = text(value, 'Symbol', 15).upper()
    if not re.fullmatch(r'[A-Z][A-Z0-9.\-]{0,14}', value):
        raise Invalid('Symbol must contain letters, digits, dots or hyphens.')
    return value


def choice(value, allowed, label):
    if value not in allowed:
        raise Invalid(f"{label} must be one of: {', '.join(allowed)}.")
    return value


def position(data):
    if data.get('currency', 'USD') != 'USD':
        raise Invalid('This release supports USD long equity positions only.')
    return dict(symbol=symbol(data.get('symbol')), quantity=str(number(data.get('quantity'), 'Quantity')),
                average_cost=str(number(data.get('average_cost'), 'Average cost')),
                price=str(number(data.get('price'), 'Marked price')),
                sector=text(data.get('sector'), 'Sector', 80), theme=text(data.get('theme'), 'Theme', 80),
                as_of=moment(data.get('as_of'), 'Price as of').isoformat(), currency='USD',
                source='Manual import / user mark')


def csv_positions(raw):
    if not isinstance(raw, str) or len(raw.encode('utf-8')) > 1_000_000:
        raise Invalid('CSV must be text under 1 MB.')
    reader = csv.DictReader(io.StringIO(raw.lstrip('\ufeff')), strict=True)
    required = {'symbol', 'quantity', 'average_cost', 'price', 'sector', 'theme', 'as_of'}
    if not reader.fieldnames or len(reader.fieldnames) != len(set(reader.fieldnames)) or not required <= set(reader.fieldnames):
        raise Invalid('CSV headers required: ' + ','.join(sorted(required)))
    if set(reader.fieldnames) - required - {'currency'}:
        raise Invalid('CSV contains unsupported headers.')
    rows, seen = [], set()
    try:
        for line, raw_row in enumerate(reader, 2):
            if line > 1001:
                raise Invalid('Import at most 1000 rows at a time.')
            if None in raw_row or any(v is None for v in raw_row.values()):
                raise Invalid(f'Row {line}: column count does not match headers.')
            try:
                row = position(raw_row)
            except Invalid as exc:
                raise Invalid(f'Row {line}: {exc}') from None
            if row['symbol'] in seen:
                raise Invalid(f"Row {line}: duplicate symbol {row['symbol']}.")
            seen.add(row['symbol'])
            rows.append(row)
    except csv.Error as exc:
        raise Invalid(f'Invalid CSV: {exc}') from None
    if not rows:
        raise Invalid('CSV has no position rows.')
    return rows


DEFAULT_SETTINGS = dict(equity='10000', max_single_pct='10', max_theme_pct='25', max_gross_pct='60',
                        risk_per_trade_pct='0.25', max_age_minutes='60', mode='paper')


def settings(data):
    out = {'equity': str(number(data.get('equity'), 'Paper equity')),
           'max_age_minutes': str(number(data.get('max_age_minutes'), 'Freshness minutes', maximum=Decimal('10080'))),
           'mode': 'paper'}
    for key in ('max_single_pct', 'max_theme_pct', 'max_gross_pct', 'risk_per_trade_pct'):
        out[key] = str(number(data.get(key), key, maximum=Decimal('100')))
    return out


def evidence(data):
    url = text(data.get('url', ''), 'Source URL', 2000, required=False)
    try:
        parsed = urlsplit(url)
    except ValueError:
        raise Invalid('Source URL is malformed.') from None
    if url and (parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password):
        raise Invalid('Source URL must be an http(s) URL without credentials.')
    published = moment(data.get('published_at'), 'Published at')
    observed = moment(data.get('observed_at'), 'Observed at')
    if observed < published:
        raise Invalid('Observed time must be at or after publication.')
    return dict(symbol=symbol(data.get('symbol')), title=text(data.get('title'), 'Evidence title', 200),
                source=text(data.get('source'), 'Source', 120), url=url,
                classification=choice(data.get('classification'), ('primary', 'secondary', 'inference'), 'Classification'),
                verification=choice(data.get('verification'), ('unreviewed', 'reviewed'), 'Review status'),
                summary=text(data.get('summary'), 'Evidence summary'),
                published_at=published.isoformat(), observed_at=observed.isoformat())


def thesis(data):
    ids = data.get('evidence_ids', [])
    if not isinstance(ids, list) or len(ids) > 100 or any(not isinstance(x, str) for x in ids):
        raise Invalid('Evidence IDs must be a list of up to 100 IDs.')
    return dict(symbol=symbol(data.get('symbol')), title=text(data.get('title'), 'Thesis title', 200),
                hypothesis=text(data.get('hypothesis'), 'Hypothesis'),
                invalidation=text(data.get('invalidation'), 'Invalidation conditions'),
                catalyst=text(data.get('catalyst', ''), 'Catalyst', required=False),
                contradiction=text(data.get('contradiction', ''), 'Contradictory evidence', required=False),
                horizon=choice(data.get('horizon'), ('5 days', '20 days'), 'Horizon'),
                status=choice(data.get('status'), ('investigating', 'qualified', 'active', 'under_review', 'invalidated', 'closed'), 'Status'),
                evidence_ids=list(dict.fromkeys(ids)))


def portfolio(positions, config, at=None):
    at = at or now()
    equity = Decimal(config['equity'])
    gross, basis = Decimal(0), Decimal(0)
    themes, sectors, stale, rows = {}, {}, [], []
    single_limit_exceeded = False
    for p in positions:
        value = Decimal(p['quantity']) * Decimal(p['price'])
        cost = Decimal(p['quantity']) * Decimal(p['average_cost'])
        age = max(0, (at - moment(p['as_of'])).total_seconds() / 60)
        is_stale = age > float(config['max_age_minutes'])
        gross += value
        basis += cost
        theme, sector = p['theme'].casefold(), p['sector'].casefold()
        themes[theme] = themes.get(theme, Decimal(0)) + value
        sectors[sector] = sectors.get(sector, Decimal(0)) + value
        single_limit_exceeded |= value / equity * 100 > Decimal(config['max_single_pct'])
        if is_stale:
            stale.append(p['symbol'])
        rows.append({**p, 'value': float(value), 'unrealized_pnl': float(value - cost),
                     'weight_pct': float(value / equity * 100), 'stale': is_stale, 'age_minutes': round(age, 1)})
    flags = []
    if gross / equity * 100 > Decimal(config['max_gross_pct']):
        flags.append('Gross exposure exceeds the paper limit.')
    if single_limit_exceeded:
        flags.append('A single position exceeds the paper limit.')
    if any(v / equity * 100 > Decimal(config['max_theme_pct']) for v in themes.values()):
        flags.append('A theme exceeds the paper limit.')
    if stale:
        flags.append(f'{len(stale)} marked price(s) are stale. New entry acceptance is blocked.')
    return dict(positions=rows, equity=float(equity), gross_value=float(gross), gross_pct=float(gross / equity * 100),
                unrealized_pnl=float(gross - basis), stale_symbols=stale, flags=flags,
                themes=[dict(name=k, value=float(v), weight_pct=float(v / equity * 100)) for k, v in sorted(themes.items(), key=lambda x: -x[1])],
                sectors=[dict(name=k, value=float(v), weight_pct=float(v / equity * 100)) for k, v in sectors.items()])


def assess(data, positions, config):
    proposed = dict(symbol=symbol(data.get('symbol')), quantity=str(number(data.get('quantity'), 'Quantity')),
                    entry=str(number(data.get('entry'), 'Entry')), stop=str(number(data.get('stop'), 'Invalidation price')),
                    theme=text(data.get('theme'), 'Theme', 80), as_of=moment(data.get('as_of'), 'Entry quote as of').isoformat())
    quantity, entry, stop = (Decimal(proposed[k]) for k in ('quantity', 'entry', 'stop'))
    equity = Decimal(config['equity'])
    if stop >= entry:
        raise Invalid('Long-entry invalidation price must be below entry.')
    existing = next((p for p in positions if p['symbol'] == proposed['symbol']), None)
    if existing and existing['theme'].casefold() != proposed['theme'].casefold():
        raise Invalid('Use the existing position theme for this symbol.')
    snapshot = portfolio(positions, config)
    added = quantity * entry
    current_single = Decimal(existing['quantity']) * Decimal(existing['price']) if existing else Decimal(0)
    theme_value = sum((Decimal(p['quantity']) * Decimal(p['price']) for p in positions if p['theme'].casefold() == proposed['theme'].casefold()), Decimal(0))
    metrics = dict(single_pct=(current_single + added) / equity * 100,
                   theme_pct=(theme_value + added) / equity * 100,
                   gross_pct=(sum((Decimal(p['quantity']) * Decimal(p['price']) for p in positions), Decimal(0)) + added) / equity * 100,
                   planned_loss=quantity * (entry - stop),
                   planned_risk_pct=quantity * (entry - stop) / equity * 100, notional=added)
    blocks = list(snapshot['flags'])
    if (now() - moment(proposed['as_of'])).total_seconds() > float(config['max_age_minutes']) * 60:
        blocks.append('Proposed entry quote is stale.')
    for metric, limit, label in [('single_pct', 'max_single_pct', 'Single-name exposure'), ('theme_pct', 'max_theme_pct', 'Theme exposure'), ('gross_pct', 'max_gross_pct', 'Gross exposure'), ('planned_risk_pct', 'risk_per_trade_pct', 'Planned trade loss')]:
        if metrics[metric] > Decimal(config[limit]):
            blocks.append(f'{label} exceeds the configured limit.')
    return dict(proposed=proposed, metrics={k:float(v) for k,v in metrics.items()}, blocks=blocks, passed=not blocks,
                scope='Deterministic paper limits only. No predictive edge, gap-loss guarantee or order authorization.',
                assessed_at=stamp(), execution_enabled=False)
