# Game data layout

The running game uses only these files:

- `public/current_nba_players.csv` — active player ratings and positions.
- `public/archive/nba_player_stats_2026.csv` — season totals used to calculate the player-card PPG, RPG, APG, SPG, BPG, and FG%.

`public/archive/` also contains older prototypes, notebooks, Python experiments, and large training data such as `machine_learning.csv`. Those files are reference material only and are not sent to the browser by the game.

Keep new active player data in one of the two live files above. This prevents duplicate CSVs and makes the project portable.
