# NFL Conversion

The separate NFL clone now uses a team-access auction rather than NBA player auctions.

- Data: Madden 2025 offensive player dataset in `public/current_nfl_madden_2025.csv`
- Auction: bid on an NFL offense, then select one remaining player from that team
- Roster: QB, RB, RB, WR, WR, TE, FLEX, FLEX
- Scoring: Standard, Half-PPR, and Full-PPR projection blends derived from offensive Madden attributes
- Team access: up to four auction wins per NFL team

The former NBA source files were deliberately not reused by the NFL client or server.
