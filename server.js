const path = require('path');
const fs = require('fs/promises');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const rooms = new Map();
const SLOTS = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX1', 'FLEX2'];
const ELIGIBLE = { QB: ['QB'], RB: ['RB1', 'RB2', 'FLEX1', 'FLEX2'], WR: ['WR1', 'WR2', 'FLEX1', 'FLEX2'], TE: ['TE', 'FLEX1', 'FLEX2'] };
const TEAM_PICK_CAP = 4;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/health', (req, res) => res.json({ game: 'highest-bid-nfl', status: 'ok' }));

let sleeperCache = { updatedAt: 0, data: null, pending: null };
async function sleeperPlayers() {
  const oneDay = 86_400_000;
  if (sleeperCache.data && Date.now() - sleeperCache.updatedAt < oneDay) return sleeperCache.data;
  sleeperCache.pending ||= fetch('https://api.sleeper.app/v1/players/nfl')
    .then(response => { if (!response.ok) throw new Error(`Sleeper returned ${response.status}`); return response.json(); })
    .then(data => { sleeperCache = { updatedAt: Date.now(), data, pending: null }; return data; })
    .catch(error => { sleeperCache.pending = null; throw error; });
  return sleeperCache.pending;
}
app.get('/api/sleeper/players', async (req, res) => {
  try { res.set('Cache-Control', 'public, max-age=3600').json(await sleeperPlayers()); }
  catch { res.status(502).json({ error: 'Sleeper player data is unavailable right now.' }); }
});

const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const parseCsv = text => {
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
};
const teamValue = players => players.slice().sort((a, b) => b.value - a.value).slice(0, 6).reduce((total, player, index) => total + player.value * ([1, .62, .38, .2, .1, .05][index] || 0), 0);
const sleeperScore = player => {
  if (player.performance?.score) return number(player.performance.score);
  if (number(player.sleeper_overall)) return number(player.sleeper_overall);
  const rank = number(player.search_rank), depth = number(player.depth_chart_order) || 4;
  return Math.round((rank ? clamp(100 - Math.sqrt(rank) * 2.5, 40, 100) : 70) * .7 + clamp(100 - (Math.max(1, depth) - 1) * 10, 50, 100) * .3);
};
let catalogCache = { updatedAt: 0, teams: null, pending: null };
async function nflCatalog() {
  if (catalogCache.teams && Date.now() - catalogCache.updatedAt < 86_400_000) return catalogCache.teams;
  if (catalogCache.pending) return catalogCache.pending;
  catalogCache.pending = fs.readFile(path.join(__dirname, 'public', 'nfl_merged_players.json'), 'utf8')
    .then(JSON.parse)
    .then(async merged => {
      let rows = merged.players || [];
      try {
        const sleeper = Object.values(await sleeperPlayers()).filter(player => player && player.team && player.active !== false && ELIGIBLE[player.position]);
        const byId = new Map(rows.filter(row => row.sleeper_player_id).map(row => [String(row.sleeper_player_id), row]));
        const byNamePos = new Map(rows.map(row => [`${normalize(row.fullname)}:${row.position}`, row]));
        rows = sleeper.map(player => {
          const match = byId.get(String(player.player_id)) || byNamePos.get(`${normalize(player.full_name || `${player.first_name || ''}${player.last_name || ''}`)}:${player.position}`);
          if (!match) return null;
          return { ...match, player_id: String(player.player_id), fullname: player.full_name || match.fullname, team: player.team, position: player.position, sleeper_status: player.status || null, sleeper_depth: player.depth_chart_order || null, sleeper_rank: player.search_rank || null };
        }).filter(Boolean);
      } catch (error) { console.warn('Sleeper refresh failed; using cached merged NFL data.', error.message); }
      const teams = new Map();
      rows.forEach(row => {
        const pos = row.position;
        const team = row.team;
        const maddenOvr = number(row.overallrating), ovr = number(row.true_overall) || number(row.sleeper_overall) || maddenOvr, gameRating = number(row.game_rating) || maddenOvr;
        const depth = number(row.sleeper_depth);
        if (row.high_pos_group !== 'off' || !ELIGIBLE[pos] || ovr < 60 || !team || (depth && (['RB', 'WR'].includes(pos) ? depth > 2 : depth > 1))) return;
        const context = sleeperScore(row);
        const player = { id: row.player_id, name: row.fullname, team, pos, ovr, maddenOvr, gameRating, passRating: number(row.pass_rating), rushRating: number(row.rush_rating), receiveRating: number(row.receive_rating), blockRating: number(row.block_rating), sleeperScore: context, performanceScore: row.performance?.score ?? null, injuryStatus: row.sleeper_injury_status || null, status: row.sleeper_status || null, value: Math.round((gameRating * .65 + context * .35) * 10) / 10, eligible: ELIGIBLE[pos], headshot: (row.headshot || '').replace('{formatInstructions}', 'w_96,c_fill') };
        if (!teams.has(team)) teams.set(team, []); teams.get(team).push(player);
      });
      return [...teams.entries()].map(([id, players]) => { players.sort((a, b) => b.value - a.value); const originalValue = teamValue(players); return { id, name: id, players, originalValue, currentValue: originalValue, picksTaken: 0, retired: false }; }).filter(team => team.players.length >= 3);
    });
  catalogCache.pending.then(teams => { catalogCache = { updatedAt: Date.now(), teams, pending: null }; }).catch(() => { catalogCache.pending = null; });
  return catalogCache.pending;
}
const clone = value => JSON.parse(JSON.stringify(value));
const publicRoom = room => ({ code: room.code, host: room.host, phase: room.draft.started ? room.draft.phase : 'lobby', settings: room.settings, players: room.players, draft: room.draft });
const broadcast = room => io.to(room.code).emit('room:state', publicRoom(room));
const roomFor = socket => [...rooms.values()].find(room => room.players.some(player => player.id === socket.id));
const maxBid = player => Math.max(0, player.budget - (SLOTS.length - player.roster.length - 1));
const options = room => room.draft.teams.filter(team => !team.retired && team.players.length);
function pickTeam(room) {
  const choices = options(room); if (!choices.length) { room.draft.phase = 'lineup'; return; }
  const weighted = choices.map(team => ({ team, weight: Math.max(1, team.currentValue * (room.draft.recent[0] === team.id ? .45 : room.draft.recent.includes(team.id) ? .72 : 1)) }));
  let roll = Math.random() * weighted.reduce((sum, item) => sum + item.weight, 0), running = 0;
  room.draft.currentTeam = (weighted.find(item => (running += item.weight) >= roll) || weighted[0]).team;
  room.draft.currentTeam.timesAuctioned = (room.draft.currentTeam.timesAuctioned || 0) + 1;
  room.draft.recent = [room.draft.currentTeam.id, ...room.draft.recent.filter(id => id !== room.draft.currentTeam.id)].slice(0, 6);
  room.draft.highestBid = 0; room.draft.highestBidder = null; room.draft.folded = []; room.draft.round++;
  const eligiblePlayers = room.players.filter(player => player.roster.length < SLOTS.length);
  room.draft.activeBidderId = eligiblePlayers.length ? eligiblePlayers[(room.draft.round - 1) % eligiblePlayers.length].id : null;
  room.draft.phase = 'auction';
}
function activeManagers(room) { return room.players.filter(player => player.roster.length < SLOTS.length && !room.draft.folded.includes(player.id)); }
function advanceBidder(room) {
  const active = activeManagers(room);
  if (!active.length) return null;
  const currentIndex = active.findIndex(player => player.id === room.draft.activeBidderId);
  const next = active[(currentIndex + 1 + active.length) % active.length];
  room.draft.activeBidderId = next.id;
  return next;
}
function resolveAuction(room) {
  const draft = room.draft, remaining = room.players.filter(player => !draft.folded.includes(player.id) && player.roster.length < SLOTS.length);
  if (!draft.highestBidder || !remaining.length) { pickTeam(room); return; }
  draft.pendingChoice = { winnerId: draft.highestBidder, teamId: draft.currentTeam.id, price: draft.highestBid };
  draft.phase = 'choice';
}
function validSlot(player, slot) { return !slot || player.eligible.includes(slot); }

io.on('connection', socket => {
  socket.on('room:create', ({ name = 'Host', settings = {} } = {}, done = () => {}) => {
    let code; do { code = Math.random().toString(36).slice(2, 8).toUpperCase(); } while (rooms.has(code));
    const room = { code, host: socket.id, settings: { budget: Number(settings.budget) || 100, teamReturnRule: 'cap4' }, players: [{ id: socket.id, name: String(name).slice(0, 24), ready: false, budget: 0, roster: [], lineup: {} }], draft: { started: false, phase: 'lobby', round: 0, teams: [], currentTeam: null, highestBid: 0, highestBidder: null, activeBidderId: null, folded: [], pendingChoice: null, recent: [], log: [] } };
    rooms.set(code, room); socket.join(code); done({ ok: true, room: publicRoom(room) }); broadcast(room);
  });
  socket.on('room:join', ({ code, name = 'Player' } = {}, done = () => {}) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) return done({ ok: false, error: 'Room not found.' });
    if (room.draft.started) return done({ ok: false, error: 'Draft already started.' });
    if (room.players.length >= 4) return done({ ok: false, error: 'Room is full.' });
    room.players.push({ id: socket.id, name: String(name).slice(0, 24), ready: false, budget: 0, roster: [], lineup: {} }); socket.join(room.code); broadcast(room); done({ ok: true, room: publicRoom(room) });
  });
  socket.on('room:set_ready', ({ ready } = {}, done = () => {}) => { const room = roomFor(socket), player = room?.players.find(item => item.id === socket.id); if (!player || room.draft.started) return done({ ok: false, error: 'Room is not available.' }); player.ready = Boolean(ready); broadcast(room); done({ ok: true }); });
  socket.on('draft:start', async (_, done = () => {}) => {
    const room = roomFor(socket); if (!room || room.host !== socket.id) return done({ ok: false, error: 'Only the host can start.' });
    if (room.players.length < 2 || room.players.some(player => player.id !== room.host && !player.ready)) return done({ ok: false, error: 'Need two players and all guests ready.' });
    room.draft.teams = clone(await nflCatalog()); room.draft.started = true; room.players.forEach(player => { player.budget = room.settings.budget; player.roster = []; player.lineup = {}; player.locked = false; }); pickTeam(room); broadcast(room); done({ ok: true });
  });
  socket.on('draft:bid', ({ amount } = {}, done = () => {}) => {
    const room = roomFor(socket), draft = room?.draft, player = room?.players.find(item => item.id === socket.id), bid = Number(amount);
    if (!room || draft.phase !== 'auction' || !player) return done({ ok: false, error: 'No active auction.' });
    if (draft.activeBidderId !== socket.id) return done({ ok: false, error: 'Wait for your bidding turn.' });
    if (draft.folded.includes(player.id)) return done({ ok: false, error: 'You folded this auction.' });
    if (!Number.isInteger(bid) || bid < draft.highestBid + 1 || bid > maxBid(player)) return done({ ok: false, error: `Bid must be above ${draft.highestBid} and at most ${maxBid(player)}.` });
    draft.highestBid = bid; draft.highestBidder = player.id;
    const remaining = activeManagers(room);
    if (remaining.length === 1) resolveAuction(room); else advanceBidder(room);
    broadcast(room); done({ ok: true });
  });
  socket.on('draft:fold', (_, done = () => {}) => {
    const room = roomFor(socket), draft = room?.draft;
    if (!room || draft.phase !== 'auction' || draft.activeBidderId !== socket.id || draft.folded.includes(socket.id)) return done({ ok: false, error: 'It is not your turn to fold.' });
    draft.folded.push(socket.id);
    const remaining = activeManagers(room);
    if (draft.highestBidder && remaining.length <= 1) resolveAuction(room);
    else if (!draft.highestBidder && remaining.length === 1) { draft.highestBid = 1; draft.highestBidder = remaining[0].id; resolveAuction(room); }
    else if (!remaining.length) pickTeam(room);
    else advanceBidder(room);
    broadcast(room); done({ ok: true });
  });
  socket.on('draft:choosePlayer', ({ playerId } = {}, done = () => {}) => { const room = roomFor(socket), draft = room?.draft, choice = draft?.pendingChoice; if (!room || draft.phase !== 'choice' || choice?.winnerId !== socket.id) return done({ ok: false, error: 'You cannot choose now.' }); const winner = room.players.find(player => player.id === socket.id), team = draft.currentTeam, selected = team?.players.find(player => player.id === playerId); if (!winner || !selected) return done({ ok: false, error: 'Player is unavailable.' }); winner.budget -= choice.price; winner.roster.push({ ...selected, price: choice.price, slot: null }); team.players = team.players.filter(player => player.id !== playerId); team.picksTaken++; team.currentValue = teamValue(team.players); team.retired = team.picksTaken >= TEAM_PICK_CAP || team.players.length < 2 || team.currentValue / team.originalValue < .25; draft.log.unshift({ manager: winner.name, team: team.name, player: selected.name, price: choice.price, value: selected.value }); draft.pendingChoice = null; if (room.players.every(player => player.roster.length >= SLOTS.length)) draft.phase = 'lineup'; else pickTeam(room); broadcast(room); done({ ok: true }); });
  socket.on('draft:updateLineup', ({ lineup } = {}, done = () => {}) => { const room = roomFor(socket), player = room?.players.find(item => item.id === socket.id); if (!room || room.draft.phase !== 'lineup' || !player) return done({ ok: false, error: 'Lineup changes are closed.' }); const used = new Set(); for (const slot of SLOTS) { const playerId = lineup?.[slot]; if (!playerId) continue; const selected = player.roster.find(item => item.id === playerId); if (!selected || used.has(playerId) || !validSlot(selected, slot)) return done({ ok: false, error: 'Invalid lineup.' }); used.add(playerId); } player.lineup = Object.fromEntries(SLOTS.map(slot => [slot, lineup?.[slot] || null])); broadcast(room); done({ ok: true }); });
  socket.on('draft:finish', (_, done = () => {}) => { const room = roomFor(socket); if (!room || room.draft.phase !== 'lineup') return done({ ok: false, error: 'Draft is not ready to finish.' }); const player = room.players.find(item => item.id === socket.id); player.locked = true; if (room.players.every(item => item.locked)) room.draft.phase = 'complete'; broadcast(room); done({ ok: true }); });
  socket.on('disconnect', () => { const room = roomFor(socket); if (!room) return; room.players = room.players.filter(player => player.id !== socket.id); if (!room.players.length) rooms.delete(room.code); else { if (room.host === socket.id) room.host = room.players[0].id; broadcast(room); } });
});

const requestedPort = Number(process.env.PORT || 3000); let activePort = requestedPort;
function start() { server.listen(activePort, () => console.log(`Highest Bid NFL running at http://localhost:${activePort}`)); }
server.on('error', error => { if (error.code === 'EADDRINUSE' && !process.env.PORT && activePort < 3010) { activePort++; console.log(`Port ${activePort - 1} is in use. Trying ${activePort}.`); start(); } else { console.error(error); process.exit(1); } });
start();
