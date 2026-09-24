"""Tags food deals for the dashboard's filters: how you can get the deal, and what kind of food it is.

The sheet has no column for either, so both are read from the row's text. The result is a best guess:
a deal only gets a service tag when its own text (or the sheet's verification note) says so, and a
happy-hour deal with no other evidence is assumed to be dine-in because that is how happy hours work.
"""
import re

# Service tags, in display order. 'app' means an app, promo code, loyalty or reward account is needed.
SERVICES = ('dine-in', 'pickup', 'delivery', 'app')

_PATTERNS = {
    'dine-in': r'dine[- ]?in|in[- ]house|bar only|at tables|at the bar|table service',
    'pickup': r'pick[- ]?up|take[- ]?out|carry[- ]?out|to[- ]go|order ahead',
    'delivery': r'uber ?eats|door ?dash|grubhub|delivery',
    'app': r'\bapp\b|\bcode\b|rewards|loyalty|kiosk|sign ?up|\bmembers?\b',
}
_NEG_BEFORE = re.compile(r"(?:\bnot|\bno|isn't|\bexcluded?|\bexcept|\bwithout|\bunverified)\b[^.;]{0,40}$")
# The sheet's notes say "special-price pickup is not confirmed" or "treat it as dine-in unless..." when the
# promo price may not apply to takeout. A sentence like that is doubt about pickup, not evidence of it.
_DOUBT = re.compile(
    r"not (?:explicitly |currently |yet |individually )?(?:confirmed|shown|advertised|stated|published|guaranteed?|exposed|verified|eligible|available|listed|applicable)"
    r"|unconfirmed|unverified|treat (?:it |this |the [a-z ]+ )?as dine-in|does not (?:explicitly )?(?:state|advertise|guarantee|publish|list|expose|mention)"
    r"|exists generally|supports [a-z-]+ generally|generally (?:exists|available)|is not offered|no online ordering"
    r"|confirm [^.;]* (?:in cart|before|with staff)|\bunless\b"
)
_PICKUP_CONFIRMED = re.compile(
    r"(?:first-party|direct|current|live|official)[^.;]{0,60}(?:pick[- ]?up|to-go|take[- ]?out|online ordering)"
    r"|pickup[- ]enabled|supports (?:pick|to-go|take)|explicitly supports"
)
_DINE_ONLY = re.compile(r"(?:dine[- ]?in|in[- ]house|bar)\W+only|exclusively (?:in[- ]house|dine)")


def _has(pattern, text):
    """True if `pattern` occurs where a nearby negation ("not valid through delivery") does not cancel it."""
    for m in re.finditer(pattern, text):
        if not _NEG_BEFORE.search(text[max(0, m.start() - 48):m.start()]):
            return True
    return False


def _sentences(text):
    return [s for s in re.split(r'(?<=[.;])\s+|\s+[–—]\s+', text.lower()) if s.strip()]


def food_services(deal, price='', valid='', verification='', notes=''):
    """Which of SERVICES the deal supports.

    The deal, price and validity text say what the promo is, so they decide on their own. The verification and
    notes are looser prose, read a sentence at a time: a sentence that mentions pickup or delivery only counts
    when it is not expressing doubt, and a doubtful pickup sentence means the promo is dine-in.
    """
    deal, price, valid, verification, notes = (str(x or '') for x in (deal, price, valid, verification, notes))
    promo = ' '.join((deal, price, valid)).lower()
    found = {name for name, pat in _PATTERNS.items() if _has(pat, promo)}
    doubtful_pickup = False
    for sent in _sentences(' '.join((verification, notes))):
        if _has(_PATTERNS['pickup'], sent) or 'online ordering' in sent:
            if _DOUBT.search(sent):
                doubtful_pickup = True
            elif _PICKUP_CONFIRMED.search(sent):
                found.add('pickup')
        if _has(_PATTERNS['delivery'], sent) and re.search(r'\bvalid\b|available|offers?|exposes|lists', sent) and not _DOUBT.search(sent):
            found.add('delivery')
    if _DINE_ONLY.search(promo):
        found -= {'pickup', 'delivery'}
        found.add('dine-in')
    elif doubtful_pickup and 'pickup' not in found:
        found.add('dine-in')
    if not found and re.search(r'happy hour|social hour|hora loca', promo):
        found.add('dine-in')
    return [s for s in SERVICES if s in found]


# Order matters: the first matching type wins. Shareables lead so "50% off shareables incl. a burger" is not a
# burger deal, Burgers sit above Chicken so a "chicken burger" is a burger, and Mexican sits above Seafood so
# shrimp and fish tacos are tacos.
_TYPES = [
    ('Shareables & apps', r'appetizer|shareable|small plate|charcuterie|pretzel'),
    ('Burgers', r'burger|slider|patty melt|smash'),
    ('Pizza', r'pizza|flatbread|calzone|\bslices?\b|stromboli|margherita'),
    ('Asian', r'sushi|ramen|udon|\bpho\b|dumpling|potsticker|gyoza|curry|masala|\bpoke\b|\bbao\b|pad thai|fried rice|bibimbap|banh mi|kimchi|naan|momo|adobo'),
    ('Pasta & entrées', r'pasta|spaghetti|cacio|lasagna|ravioli|gnocchi|parmesan|shepherd|bangers|meat pie|pot pie|cheesesteak|steak dinner|ribeye|meatloaf|pork chop|schnitzel'),
    ('Mexican', r'taco|burrito|nacho|quesadilla|pozole|carne asada|enchilada|birria|tamale|torta|fajita|chile relleno|elote'),
    ('Seafood', r'mussel|mollusk|oyster|shrimp|pollock|fish|lobster|crab|seafood|clam|salmon|tilapia'),
    ('Chicken & wings', r'\bwings?\b|chicken (?:tender|sandwich|shack|nugget)|nugg|popcorn chicken|tenders|fried chicken|hot chicken'),
    ('BBQ', r'bbq|barbecue|brisket|pulled pork|\bribs\b|smoked'),
    ('Sandwiches & salads', r'sandwich|\bsubs?\b|grilled cheese|hoagie|panini|salad|\bwrap\b|bowl|hot dog|reuben|gyro'),
    ('Breakfast', r'breakfast|brunch|pancake|waffle|\begg|omelet|bagel'),
    ('Sweets & drinks', r'ice cream|sundae|smoothie|donut|doughnut|cookie|\bcake\b|milkshake|coffee|latte|boba|frozen|dessert|soda|margarita|cocktail'),
]


# --- When a deal runs -------------------------------------------------------------------------------------------
# The sheet says when a deal runs only in prose ("Recurring Tuesday–Friday, 3–6 p.m.; current first-party page
# verified Sep. 9"), so the schedule is read from it here and the page shows the deal only when it applies. The
# snapshot clips that text, which is why this runs on the full sheet text rather than in the browser.

_MONTHS = {m: i for i, m in enumerate(('jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'), 1)}
_DAY_NAMES = (('monday', 'mon'), ('tuesday', 'tues', 'tue'), ('wednesday', 'wed'), ('thursday', 'thurs', 'thur', 'thu'),
              ('friday', 'fri'), ('saturday', 'sat'), ('sunday', 'sun'))
_DAY_OF = {name: i for i, names in enumerate(_DAY_NAMES) for name in names}
_DAY = r'\b(?:%s)s?\b' % '|'.join(sorted(_DAY_OF, key=len, reverse=True))
_DASH = r'\s*(?:-|–|—|to|through|thru)\s*'
_MONTH = r'\b(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?'
_DATE = _MONTH + r'\s+(\d{1,2})(?:,?\s*(\d{4}))?'
_CLOCK = r'(?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?|noon|midnight|opening|open|close)'
# The validity text runs on from the schedule into how and when the row was checked. Everything from the first of
# these words to the end of its clause is about the check ("explicitly lists Thursday Sep. 10"), not the schedule.
_NOISE = re.compile(r'\b(?:current(?:ly)?|verified|rechecked|reverified|official|first-party|sources?|as of|listings?|'
                    r'corroborat\w*|published|confirm\w*|indexing|specifically|explicitly|qualifying)\b')
# ("qualifying" starts the trigger of a conditional deal: "redeem Monday–Wednesday after a qualifying Friday–Sunday game".)
_ALL_DAYS = frozenset(range(7))


def _day_set(text):
    """The weekdays one day phrase names: "Monday", "Tue–Fri" (wrapping past Sunday), "weekdays", "daily"."""
    text = text.strip()
    if re.fullmatch(r'daily|every day|nightly|every night', text):
        return set(_ALL_DAYS)
    if text.startswith('weekday'):
        return set(range(5))
    if text.startswith('weekend'):
        return {5, 6}
    ends = [_DAY_OF[m.group(1)] for m in re.finditer(r'(%s)s?\b' % '|'.join(sorted(_DAY_OF, key=len, reverse=True)), text)]
    if len(ends) == 2 and re.search(_DASH, text):
        a, b = ends
        return {(a + i) % 7 for i in range((b - a) % 7 + 1)}
    return set(ends)


def _minutes(clock, meridiem_hint=None):
    """Minutes after midnight for "3", "5:30 p.m.", "noon"; None for an open end ("close"). "opening" is 0."""
    clock = clock.strip()
    if clock in ('close',):
        return None
    if clock in ('opening', 'open'):
        return 0
    if clock == 'noon':
        return 12 * 60
    if clock == 'midnight':
        return 24 * 60
    m = re.match(r'(\d{1,2})(?::(\d{2}))?\s*(a|p)?', clock)
    hour, minute, mer = int(m.group(1)), int(m.group(2) or 0), m.group(3) or meridiem_hint
    if mer == 'p' and hour < 12:
        hour += 12
    if mer == 'a' and hour == 12:
        hour = 0
    return hour * 60 + minute


def _meridiem(clock):
    m = re.search(r'\d\s*(a|p)\.?m', clock)
    return m.group(1) if m else ('p' if clock in ('noon', 'midnight') else None)


def _window(start, end):
    """(start, end) minutes of a time range; end is None when it runs to close, or past midnight."""
    end_meridiem = _meridiem(end)
    s = _minutes(start, end_meridiem)
    e = _minutes(end, end_meridiem)
    if s is None:
        s = 0
    if e is None:
        return s, None
    if e <= s and end_meridiem is None:
        e += 12 * 60  # "11-2" without a.m./p.m. means 11 a.m. to 2 p.m.
    return s, (e if e > s else None)  # "9 p.m.–1 a.m." runs past midnight, so nothing ends it today


def _dates(text, year):
    """(from, until) ISO dates the text names: "through Sep. 27", "Sept 21-27, 2026", "Sep. 8–Oct. 14"."""
    def iso(month, day, yr):
        return '%04d-%02d-%02d' % (int(yr or year), _MONTHS[month[:3]], int(day))
    m = re.search(r'(%s)\s+(\d{1,2})%s(?:(%s)\s+)?(\d{1,2})(?!:)(?:,?\s*(\d{4}))?' % (_MONTH, _DASH, _MONTH), text)
    if m:
        first_month, first_day, second_month, second_day, yr = m.groups()
        return iso(first_month, first_day, yr), iso(second_month or first_month, second_day, yr)
    m = re.search(r'\b(?:through|thru|until|ends?)\s+(%s)\s+(\d{1,2})(?:,?\s*(\d{4}))?' % _MONTH, text)
    if m:
        return None, iso(*m.groups())
    return None, None


def _schedule_text(valid):
    """The part of the validity text that is schedule: each clause up to its first word about checking the row."""
    kept = []
    for clause in re.split(r';|\(|\)', valid.lower()):
        noise = _NOISE.search(clause)
        kept.append(clause[:noise.start()] if noise else clause)
    return [c for c in kept if c.strip()]


def deal_schedule(deal, valid, year):
    """When a deal applies, for the page to check against the clock in Denver.

    Returns {} for a deal with no stated schedule, else any of: 'days' (weekdays it runs, 0 = Monday; left out when it
    runs every day), 'hours' ({weekday: [[start, end], ...]} in minutes of the day, end null for "to close"; a day
    left out runs all day) and 'from' / 'until' (ISO dates). Days come from the validity text; the deal text is only
    consulted for "Taco Tuesday", since it also carries phrases like "refreshes weekly on Saturday" that are not when the deal runs.
    """
    deal, valid = str(deal or '').lower(), str(valid or '')
    clauses = _schedule_text(valid)
    start, until = _dates(' '.join(clauses), year)
    token = re.compile(r'(?P<days>%s(?:%s%s)?|weekdays?|weekends?|daily|every day|nightly|every night)'
                       r'|(?P<allday>all[- ]day|open to close)'
                       r'|(?P<after>after\s+%s)|(?P<until>until\s+%s)'
                       r'|(?P<range>%s%s%s)' % (_DAY, _DASH, _DAY, _CLOCK, _CLOCK, _CLOCK, _DASH, _CLOCK))
    windows = {}  # weekday -> list of (start, end) minutes; end None = runs to close
    mentioned = set()
    last_days = None
    for clause in clauses:
        # A weekday right before a date is one dated occurrence ("Friday Aug. 28"), and dates are not times.
        clause = re.sub(_DAY + r',?\s+' + _DATE, ' ', clause)
        clause = re.sub(_DATE + '(?:' + _DASH + '(?:' + _MONTH + r'\s+)?\d{1,2}(?:,?\s*\d{4})?)?', ' ', clause)
        tokens = []
        for m in token.finditer(clause):
            if m.group('days'):
                tokens.append(('days', _day_set(m.group('days'))))
            elif m.group('allday'):
                tokens.append(('time', (0, None)))
            elif m.group('after'):
                tokens.append(('time', (_minutes(m.group('after')[5:].strip(), _meridiem(m.group('after'))), None)))
            elif m.group('until'):
                tokens.append(('time', (0, _minutes(m.group('until')[5:].strip(), _meridiem(m.group('until'))))))
            else:
                a, b = re.split(_DASH, m.group('range'), maxsplit=1)
                tokens.append(('time', _window(a, b)))
        # "all day Monday", "until 3 p.m. Tuesday-Friday": a time that leads its clause belongs to the days after it.
        if tokens and tokens[0][0] == 'time' and any(kind == 'days' for kind, _ in tokens):
            first_days = next(i for i, (kind, _) in enumerate(tokens) if kind == 'days')
            tokens = tokens[first_days:first_days + 1] + tokens[:first_days] + tokens[first_days + 1:]
        pending = None  # days named since the last time, still waiting for one
        for kind, value in tokens:
            if kind == 'days':
                mentioned |= value
                pending = (pending | value) if pending is not None else value
            else:
                target = pending if pending is not None else (last_days if last_days is not None else _ALL_DAYS)
                for d in target:
                    windows.setdefault(d, []).append(value)
                last_days, pending = target, None
        if pending is not None:
            last_days = pending  # "Recurring daily; happy hour 3–5 p.m.": the next clause's times are for these days
    if not mentioned and re.search(r'\btaco tuesdays?\b', deal):
        mentioned = {1}
    out = {}
    if mentioned and mentioned != _ALL_DAYS:
        out['days'] = sorted(mentioned)
    runs_on = mentioned or _ALL_DAYS
    # A day with an all-day window, or with no times at all, runs all day and is left out.
    hours = {str(d): sorted({tuple(w) for w in ws}, key=lambda w: (w[0], 9999 if w[1] is None else w[1])) for d, ws in sorted(windows.items()) if d in runs_on and (0, None) not in ws}
    if hours:
        out['hours'] = {d: [list(w) for w in ws] for d, ws in hours.items()}
    if start:
        out['from'] = start
    if until:
        out['until'] = until
    return out


def food_type(deal, restaurant=''):
    """A coarse food type for the filter, from the deal text (falling back to the restaurant name)."""
    text = (deal or '').lower()
    for name, pat in _TYPES:
        if re.search(pat, text):
            return name
    name_text = (restaurant or '').lower()
    for name, pat in _TYPES[:2]:
        if re.search(pat, name_text):
            return name
    return 'Other'
