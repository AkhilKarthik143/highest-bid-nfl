/* Shared-room UI. Local play remains in nfl.js; this file renders only server-owned rooms. */
(() => {
  const slots = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX1', 'FLEX2'];
  const eligible = { QB: ['QB'], RB: ['RB1', 'RB2', 'FLEX1', 'FLEX2'], WR: ['WR1', 'WR2', 'FLEX1', 'FLEX2'], TE: ['TE', 'FLEX1', 'FLEX2'] };
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const money = value => `$${Number(value || 0)}`;
  const teamById = (room, id) => room.draft.teams.find(team => team.id === id);

  function error(game, message) { game.onlineError = message || ''; game.render(); }
  function me(game) { return game.onlineRoom?.players.find(player => player.id === game.onlineSocket?.id); }
  function send(game, event, payload = {}) {
    if (!game.onlineSocket?.connected) return error(game, 'Connecting to the game server…');
    game.onlineSocket.emit(event, payload, reply => { if (!reply?.ok) error(game, reply?.error || 'That action could not be completed.'); else { game.onlineError = ''; game.render(); } });
  }
  function renderAuth(game) {
    const joining = game.onlineIntent === 'join';
    return `<section class="screen setup-screen"><div class="eyebrow">ONLINE NFL AUCTION</div><h1>${joining ? 'Join a room' : 'Host a room'}</h1><p>Every bid, roster, and lineup is synchronized by the game server.</p><div class="panel form-panel"><label>Your name<input id="online-name" maxlength="24" value="${esc(game.onlineName || '')}" placeholder="Player name"></label>${joining ? '<label>Room code<input id="online-code" maxlength="6" placeholder="ABC123"></label>' : '<label>Starting budget<input id="online-budget" type="number" min="30" max="300" value="100"></label>'}<div class="action-row"><button class="button primary" onclick="game.onlineConnect()">${joining ? 'JOIN ROOM' : 'CREATE ROOM'}</button><button class="button" onclick="game.onlineCancel()">BACK</button></div>${game.onlineError ? `<p class="bid-error">${esc(game.onlineError)}</p>` : ''}</div></section>`;
  }
  function renderLobby(game, room) {
    const mine = me(game); const host = room.host === game.onlineSocket?.id;
    const people = room.players.map(player => `<div class="list-row"><strong>${esc(player.name)}</strong><span>${player.id === room.host ? 'HOST' : player.ready ? 'READY' : 'WAITING'}</span></div>`).join('');
    return `<section class="screen lobby-screen"><div class="eyebrow">PRIVATE ROOM</div><h1>Room ${esc(room.code)}</h1><p>Share this code with up to three friends. The host starts once every guest is ready.</p><div class="panel"><div class="metric-label">ROOM CODE</div><div class="room-code">${esc(room.code)}</div><div class="list">${people}</div></div><div class="action-row"><button class="button primary" onclick="game.onlineReady()">${mine?.ready ? 'NOT READY' : 'READY'}</button>${host ? '<button class="button primary" onclick="game.onlineStart()">START AUCTION</button>' : ''}<button class="button" onclick="game.onlineLeave()">LEAVE</button></div>${game.onlineError ? `<p class="bid-error">${esc(game.onlineError)}</p>` : ''}</section>`;
  }
  function renderDraft(game, room) {
    const draft = room.draft, team = draft.currentTeam || {}, mine = me(game), leader = room.players.find(player => player.id === draft.highestBidder), active = room.players.find(player => player.id === draft.activeBidderId);
    const folded = draft.folded.includes(game.onlineSocket?.id), myTurn = draft.activeBidderId === game.onlineSocket?.id; const legalMax = mine ? Math.max(0, mine.budget - (slots.length - mine.roster.length - 1)) : 0;
    const rosters = room.players.map(player => `<div class="panel roster-card"><strong>${esc(player.name)}</strong><span>${player.roster.length}/8 · ${money(player.budget)}</span><small>${player.roster.map(item => `${item.pos} ${item.name}`).join(' · ') || 'No players selected'}</small></div>`).join('');
    return `<section class="screen draft-screen"><div class="eyebrow">LIVE TEAM AUCTION · ROUND ${draft.round}</div><h1>${esc(team.name || team.id)} team access</h1><p>Top available: ${team.players?.slice(0, 3).map(player => `${esc(player.name)} (${player.pos} ${player.ovr})`).join(' · ') || '—'}</p><div class="auction-grid"><div class="panel bid-panel"><div class="metric-label">CURRENT BID</div><div class="bid-value">${money(draft.highestBid)}</div><p>${leader ? `Leading: ${esc(leader.name)}` : 'No bid has been placed.'}</p><p><strong>${myTurn ? 'YOUR TURN — bid or fold.' : `${esc(active?.name || 'Waiting')} is deciding.`}</strong></p><p>Your legal maximum: <strong>${money(legalMax)}</strong></p><div class="bid-entry"><input id="online-bid" type="number" min="${draft.highestBid + 1}" max="${legalMax}" value="${Math.min(legalMax, draft.highestBid + 1)}" ${myTurn ? '' : 'disabled'}><button class="button primary" ${!myTurn || folded || !mine || mine.roster.length >= 8 ? 'disabled' : ''} onclick="game.onlineBid()">BID</button></div><div class="action-row"><button class="button" ${!myTurn || folded ? 'disabled' : ''} onclick="game.onlineFold()">${folded ? 'FOLDED' : 'FOLD'}</button></div>${game.onlineError ? `<p class="bid-error">${esc(game.onlineError)}</p>` : ''}</div><div class="roster-list">${rosters}</div></div></section>`;
  }
  function renderChoice(game, room) {
    const choice = room.draft.pendingChoice, team = teamById(room, choice?.teamId) || room.draft.currentTeam, isWinner = choice?.winnerId === game.onlineSocket?.id;
    return `<section class="screen"><div class="eyebrow">AUCTION RESOLVED</div><h1>${isWinner ? 'Choose your player' : 'Waiting for the winner'}</h1><p>${isWinner ? `You won ${esc(team?.name || choice?.teamId)} access for ${money(choice.price)}. Select one offensive player.` : 'The winning manager is making their selection.'}</p><div class="player-grid">${(team?.players || []).map(player => `<button class="player-choice" ${isWinner ? `onclick="game.onlineChoose('${esc(player.id)}')"` : 'disabled'}><strong>${esc(player.name)}</strong><span>${player.pos} · ${player.ovr} OVR</span><small>${money(player.value)} value</small></button>`).join('')}</div>${game.onlineError ? `<p class="bid-error">${esc(game.onlineError)}</p>` : ''}</section>`;
  }
  function suggestedLineup(player) {
    const remaining = [...player.roster].sort((a, b) => b.ovr - a.ovr), lineup = {};
    for (const slot of slots) { const index = remaining.findIndex(item => (eligible[item.pos] || []).includes(slot)); if (index >= 0) lineup[slot] = remaining.splice(index, 1)[0].id; }
    return lineup;
  }
  function renderLineup(game, room) {
    const mine = me(game); const locked = mine?.locked;
    const rows = (mine?.roster || []).map(item => `<div class="list-row"><strong>${esc(item.name)}</strong><span>${item.pos} · ${item.ovr} OVR</span></div>`).join('');
    return `<section class="screen"><div class="eyebrow">LINEUP REVIEW</div><h1>Lock your final lineup</h1><p>Auto-fill uses legal position eligibility. You can refine placement in a future update without affecting this draft’s shared state.</p><div class="panel list">${rows}</div><div class="action-row"><button class="button primary" ${locked ? 'disabled' : ''} onclick="game.onlineAutoLineup()">AUTO-FILL & LOCK</button></div><p>${room.players.filter(player => player.locked).length}/${room.players.length} managers locked.</p>${game.onlineError ? `<p class="bid-error">${esc(game.onlineError)}</p>` : ''}</section>`;
  }
  function renderComplete(room) {
    return `<section class="screen"><div class="eyebrow">DRAFT COMPLETE</div><h1>All lineups are locked</h1><p>The authoritative multiplayer draft is complete. Series simulation will be the next shared server phase.</p><div class="panel list">${room.players.map(player => `<div class="list-row"><strong>${esc(player.name)}</strong><span>${player.roster.length}/8 players · ${money(player.budget)} left</span></div>`).join('')}</div></section>`;
  }
  function onlineView(game) {
    const room = game.onlineRoom;
    if (!room) return renderAuth(game);
    if (room.phase === 'lobby') return renderLobby(game, room);
    if (room.phase === 'auction') return renderDraft(game, room);
    if (room.phase === 'choice') return renderChoice(game, room);
    if (room.phase === 'lineup') return renderLineup(game, room);
    return renderComplete(room);
  }
  function attach(game) {
    const localRender = game.render.bind(game);
    game.render = function () { if (this.onlineIntent || this.onlineRoom) { $('#app').innerHTML = onlineView(this); return; } localRender(); };
    const localSetMode = game.setMode?.bind(game);
    game.setMode = function (mode) { if (mode === 'host' || mode === 'join') { this.onlineIntent = mode; this.onlineRoom = null; this.onlineError = ''; this.render(); return; } localSetMode?.(mode); };
    game.onlineCancel = function () { this.onlineIntent = null; this.onlineRoom = null; this.onlineError = ''; this.screen = 'setup'; this.render(); };
    game.onlineSocket = window.io?.();
    if (!game.onlineSocket) { game.onlineError = 'Socket.IO did not load. Refresh and try again.'; return; }
    game.onlineSocket.on('room:state', room => { game.onlineRoom = room; game.onlineError = ''; game.render(); });
    game.onlineSocket.on('disconnect', () => { if (game.onlineRoom) { game.onlineError = 'Connection lost. Reconnect to continue.'; game.render(); } });
    game.onlineConnect = function () { const name = $('#online-name')?.value.trim() || 'Player'; this.onlineName = name; if (this.onlineIntent === 'host') send(this, 'room:create', { name, settings: { budget: Number($('#online-budget')?.value) || 100 } }); else send(this, 'room:join', { name, code: $('#online-code')?.value.trim().toUpperCase() }); };
    game.onlineReady = function () { const player = me(this); send(this, 'room:set_ready', { ready: !player?.ready }); };
    game.onlineStart = function () { send(this, 'draft:start'); };
    game.onlineBid = function () { send(this, 'draft:bid', { amount: Number($('#online-bid')?.value) }); };
    game.onlineFold = function () { send(this, 'draft:fold'); };
    game.onlineChoose = function (playerId) { send(this, 'draft:choosePlayer', { playerId }); };
    game.onlineAutoLineup = function () { const player = me(this), lineup = suggestedLineup(player || { roster: [] }); if (!this.onlineSocket?.connected) return error(this, 'Connecting to the game server…'); this.onlineSocket.emit('draft:updateLineup', { lineup }, reply => { if (!reply?.ok) return error(this, reply?.error || 'The lineup could not be saved.'); this.onlineSocket.emit('draft:finish', {}, finish => { if (!finish?.ok) error(this, finish?.error || 'The lineup could not be locked.'); }); }); };
    game.onlineLeave = function () { this.onlineSocket.disconnect(); this.onlineSocket = window.io(); this.onlineRoom = null; this.onlineIntent = null; this.screen = 'setup'; this.render(); };
  }
  const wait = setInterval(() => { if (window.game) { clearInterval(wait); attach(window.game); } }, 20);
})();
