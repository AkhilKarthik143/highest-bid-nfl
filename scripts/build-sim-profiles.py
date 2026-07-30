import csv
import json
import math
import os
import statistics
import urllib.request
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MERGED = os.path.join(ROOT, 'public', 'nfl_merged_players.json')
SEASON = os.environ.get('NFL_SEASON', '2025')
URL = f'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{SEASON}.csv'
CACHE = os.path.join(ROOT, 'public', f'stats_player_week_{SEASON}.csv')

NUMERIC = ('attempts', 'passing_yards', 'passing_tds', 'passing_epa', 'carries', 'rushing_yards', 'rushing_tds', 'rushing_epa', 'targets', 'receptions', 'receiving_yards', 'receiving_tds', 'receiving_epa')
MIN_VOLUME = {'QB': 150, 'RB': 75, 'WR_TE': 45}

def num(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0

def download():
    if not os.path.exists(CACHE):
        print(f'Downloading nflverse {SEASON} player stats...')
        urllib.request.urlretrieve(URL, CACHE)
    return CACHE

def percentile_rank(values, value):
    """Inclusive percentile, so the best eligible player receives 100."""
    return 100.0 * sum(candidate <= value for candidate in values) / len(values)

def performance_scores(players, totals):
    """Return EPA scores that value both per-opportunity quality and workload."""
    groups = {
        'QB': ('QB', 'attempts', ('passing_epa',)),
        'RB': ('RB', 'carries', ('rushing_epa',)),
        'WR_TE': (('WR', 'TE'), 'targets', ('receiving_epa',)),
    }
    scores = {}
    for label, (positions, volume_field, epa_fields) in groups.items():
        eligible = []
        for player in players:
            if player.get('position') not in (positions if isinstance(positions, tuple) else (positions,)):
                continue
            total = totals.get(player.get('gsis_id'))
            if not total:
                continue
            volume = total[volume_field]
            if volume < MIN_VOLUME[label]:
                continue
            epa = sum(total[field] for field in epa_fields)
            eligible.append((player.get('gsis_id'), volume, epa))
        if not eligible:
            continue
        rates = [epa / volume for _, volume, epa in eligible]
        epa_totals = [epa for _, _, epa in eligible]
        for pid, volume, epa in eligible:
            rate_pct = percentile_rank(rates, epa / volume)
            total_pct = percentile_rank(epa_totals, epa)
            scores[pid] = {
                'group': label,
                'volume': round(volume),
                'epa_total': round(epa, 3),
                'epa_per_opportunity': round(epa / volume, 3),
                'rate_percentile': round(rate_pct, 1),
                'total_percentile': round(total_pct, 1),
                'score': round(0.4 * rate_pct + 0.6 * total_pct, 1),
            }
    return scores

def main():
    with open(MERGED, encoding='utf-8') as handle:
        merged = json.load(handle)
    totals = defaultdict(lambda: defaultdict(float))
    weekly = defaultdict(lambda: defaultdict(list))
    with open(download(), newline='', encoding='utf-8') as handle:
        for row in csv.DictReader(handle):
            if row.get('season_type') not in ('REG', ''):
                continue
            pid = row.get('player_id')
            if not pid:
                continue
            for field in NUMERIC:
                value = num(row.get(field))
                totals[pid][field] += value
                weekly[pid][field].append(value)

    scores = performance_scores(merged.get('players', []), totals)
    matched = 0
    for player in merged.get('players', []):
        pid = player.get('gsis_id')
        total = totals.get(pid)
        player['performance'] = scores.get(pid)
        if not total:
            continue
        # nflverse player-week rows are one row per player/week; infer games from populated weekly rows.
        games = max(1, max((len(weekly[pid].get(field, [])) for field in NUMERIC), default=1))
        attempts = total['attempts']
        carries = total['carries']
        targets = total['targets']
        player['usage'] = {
            'games': games,
            'attempts_pg': round(attempts / games, 2),
            'carries_pg': round(carries / games, 2),
            'targets_pg': round(targets / games, 2),
            'receptions_pg': round(total['receptions'] / games, 2),
            'pass_yards_pg': round(total['passing_yards'] / games, 2),
            'rush_yards_pg': round(total['rushing_yards'] / games, 2),
            'receiving_yards_pg': round(total['receiving_yards'] / games, 2),
            'ypc': round(total['rushing_yards'] / max(1, carries), 2),
            'ypt': round(total['receiving_yards'] / max(1, targets), 2),
            'td_pg': round((total['passing_tds'] + total['rushing_tds'] + total['receiving_tds']) / games, 2),
            'pass_yards_sd': round(statistics.pstdev(weekly[pid]['passing_yards']), 2),
            'rush_yards_sd': round(statistics.pstdev(weekly[pid]['rushing_yards']), 2),
            'receiving_yards_sd': round(statistics.pstdev(weekly[pid]['receiving_yards']), 2),
        }
        # Players below their position's volume floor intentionally have no score.
        # This prevents a tiny, efficient sample from ranking as an elite season.
        matched += 1
    merged['sim_profile_source'] = f'nflverse stats_player_week_{SEASON}.csv'
    merged['sim_profile_matched'] = matched
    merged['performance_score_method'] = {
        'source': 'nflverse EPA, regular season only',
        'weighting': {'epa_per_opportunity_percentile': 0.4, 'total_epa_percentile': 0.6},
        'minimum_volume': MIN_VOLUME,
    }
    with open(MERGED, 'w', encoding='utf-8') as handle:
        json.dump(merged, handle, indent=2)
        handle.write('\n')
    print(f'Added nflverse usage profiles to {matched} players.')

if __name__ == '__main__':
    main()
