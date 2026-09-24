"""Groups events for the dashboard's category filter.

The CU Boulder scraper files every campus talk under one category ('Nature & Science'; 'Science & Earth' before
2026-09-22), which leaves the filter with a single giant bucket. Those events, recognized by the scraper's
Contributor value rather than the category it shares with off-campus events, are split by field here, from the
title first and the building second. Every other event keeps its category.
"""
import re

SPLIT_CATEGORY = 'Science & Earth'  # rows filed before the scraper moved to the ledger's allowed categories
CU_CONTRIBUTOR = 'LeviAgent (CU Boulder Scraper)'
OTHER_CAMPUS = 'Campus & Outreach'

# Order matters: the first matching field wins. Earth's strong terms sit above Chemistry so 'Atmospheric
# Chemistry' lands with Earth, Engineering sits above Chemistry so 'Chemical and Biological Engineering' lands
# with Engineering, and Life sits above Physics & Math so 'Mathematical Biology' does too.
_FIELDS = [
    ('Earth & Climate', r'geograph|earth|climate|atmospher|geo(?:log|chem|phys|morph)|\benvs\b|glaci|hydro|ocean|cryosphere|polar|arctic|remote sensing|hyperspectral|planetar|cires|holocene'),
    ('Engineering & Computing', r'engineering|\bnlp\b|comput(?:er|ing)|machine learning|robot|data science|software|\bai\b|cybersecurity'),
    ('Chemistry', r'chemi|biochem'),
    ('Life & Health', r'\biphy\b|biolog|neuro|health|physiolog|psycholog|behavio|medic|ecolog|evolution|genetic|circadian|nutrition|inaturalist|bioblitz|creature|cellular|stem cell|hipsc|biotech'),
    ('Physics & Math', r'physics|\bjila\b|quantum|astro|mathemat|\bmath\b|nonlinear|dynamical|statistic|optic|laser|atomic|gravit|\bcubit\b'),
    ('Earth & Climate', r'environment|sustainab|water|snow|\bseec\b|energy'),
]
_VENUE_FIELDS = [
    ('Earth & Climate', r'benson earth|guggenheim|sustainability, energy'),
    ('Physics & Math', r'\bjila\b|duane|gamow'),
    ('Life & Health', r'ramaley|muenzinger|behavioral science|integrative physiology'),
    ('Chemistry', r'cristol|ekeley'),
    ('Engineering & Computing', r'engineering center|eccr|ecot|computer science'),
]


def _first(rules, text):
    for name, pattern in rules:
        if re.search(pattern, text):
            return name
    return None


def event_group(category, name, venue, contributor=''):
    if category != SPLIT_CATEGORY and not (contributor or '').startswith(CU_CONTRIBUTOR):
        return category or 'Other'
    return (_first(_FIELDS, (name or '').lower())
            or _first(_VENUE_FIELDS, (venue or '').lower())
            or OTHER_CAMPUS)
