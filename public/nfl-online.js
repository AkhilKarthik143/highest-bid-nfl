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
    const needs = (mine?.roster || []).map(item => item.pos); const has = position => needs.includes(position); const needText = ['QB','RB','WR','TE'].filter(position => !has(position)).join(', ') || 'FLEX';
    const rosterCard = (player, own) => { const open = Math.max(0, slots.length - player.roster.length); const max = Math.max(0, player.budget - Math.max(0, open - 1)); const avg = player.roster.length ? Math.round(player.roster.reduce((sum, item) => sum + Number(item.ovr || 0), 0) / player.roster.length) : '—'; const used = new Set(); const slotRows = slots.map(slot => { let item = player.roster.find(candidate => candidate.slot === slot && !used.has(candidate.id)); if (!item) item = player.roster.find(candidate => !used.has(candidate.id) && (candidate.pos === slot || (slot.startsWith(candidate.pos) && candidate.pos !== 'QB'))); if (item) used.add(item.id); return `<div class="manager-slot"><span>${slot}</span><b>${item ? esc(item.name) : '—'}</b><em>${item ? `${item.pos} · ${item.ovr}` : ''}</em></div>`; }).join(''); return `<div class="panel roster-card ${own ? 'my-roster' : ''}"><div class="roster-card-head"><span class="manager-number">${room.players.findIndex(candidate => candidate.id === player.id) + 1}</span><strong>${own ? 'YOUR TEAM' : esc(player.name)}</strong><span class="roster-ovr">${avg}<small> OVR</small></span></div><div class="roster-budget">${player.roster.length}/8 · ${money(player.budget)}</div><div class="manager-slots">${slotRows}</div><div class="manager-bench">Bench: ${Math.max(0, player.roster.length - used.size)}</div><div class="manager-progress"><i style="width:${Math.min(100, player.roster.length / 8 * 100)}%"></i></div>${own ? `<div class="roster-summary"><span>MAX BID <b>${money(max)}</b></span><span>NEEDS <b>${esc(needText)}</b></span></div>` : ''}</div>`; };
    const mineCard = mine ? rosterCard(mine, true) : '';
    const otherCards = room.players.filter(player => player.id !== game.onlineSocket?.id).map(player => rosterCard(player, false)).join('');
    return `<section class="screen draft-screen"><div class="eyebrow">LIVE TEAM AUCTION · ROUND ${draft.round}</div><div class="auction-header"><div><h1>${esc(team.name || team.id)} team access</h1><p>Top available: ${team.players?.slice(0, 3).map(player => `${esc(player.name)} (${player.pos} ${player.ovr})`).join(' · ') || '—'}</p></div><div class="turn-status ${myTurn ? 'your-turn' : ''}"><span class="metric-label">${myTurn ? 'YOUR TURN' : 'ON THE CLOCK'}</span><strong>${myTurn ? 'Bid or fold' : esc(active?.name || 'Waiting')}</strong></div></div><div class="auction-grid"><div class="panel bid-panel"><div class="metric-label">CURRENT BID</div><div class="bid-value">${money(draft.highestBid)}</div><p class="bid-leader">${leader ? `Leading: <strong>${esc(leader.name)}</strong>` : 'No bid has been placed'}</p><p class="bid-next"><strong>${myTurn ? 'Your decision' : `${esc(active?.name || 'Waiting')} is deciding`}</strong></p><div class="bid-rules"><span>Your max</span><strong>${money(legalMax)}</strong></div><div class="bid-entry"><input id="online-bid" aria-label="Bid amount" type="number" min="${draft.highestBid + 1}" max="${legalMax}" value="${Math.min(legalMax, draft.highestBid + 1)}" ${myTurn ? '' : 'disabled'}><button class="button primary" ${!myTurn || folded || !mine || mine.roster.length >= 8 ? 'disabled' : ''} onclick="game.onlineBid()">BID</button></div><div class="action-row"><button class="button" ${!myTurn || folded ? 'disabled' : ''} onclick="game.onlineFold()">${folded ? 'FOLDED' : 'FOLD'}</button></div>${game.onlineError ? `<p class="bid-error">${esc(game.onlineError)}</p>` : ''}</div><aside class="roster-sidebar"><div class="roster-section-title">MY TEAM</div>${mineCard}<div class="roster-section-title other-title">OTHER MANAGERS</div>${otherCards}</aside></div></section>`;
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
  const legacyRenderDraft = function (game, room) {
    const draft = room.draft, team = draft.currentTeam || {}, mine = me(game);
    const leader = room.players.find(player => player.id === draft.highestBidder);
    const active = room.players.find(player => player.id === draft.activeBidderId);
    const folded = draft.folded.includes(game.onlineSocket?.id);
    const myTurn = draft.activeBidderId === game.onlineSocket?.id;
    const legalMax = mine ? Math.max(0, mine.budget - (slots.length - mine.roster.length - 1)) : 0;
    const managerCard = (player, own) => `<section class="${own ? 'my-roster panel' : 'opponent-roster'}"><div class="roster-heading"><div><span class="metric-label">${own ? 'MY TEAM' : 'MANAGER'}</span><strong>${esc(player.name)}${own ? ' (YOU)' : ''}</strong></div><div><b>${player.roster.length}/8</b><span>${money(player.budget)}</span></div></div><div class="roster-players">${player.roster.length ? player.roster.map(item => `<span><b>${item.pos}</b> ${esc(item.name)} <em>${item.ovr}</em></span>`).join('') : '<span class="empty-roster">No players drafted yet</span>'}</div></section>`;
    const myRoster = mine ? managerCard(mine, true) : '';
    const opponents = room.players.filter(player => player.id !== game.onlineSocket?.id).map(player => managerCard(player, false)).join('');
    const onClock = myTurn ? 'YOU' : esc(active?.name || 'WAITING');
    const leaderText = leader ? `${esc(leader.name)} - ${money(draft.highestBid)}` : 'NO BID';
    const topPlayers = team.players?.slice(0, 3).map(player => `${esc(player.name)} (${player.pos} ${player.ovr})`).join(' / ') || '-';
    return `<section class="screen draft-screen"><div class="auction-status ${myTurn ? 'your-turn' : ''}"><div><span>ON THE CLOCK</span><strong>${onClock}</strong></div><div><span>LEADING BID</span><strong>${leaderText}</strong></div><div><span>YOUR BUDGET</span><strong>${money(mine?.budget)} | MAX ${money(legalMax)}</strong></div></div><div class="eyebrow">LIVE TEAM AUCTION - ROUND ${draft.round}</div><h1>${esc(team.name || team.id)} team access</h1><p>Top available: ${topPlayers}</p><div class="auction-grid"><div class="panel bid-panel"><div class="metric-label">CURRENT BID</div><div class="bid-value">${money(draft.highestBid)}</div><p class="bid-state">${myTurn ? 'YOUR TURN - place a bid or fold.' : `${onClock} is deciding.`}</p><div class="bid-entry"><input id="online-bid" type="number" min="${draft.highestBid + 1}" max="${legalMax}" value="${Math.min(legalMax, draft.highestBid + 1)}" ${myTurn ? '' : 'disabled'}><button class="button primary" ${!myTurn || folded || !mine || mine.roster.length >= 8 ? 'disabled' : ''} onclick="game.onlineBid()">BID</button></div><div class="action-row"><button class="button" ${!myTurn || folded ? 'disabled' : ''} onclick="game.onlineFold()">${folded ? 'FOLDED' : 'FOLD'}</button></div>${game.onlineError ? `<p class="bid-error">${esc(game.onlineError)}</p>` : ''}</div><aside class="roster-board">${myRoster}<div class="opponents-heading">OTHER MANAGERS</div>${opponents}</aside></div></section>`;
  };
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
    game.render = function () { if (this.onlineIntent || this.onlineRoom) { $('#app').innerHTML = onlineView(this); return; } localRender(); if (this.screen === 'setup') { const modes = document.querySelectorAll('.mode'); if (modes[1]) modes[1].querySelector('small').textContent = 'Create a private live room'; if (modes[2]) modes[2].querySelector('small').textContent = 'Join a friend with a private code'; } };
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
