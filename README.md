# Highest Bid — NFL

An offense-only NFL team-access auction game. Managers bid for access to an NFL offense, then immediately select one remaining QB, RB, WR, or TE from that team.

## Rules

- 2–4 same-device managers, each with a $100 default budget
- A team can return to the auction up to four times
- A winner selects exactly one player from the won team
- Eight starters: `QB / RB / RB / WR / WR / TE / FLEX / FLEX`
- FLEX accepts RB, WR, or TE
- No bench, defense, kicker, trades, or duplicate players
- The winner is the manager with the highest average OVR across legal starters

Player ratings and portraits come from `public/current_nfl_madden_26.csv`, normalized for the game in `public/current_nfl_madden_26_normalized.csv`. Sleeper supplies current player identity/team/position context; Madden 26 supplies the OVR layer.

`public/nfl_player_crosswalk.json` permanently maps local Madden 26 records to Sleeper player IDs, current team, and position. Regenerate it sparingly with `npm run build:crosswalk`.

## Run locally

```powershell
cd C:\Users\Akhil\Downloads\nfl-auction-draft
npm install
npm start
```

Open `http://localhost:3000`. If that port is already used, stop the other local server or run `$env:PORT=3001; npm start` in PowerShell and open `http://localhost:3001`.

## Current scope

Same Computer is the fully playable game mode. The server has a clean NFL-only static service and room-presence foundation, but online bidding is intentionally not exposed yet: it must be converted to server-authoritative NFL team-access actions before it is safe to use across devices.

## Project structure

- `public/index.html` — entry point
- `public/nfl.js` — CSV parsing, team grouping, auction state, lineup eligibility, optimizer, and results
- `public/nfl.css` — responsive UI
- `public/current_nfl_madden_2025.csv` — 2025 Madden player source
- `server.js` — Express, Socket.IO room presence, and static hosting
