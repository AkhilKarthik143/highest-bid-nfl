/* Builds a durable Sleeper-to-Madden mapping without putting Sleeper calls in the draft loop. */
const fs = require('fs/promises');
const path = require('path');

const root = path.resolve(__dirname, '..');
const csvPath = path.join(root, 'public', 'current_nfl_madden_26_normalized.csv');
const outputPath = path.join(root, 'public', 'nfl_player_crosswalk.json');
const mergedOutputPath = path.join(root, 'public', 'nfl_merged_players.json');
const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function parseCsv(text) {
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) { const char = text[i];
    if (char === '"') { if (quoted && text[i + 1] === '"') { value += char; i++; } else quoted = !quoted; }
    else if (char === ',' && !quoted) { row.push(value); value = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && text[i + 1] === '\n') i++; row.push(value); value = ''; if (row.some(Boolean)) rows.push(row); row = []; }
    else value += char;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  const [headers = [], ...body] = rows;
  return body.map(values => Object.fromEntries(headers.map((header, index) => [header.trim(), (values[index] || '').trim()])));
}

async function main() {
  const [csv, response] = await Promise.all([fs.readFile(csvPath, 'utf8'), fetch('https://api.sleeper.app/v1/players/nfl')]);
  if (!response.ok) throw new Error(`Sleeper returned ${response.status}`);
  const sleeperByKey = new Map(Object.values(await response.json())
    .filter(player => player.team && ['QB', 'RB', 'WR', 'TE'].includes(player.position))
    .map(player => [`${normalize(player.full_name || `${player.first_name || ''}${player.last_name || ''}`)}:${player.position}`, player]));
  const rows = parseCsv(csv).filter(row => row.high_pos_group === 'off' && ['QB', 'RB', 'WR', 'TE'].includes(row.position));
  const merged = rows.map(row => {
    const player = sleeperByKey.get(`${normalize(row.fullname)}:${row.position}`);
    return {
      sleeper_player_id: player?.player_id || null,
      madden_player_id: row.madden_id || row.player_id,
      gsis_id: row.player_id,
      name: row.fullname,
      team: player?.team || row.team,
      position: player?.position || row.position,
      madden_ovr: Number(row.overallrating) || null,
      source: 'madden_26',
      match_status: player ? 'matched' : 'unmatched',
      player_id: row.player_id,
      madden_id: row.madden_id || '',
      fullname: row.fullname,
      team: player?.team || row.team,
      position: player?.position || row.position,
      overallrating: Number(row.overallrating) || null,
      game_rating: Number(row.game_rating) || Number(row.overallrating) || null,
      pass_rating: Number(row.pass_rating) || null,
      rush_rating: Number(row.rush_rating) || null,
      receive_rating: Number(row.receive_rating) || null,
      block_rating: Number(row.block_rating) || null,
      headshot: row.headshot || '',
      high_pos_group: 'off',
      fantasy_positions: player?.fantasy_positions || [row.position],
      sleeper_status: player?.status || null,
      sleeper_rank: player?.search_rank || null,
      sleeper_depth: player?.depth_chart_order || null
    };
  });
  const crosswalk = merged.map(({ sleeper_player_id, madden_player_id, gsis_id, name, team, position, madden_ovr, source, match_status }) => ({ sleeper_player_id, madden_player_id, gsis_id, name, team, position, madden_ovr, source, match_status }));
  const meta = { generated_at: new Date().toISOString(), source: 'Sleeper player map + Madden 26 CSV' };
  await Promise.all([
    fs.writeFile(outputPath, `${JSON.stringify({ ...meta, players: crosswalk }, null, 2)}\n`),
    fs.writeFile(mergedOutputPath, `${JSON.stringify({ ...meta, players: merged }, null, 2)}\n`)
  ]);
  console.log(`Wrote ${crosswalk.length} crosswalk rows and merged player data.`);
}

main().catch(error => { console.error(error); process.exit(1); });
