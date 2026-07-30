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

    matched = 0
    for player in merged.get('players', []):
        pid = player.get('gsis_id')
        total = totals.get(pid)
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
        matched += 1
    merged['sim_profile_source'] = f'nflverse stats_player_week_{SEASON}.csv'
    merged['sim_profile_matched'] = matched
    with open(MERGED, 'w', encoding='utf-8') as handle:
        json.dump(merged, handle, indent=2)
        handle.write('\n')
    print(f'Added nflverse usage profiles to {matched} players.')

if __name__ == '__main__':
    main()
