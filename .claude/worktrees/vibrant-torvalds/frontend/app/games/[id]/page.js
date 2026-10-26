'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/AuthContext';
import { api } from '../../../lib/api';
import AdBanner from '../../../components/AdBanner';

export default function GameDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user, loading, currentGameweek, currentSeason } = useAuth();
  const [game, setGame] = useState(null);
  const [players, setPlayers] = useState([]);
  const [history, setHistory] = useState({});
  const [startGameweek, setStartGameweek] = useState(1);
  const [loadingData, setLoadingData] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [updatingStandings, setUpdatingStandings] = useState(false);
  const [processGw, setProcessGw] = useState(currentGameweek || 1);
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [teams, setTeams] = useState([]);

  useEffect(() => {
    if (!loading) {
      loadData();
    }
  }, [loading, id]);

  useEffect(() => {
    if (currentGameweek) setProcessGw(currentGameweek);
  }, [currentGameweek]);

  async function loadData() {
    try {
      const [gameData, historyData, teamsData] = await Promise.all([
        api.getGame(id),
        api.getGameHistory(id),
        api.getPlTeams()
      ]);
      setGame(gameData.game);
      setPlayers(gameData.players);
      setHistory(historyData.history || {});
      setStartGameweek(historyData.startGameweek || gameData.game.start_gameweek || 1);
      setTeams(teamsData.teams || []);
    } catch (error) {
      console.error('Error loading game:', error);
    } finally {
      setLoadingData(false);
    }
  }

  async function handleProcessResults() {
    setProcessing(true);
    setMessage('');
    try {
      // First update fixture results from the API
      setMessage('Fetching latest results from API...');
      await api.updateResults(currentSeason);
      // Then process results and apply eliminations
      setMessage('Processing eliminations...');
      const result = await api.processResults(id, processGw);
      setMessage(result.message);
      loadData();
    } catch (error) {
      setMessage(error.message || 'Failed to import results');
    } finally {
      setProcessing(false);
    }
  }

  async function handleUpdateStandings() {
    setUpdatingStandings(true);
    setMessage('');
    try {
      const result = await api.updateStandings(id, processGw);
      setMessage(result.message);
      loadData();
    } catch (error) {
      setMessage(error.message || 'Failed to update standings');
    } finally {
      setUpdatingStandings(false);
    }
  }

  async function copyInviteCode() {
    try {
      await navigator.clipboard.writeText(game.invite_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  async function handleAdminPickChange(playerEmail, gw, teamShortName) {
    setMessage('');
    try {
      const result = await api.importPick(id, playerEmail, gw, teamShortName);
      setMessage(result.message);
      loadData();
    } catch (error) {
      setMessage(error.message || 'Failed to update pick');
    }
  }

  if (loading || loadingData) {
    return <div className="text-center py-12 text-gray-500">Loading...</div>;
  }

  if (!game) {
    return <div className="card text-center"><p className="text-gray-600">Game not found.</p></div>;
  }

  const isGameAdmin = user && (user.email === game.admin_email || user.role === 'admin');
  const myPlayer = players.find(p => p.user_email === user?.email);

  // Build the list of gameweeks that have activity (picks or are in range)
  const historyGws = Object.keys(history).map(Number);
  const maxGw = Math.max(startGameweek, ...historyGws, currentGameweek || 0);
  const gameweeks = [];
  for (let gw = startGameweek; gw <= maxGw; gw++) {
    gameweeks.push(gw);
  }

  // Build a lookup: playerEmail -> gameweek -> pick info
  const pickLookup = {};
  players.forEach(p => { pickLookup[p.user_email] = {}; });

  Object.entries(history).forEach(([gw, gwData]) => {
    const gwNum = parseInt(gw);
    gwData.picks.forEach(pick => {
      if (!pickLookup[pick.user_email]) pickLookup[pick.user_email] = {};
      pickLookup[pick.user_email][gwNum] = pick;
    });
  });

  // Sort players: winners/drawn first, then alive (by wins desc), then eliminated (lasted longest first)
  const statusOrder = { winner: 0, drawn: 1, alive: 2, eliminated: 3 };
  const sortedPlayers = [...players].sort((a, b) => {
    const aOrder = statusOrder[a.status] ?? 2;
    const bOrder = statusOrder[b.status] ?? 2;
    if (aOrder !== bOrder) return aOrder - bOrder;

    // Among eliminated players, sort by eliminated_gameweek desc (lasted longest first)
    // then by wins desc as tiebreaker
    if (a.status === 'eliminated' && b.status === 'eliminated') {
      const gwDiff = (b.eliminated_gameweek || 0) - (a.eliminated_gameweek || 0);
      if (gwDiff !== 0) return gwDiff;
      const aWins = Object.values(pickLookup[a.user_email] || {}).filter(p => p.result === 'win').length;
      const bWins = Object.values(pickLookup[b.user_email] || {}).filter(p => p.result === 'win').length;
      if (aWins !== bWins) return bWins - aWins;
    }

    // Among alive players, sort by number of wins desc
    if (a.status === 'alive' && b.status === 'alive') {
      const aWins = Object.values(pickLookup[a.user_email] || {}).filter(p => p.result === 'win').length;
      const bWins = Object.values(pickLookup[b.user_email] || {}).filter(p => p.result === 'win').length;
      if (aWins !== bWins) return bWins - aWins;
    }

    return 0; // preserve original order as tiebreaker
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">{game.game_name}</h1>
          <p className="text-sm text-gray-500">
            {game.status === 'active' ? `Active - starts GW${game.start_gameweek}` :
             game.is_draw ? 'Completed - Draw' : 'Completed'}
          </p>
        </div>
      </div>

      {message && (
        <div className="bg-link-100 border border-link-300 text-link-700 px-4 py-3 rounded">
          {message}
        </div>
      )}

      {/* Admin controls */}
      {isGameAdmin && (
        <AdminPanel
          game={game}
          id={id}
          players={players}
          copied={copied}
          copyInviteCode={copyInviteCode}
          processing={processing}
          updatingStandings={updatingStandings}
          processGw={processGw}
          setProcessGw={setProcessGw}
          handleProcessResults={handleProcessResults}
          handleUpdateStandings={handleUpdateStandings}
          setMessage={setMessage}
          loadData={loadData}
          router={router}
        />
      )}

      <AdBanner adSlot="XXXXXXXXXX" />

      {/* Standings Table — gameweek grid */}
      <div className="card">
        <h2 className="font-bold text-lg mb-4">Standings</h2>
        {gameweeks.length > 0 && game.status !== 'open' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  <th className="text-left py-2 px-2 sm:px-3 sticky left-0 bg-white z-10 min-w-[100px] sm:min-w-[140px]">Player</th>
                  {gameweeks.map(gw => (
                    <th key={gw} className="text-center py-2 px-1 sm:px-2 min-w-[50px] sm:min-w-[70px] whitespace-nowrap text-xs sm:text-sm">
                      GW{gw}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedPlayers.map(player => {
                  const isEliminated = player.status === 'eliminated';
                  const isWinner = player.status === 'winner';
                  const isDrawn = player.status === 'drawn';

                  return (
                    <tr key={player.player_id} className="border-b border-gray-100">
                      <td className={`py-2 px-2 sm:px-3 font-medium sticky left-0 bg-white z-10 text-sm sm:text-base ${
                        isWinner ? 'text-warning-600 font-bold' :
                        isDrawn ? 'text-warning-600' :
                        isEliminated ? 'text-gray-400' : ''
                      }`}>
                        <span className={isEliminated ? 'line-through' : ''}>
                          {player.username}
                        </span>
                        {player.user_email === user?.email && (
                          <span className="text-xs text-gray-400 ml-1">(you)</span>
                        )}
                        {isWinner && <span className="ml-1 text-xs">🏆</span>}
                      </td>
                      {gameweeks.map(gw => {
                        const pick = pickLookup[player.user_email]?.[gw];
                        const gwData = history[gw];
                        const isCurrentUser = player.user_email === user?.email;

                        return (
                          <PickCell
                            key={gw}
                            pick={pick}
                            gwData={gwData}
                            player={player}
                            gw={gw}
                            isCurrentUser={isCurrentUser}
                            currentGameweek={currentGameweek}
                            gameId={id}
                            router={router}
                            isGameAdmin={isGameAdmin}
                            teams={teams}
                            onAdminPickChange={handleAdminPickChange}
                          />
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center text-gray-500 py-4">
            {game.status === 'open'
              ? 'Game hasn\'t started yet — waiting for players.'
              : 'No picks yet.'}
          </div>
        )}
      </div>
    </div>
  );
}

function AdminPanel({ game, id, players, copied, copyInviteCode, processing, updatingStandings, processGw, setProcessGw, handleProcessResults, handleUpdateStandings, setMessage, loadData, router }) {
  const [showManage, setShowManage] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Add player
  const [addEmail, setAddEmail] = useState('');
  const [addUsername, setAddUsername] = useState('');
  const [adding, setAdding] = useState(false);

  // Transfer admin
  const [newAdmin, setNewAdmin] = useState('');
  const [transferring, setTransferring] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.deleteGame(id);
      router.push('/games');
    } catch (error) {
      setMessage(error.message || 'Failed to delete game');
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  async function handleTransferAdmin() {
    if (!newAdmin) return;
    setTransferring(true);
    try {
      const result = await api.transferAdmin(id, newAdmin);
      setMessage(result.message);
      setNewAdmin('');
      loadData();
    } catch (error) {
      setMessage(error.message || 'Failed to transfer admin');
    } finally {
      setTransferring(false);
    }
  }

  async function handleAddPlayer() {
    setAdding(true);
    try {
      const result = await api.addPlayer(id, addEmail, addUsername || undefined);
      setMessage(result.message);
      setAddEmail('');
      setAddUsername('');
      loadData();
    } catch (error) {
      setMessage(error.message || 'Failed to add player');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="card bg-gray-50">
      <div className="flex justify-between items-center mb-3">
        <h2 className="font-bold">Admin Controls</h2>
        <div className="flex gap-3">
          <button
            onClick={() => router.push(`/games/${id}/manage`)}
            className="text-xs text-link-600 hover:underline cursor-pointer"
          >
            Data Manager
          </button>
          <button
            onClick={() => setShowManage(!showManage)}
            className="text-xs text-link-600 hover:underline cursor-pointer"
          >
            {showManage ? 'Hide Management' : 'Manage Game'}
          </button>
        </div>
      </div>

      {game.invite_code && (
        <div className="mb-4">
          <span className="text-sm text-gray-600">Invite Code: </span>
          <span className="font-mono font-bold text-primary-600">{game.invite_code}</span>
          <button onClick={copyInviteCode} className="ml-2 text-xs text-link-600 hover:underline cursor-pointer">
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}

      <div className="flex gap-3 flex-wrap items-end">
        {game.status === 'active' && (
          <div className="flex gap-2 items-end flex-wrap">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Gameweek</label>
              <select
                value={processGw}
                onChange={(e) => setProcessGw(parseInt(e.target.value))}
                className="px-2 py-1.5 border border-gray-300 rounded text-sm"
              >
                {Array.from({ length: 38 }, (_, i) => i + 1).map(gw => (
                  <option key={gw} value={gw}>GW {gw}</option>
                ))}
              </select>
            </div>
            <button onClick={handleProcessResults} disabled={processing || updatingStandings} className="btn-primary text-sm disabled:bg-gray-400" title="Import results from API and apply eliminations for this GW">
              {processing ? 'Importing...' : 'Import Results'}
            </button>
            <button onClick={handleUpdateStandings} disabled={updatingStandings || processing} className="btn-secondary text-sm disabled:bg-gray-400" title="Recalculate all standings from existing picks up to this GW">
              {updatingStandings ? 'Updating...' : 'Update Standings'}
            </button>
          </div>
        )}
      </div>

      {/* Expandable management panel */}
      {showManage && (
        <div className="mt-4 pt-4 border-t border-gray-200 space-y-5">

          {/* Add Player */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Add Player</h3>
            <div className="flex gap-2 flex-wrap items-end">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Email</label>
                <input
                  type="email"
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  placeholder="player@example.com"
                  className="px-2 py-1.5 border border-gray-300 rounded text-sm w-56"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Username (optional)</label>
                <input
                  type="text"
                  value={addUsername}
                  onChange={(e) => setAddUsername(e.target.value)}
                  placeholder="Display name"
                  className="px-2 py-1.5 border border-gray-300 rounded text-sm w-36"
                />
              </div>
              <button onClick={handleAddPlayer} disabled={!addEmail || adding} className="btn-primary text-sm disabled:bg-gray-400">
                {adding ? 'Adding...' : 'Add'}
              </button>
            </div>
          </div>

          <p className="text-xs text-gray-500">To edit picks, click on any pick in the standings table below.</p>

          {/* Transfer Admin */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Transfer Game Admin</h3>
            <div className="flex gap-2 flex-wrap items-end">
              <div>
                <label className="block text-xs text-gray-500 mb-1">New Admin</label>
                <select
                  value={newAdmin}
                  onChange={(e) => setNewAdmin(e.target.value)}
                  className="px-2 py-1.5 border border-gray-300 rounded text-sm w-56"
                >
                  <option value="">Select player</option>
                  {players.filter(p => p.user_email !== game.admin_email).map(p => (
                    <option key={p.player_id} value={p.user_email}>{p.username} ({p.user_email})</option>
                  ))}
                </select>
              </div>
              <button onClick={handleTransferAdmin} disabled={!newAdmin || transferring} className="btn-primary text-sm disabled:bg-gray-400">
                {transferring ? 'Transferring...' : 'Transfer'}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">This will make the selected player the game admin. You will lose admin access.</p>
          </div>

          {/* Delete Game */}
          <div className="pt-3 border-t border-gray-200">
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-sm text-danger-600 hover:text-danger-800 cursor-pointer"
              >
                Delete this game
              </button>
            ) : (
              <div className="flex gap-2 items-center">
                <span className="text-sm text-danger-600 font-medium">Are you sure? This cannot be undone.</span>
                <button onClick={handleDelete} disabled={deleting} className="px-3 py-1 bg-danger-600 text-white rounded text-sm hover:bg-danger-700 disabled:bg-gray-400 cursor-pointer">
                  {deleting ? 'Deleting...' : 'Yes, Delete'}
                </button>
                <button onClick={() => setConfirmDelete(false)} className="px-3 py-1 bg-gray-200 rounded text-sm hover:bg-gray-300 cursor-pointer">
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PickCell({ pick, gwData, player, gw, isCurrentUser, currentGameweek, gameId, router, isGameAdmin, teams, onAdminPickChange }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const isCurrentGw = gw === currentGameweek;
  const deadlineNotPassed = gwData ? !gwData.deadlinePassed : true;
  const canPick = isCurrentUser && isCurrentGw && deadlineNotPassed && player.status === 'alive';

  async function handleSelectTeam(teamShort) {
    if (!teamShort) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onAdminPickChange(player.user_email, gw, teamShort);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  // Admin editing mode — show dropdown
  if (editing && isGameAdmin) {
    return (
      <td className="py-1 px-1 text-center">
        <select
          autoFocus
          defaultValue={pick?.team_short || ''}
          onChange={(e) => handleSelectTeam(e.target.value)}
          onBlur={() => !saving && setEditing(false)}
          disabled={saving}
          className="w-16 sm:w-20 px-0.5 py-0.5 border border-primary-400 rounded text-xs bg-white focus:ring-1 focus:ring-primary-500"
        >
          <option value="">-</option>
          {teams.map(t => (
            <option key={t.team_id} value={t.short_name}>{t.short_name}</option>
          ))}
        </select>
      </td>
    );
  }

  // No pick data at all for this gameweek
  if (!pick) {
    // If the player was already eliminated before this GW, show empty
    if (player.status === 'eliminated' && player.eliminated_gameweek && gw > player.eliminated_gameweek) {
      return <td className="py-2 px-1 sm:px-2 text-center text-gray-200 text-xs sm:text-sm">—</td>;
    }
    // Current user can make a pick for this GW
    if (canPick) {
      return (
        <td className="py-2 px-1 sm:px-2 text-center">
          <button
            onClick={() => router.push(`/games/${gameId}/pick`)}
            className="inline-block px-1.5 sm:px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap bg-primary-500 text-white hover:bg-primary-600 cursor-pointer"
          >
            Pick
          </button>
        </td>
      );
    }
    // Admin can click empty cells to add a pick
    if (isGameAdmin) {
      return (
        <td
          className="py-2 px-1 sm:px-2 text-center text-gray-300 text-xs sm:text-sm cursor-pointer hover:bg-primary-50"
          onClick={() => setEditing(true)}
          title={`Add pick for ${player.username} GW${gw}`}
        >
          -
        </td>
      );
    }
    // Player is alive but hasn't picked yet (or GW hasn't started)
    return <td className="py-2 px-1 sm:px-2 text-center text-gray-300 text-xs sm:text-sm">-</td>;
  }

  // Pick is hidden (deadline not passed, not own pick)
  if (pick.hidden) {
    return (
      <td className="py-2 px-1 sm:px-2 text-center">
        <span className="inline-block w-5 h-5 sm:w-6 sm:h-6 bg-gray-200 rounded text-xs leading-5 sm:leading-6 text-gray-400" title="Pick hidden until deadline">
          ?
        </span>
      </td>
    );
  }

  // Pick is visible
  const resultColors = {
    win: 'bg-positive-100 text-positive-800',
    loss: 'bg-danger-100 text-danger-800 line-through',
    draw: 'bg-danger-100 text-danger-800 line-through',
  };

  const style = pick.result
    ? resultColors[pick.result] || 'bg-gray-100 text-gray-700'
    : 'bg-gray-100 text-gray-700';

  // Current user's own pick, still before deadline — show pick + change option
  if (canPick && !pick.result) {
    return (
      <td className="py-2 px-1 sm:px-2 text-center">
        <span
          className={`inline-block px-1 sm:px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${style}`}
          title={pick.team_name || ''}
        >
          {pick.team_short || pick.team_name || '?'}
        </span>
        <button
          onClick={() => router.push(`/games/${gameId}/pick`)}
          className="block mx-auto mt-0.5 text-[10px] text-primary-500 hover:text-primary-700 cursor-pointer"
        >
          Change
        </button>
      </td>
    );
  }

  return (
    <td className="py-2 px-1 sm:px-2 text-center">
      <span
        className={`inline-block px-1 sm:px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${style} ${isGameAdmin ? 'cursor-pointer hover:ring-2 hover:ring-primary-300' : ''}`}
        title={isGameAdmin ? `Click to edit ${player.username}'s GW${gw} pick` : (pick.team_name || '')}
        onClick={isGameAdmin ? () => setEditing(true) : undefined}
      >
        {pick.team_short || pick.team_name || '?'}
      </span>
    </td>
  );
}
