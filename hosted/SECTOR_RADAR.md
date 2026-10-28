# Sector radar: current implementation

The private app offers current-US-session and next-2–5-session research outlooks across eleven sector ETF proxies. A positive outlook needs three evidence families: overall market confirmation, sector confirmation, and a reviewed material economic catalyst. Source links, observation times and interpretations are displayed separately. Rules are uncalibrated and have no demonstrated predictive edge.

Intraday inputs require current SPY, QQQ, RSP, IWM and all eleven sector quotes. Broad support requires SPY at least +0.25%, nonnegative QQQ/RSP, IWM at least -0.25%, and at least seven advancing sector proxies. A selected sector must rise and exceed SPY by at least 0.2 percentage points. Quotes have a 15-minute age limit and a five-minute inter-quote skew limit. Thresholds are research defaults requiring forward validation.

The few-day horizon uses synchronized completed daily histories, supportive market direction and sector participation, a positive three-session sector return, at least 0.5 percentage points of three-session outperformance, and a close above its twenty-session average. After-hours prices never become an intraday call. Missing holiday sessions conservatively withhold a call when the expected weekday and returned data disagree.

Both horizons require a supportive owner review within 24 hours covering policy/liquidity, rates, inflation/jobs/growth surprises, major earnings/guidance, oil/dollar/geopolitics and credit/volatility. A sector catalyst needs the observed fact, economic mechanism, original source, publication/observation times, expiry, review and an underlying event ID. Repeat coverage is deduplicated; a material adverse catalyst vetoes the positive interpretation. Catalysts expire after 72 hours or their earlier explicit expiry.

Known high-impact events within 24 hours keep outlooks on watch. Initial calendar records cover the remaining October and December 2026 FOMC decision dates and link to the official Federal Reserve calendar. Date-only events are treated conservatively as all-day risks. This is not an exhaustive event calendar.

Macro/news reviews and material catalyst extraction are currently owner-supplied. Automated news research, continuous calendar ingestion, calibration and push alerts are not connected. Price-only confluence cannot invent the third factual reason.

## Data connection

Use Connect market feed inside the private HTTPS site. The Alpha Vantage plan must include Realtime US Market Data; a premium request allowance alone does not establish entitlement. API keys are encrypted with AES-GCM, random per-record nonces and owner-bound authenticated data. The master encryption key is stored only as a hosted runtime secret. Neither key is written to GitHub or browser storage; responses do not return the saved credential.

One bulk request obtains up to 21 ETF quotes. Adjusted daily histories for four market proxies and eleven sectors are cached. Refresh has a shared five-minute per-owner lease and history requests run at most three at a time. Requests have bounded timeouts. No automated schedule or notification was created.

The provider's demo response explicitly contains artificial data and is rejected. Errors, incomplete coverage, stale quotes and missing entitlements lead to visible abstention. Provider timestamps without offsets are interpreted as New York exchange time and checked for date/age.

TLT is a duration ETF proxy, not a measured Treasury yield. VIXY is a volatility-futures ETF, not spot VIX. HYG relative to IEF is not a measured credit spread. These limitations are visible in the product.

## Validation

Run the domain and sector-radar Node suites, TypeScript checking and the UI workflow suite. The canonical parent repository supplies jsdom for the latter. All test observations are explicitly synthetic and are never served as live data.

Sources: https://www.alphavantage.co/documentation/ and https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm .


## Managed key and daily-only fallback

A key supplied to the app owner can be configured as the secret runtime variable ALPHA_VANTAGE_API_KEY. It is never exposed by API responses. The signed-in owner does not need to re-enter it in the form. Opening the workspace refreshes the cached feed when the five-minute lease allows.

If realtime access returns an entitlement error, demonstration payload or unsupported response, all realtime quotes are discarded. Genuine adjusted daily history can still power the multi-day research path. Daily closes never fill intraday quote slots. A response with neither usable SPY history nor an actual SPY quote is rejected. Macro reviews and material catalysts remain required.

## Daily sector rotation

The primary sector view now ranks observed ETF proxy performance independently of trade qualification. All eleven sectors remain visible. Select daily, 5-session or 20-session return; rank 1 is the highest available return, with equal observations sharing a rank. Each row shows the three return horizons, selected-period excess return versus SPY, position relative to the 20-session adjusted-close average, and completed-daily rank movement when both sessions have full comparable coverage. A leader can still be falling and a laggard can still be rising.

The daily ranking uses fresh, synchronized SPY and all eleven sector quotes during regular US hours. Otherwise it uses one dated completed-session basis anchored to the latest available SPY history; missing or mismatched sector histories are unranked rather than mixed across dates. Older cached history remains visible with a stale warning after provider failures. Multi-session comparisons require matching observation dates. Macro reviews, catalysts and imminent events do not hide these observations; existing bullish qualification remains available in a separate expandable section. No forecast probability is implied. Rankings update when the app refreshes; this does not add background scheduling or automated news coverage.
