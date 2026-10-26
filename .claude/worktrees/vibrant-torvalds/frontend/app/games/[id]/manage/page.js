'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/AuthContext';
import { api } from '../../../../lib/api';

export default function ManagePage() {
  const { id } = useParams();
  const router = useRouter();
  const { user, loading, currentGameweek } = useAuth();
  const [game, setGame] = useState(null);
  const [players, setPlayers] = useState([]);
  const [history, setHistory] = useState({});
  const [startGameweek, setStartGameweek] = useState(1);
  const [loadingData, setLoadingData] = useState(true);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('info');
  const [importing, setImporting] = useState(false);

  // Editable table data: array of { email, username, picks: { gw: teamShort } }
  const [tableData, setTableData] = useState([]);

  useEffect(() => {
    if (!loading) loadData();
  }, [loading, id]);

  async function loadData() {
    try {
      const [gameData, historyData] = await Promise.all([
        api.getGame(id),
        api.getGameHistory(id)
      ]);
      setGame(gameData.game);
      setPlayers(gameData.players);
      setHistory(historyData.history || {});
      setStartGameweek(historyData.startGameweek || gameData.game.start_gameweek || 1);

      // Build table data from existing players and picks
      const rows = gameData.players.map(p => {
        const picks = {};
        Object.entries(historyData.history || {}).forEach(([gw, gwData]) => {
          const playerPick = gwData.picks.find(pick => pick.user_email === p.user_email);
          if (playerPick && playerPick.team_short) {
            picks[parseInt(gw)] = playerPick.team_short;
          }
        });
        return { email: p.user_email, username: p.username, picks };
      });
      setTableData(rows);
    } catch (error) {
      console.error('Error loading data:', error);
      showMessage(error.message || 'Failed to load data', 'error');
    } finally {
      setLoadingData(false);
    }
  }

  function showMessage(msg, type = 'info') {
    setMessage(msg);
    setMessageType(type);
  }

  // Get the gameweek columns to show
  const maxGw = Math.max(startGameweek, currentGameweek || 0);
  const gameweeks = [];
  for (let gw = startGameweek; gw <= maxGw; gw++) {
    gameweeks.push(gw);
  }

  // Handle cell edit
  function updateCell(rowIndex, field, value) {
    setTableData(prev => {
      const updated = [...prev];
      if (field === 'email' || field === 'username') {
        updated[rowIndex] = { ...updated[rowIndex], [field]: value };
      } else {
        // It's a gameweek pick
        const gw = parseInt(field);
        updated[rowIndex] = {
          ...updated[rowIndex],
          picks: { ...updated[rowIndex].picks, [gw]: value.toUpperCase() }
        };
      }
      return updated;
    });
  }

  // Add empty row
  function addRow() {
    setTableData(prev => [...prev, { email: '', username: '', picks: {} }]);
  }

  // Remove row
  function removeRow(index) {
    setTableData(prev => prev.filter((_, i) => i !== index));
  }

  // Column order: email, username, gw1, gw2, ...
  const getColumns = useCallback(() => {
    return ['email', 'username', ...gameweeks.map(String)];
  }, [gameweeks]);

  // Handle paste into any table cell — spreads across rows/columns from the focused cell
  function handleTablePaste(e, rowIndex, colIndex) {
    const text = e.clipboardData.getData('text');
    if (!text) return;

    const lines = text.split('\n').filter(l => l.length > 0);
    // Only intercept multi-cell pastes (has tabs or multiple lines)
    if (lines.length === 1 && !lines[0].includes('\t')) return;

    e.preventDefault();
    const columns = getColumns();

    setTableData(prev => {
      const updated = [...prev];

      // Ensure enough rows exist
      while (updated.length < rowIndex + lines.length) {
        updated.push({ email: '', username: '', picks: {} });
      }

      for (let r = 0; r < lines.length; r++) {
        const cells = lines[r].split('\t');
        const targetRow = rowIndex + r;

        for (let c = 0; c < cells.length; c++) {
          const targetCol = colIndex + c;
          if (targetCol >= columns.length) break;

          const field = columns[targetCol];
          const value = cells[c].trim();

          if (field === 'email' || field === 'username') {
            updated[targetRow] = { ...updated[targetRow], [field]: value };
          } else {
            const gw = parseInt(field);
            updated[targetRow] = {
              ...updated[targetRow],
              picks: { ...updated[targetRow].picks, [gw]: value.toUpperCase() }
            };
          }
        }
      }

      return updated;
    });

    const pastedRows = lines.length;
    const pastedCols = Math.max(...lines.map(l => l.split('\t').length));
    showMessage(`Pasted ${pastedRows} row(s) × ${pastedCols} column(s). Review and click "Save All" to import.`, 'info');
  }

  // Submit all data
  async function handleSaveAll() {
    const validRows = tableData.filter(r => r.email.trim());
    if (validRows.length === 0) {
      showMessage('No rows to import', 'error');
      return;
    }

    setImporting(true);
    showMessage('Importing...', 'info');
    try {
      const result = await api.bulkImport(id, validRows, gameweeks);

      // Show results
      const errors = result.results.filter(r => r.error);
      const successes = result.results.filter(r => !r.error);

      let msg = `Imported ${successes.length} player(s).`;
      if (errors.length > 0) {
        msg += ` Errors: ${errors.map(e => `${e.email}: ${e.error}`).join('; ')}`;
      }
      showMessage(msg, errors.length > 0 ? 'warning' : 'success');

      // Reload data to show updated state
      await loadData();
    } catch (error) {
      showMessage(error.message || 'Failed to import', 'error');
    } finally {
      setImporting(false);
    }
  }

  if (loading || loadingData) {
    return <div className="text-center py-12 text-gray-500">Loading...</div>;
  }

  if (!game) {
    return <div className="card text-center"><p className="text-gray-600">Game not found.</p></div>;
  }

  const isGameAdmin = user && (user.email === game.admin_email || user.role === 'admin');
  if (!isGameAdmin) {
    return <div className="card text-center"><p className="text-gray-600">Only the game admin can access this page.</p></div>;
  }

  const msgColors = {
    info: 'bg-link-100 border-link-300 text-link-700',
    success: 'bg-positive-100 border-positive-400 text-positive-700',
    error: 'bg-danger-100 border-danger-400 text-danger-700',
    warning: 'bg-warning-100 border-warning-400 text-warning-700',
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Manage Game</h1>
          <p className="text-sm text-gray-500">{game.game_name}</p>
        </div>
        <button onClick={() => router.push(`/games/${id}`)} className="btn-secondary text-sm">
          Back to Game
        </button>
      </div>

      {message && (
        <div className={`border px-4 py-3 rounded ${msgColors[messageType] || msgColors.info}`}>
          {message}
        </div>
      )}

      {/* Instructions */}
      <div className="card bg-gray-50">
        <h2 className="font-bold mb-2">Data Import</h2>
        <p className="text-sm text-gray-600 mb-2">
          Edit the table below or paste data from a spreadsheet directly into any cell.
          Multi-cell pastes will fill across rows and columns automatically.
        </p>
        <p className="text-xs text-gray-500 font-mono">
          Columns: Email | Username | GW{gameweeks[0]} | GW{gameweeks[1]} | ... (use team short codes like ARS, CHE, LIV)
        </p>
        <div className="flex gap-2 mt-3">
          <button onClick={addRow} className="btn-secondary text-sm">
            + Add Row
          </button>
          <button
            onClick={handleSaveAll}
            disabled={importing}
            className="btn-primary text-sm disabled:bg-gray-400"
          >
            {importing ? 'Saving...' : 'Save All'}
          </button>
        </div>
      </div>

      {/* Editable table */}
      <div className="card p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b-2 border-gray-200 bg-gray-50">
                <th className="text-left py-2 px-2 sticky left-0 bg-gray-50 z-10 min-w-[180px]">Email</th>
                <th className="text-left py-2 px-2 min-w-[120px]">Username</th>
                {gameweeks.map(gw => (
                  <th key={gw} className="text-center py-2 px-1 min-w-[60px] whitespace-nowrap text-xs">
                    GW{gw}
                  </th>
                ))}
                <th className="py-2 px-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {tableData.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-1 px-1 sticky left-0 bg-white z-10">
                    <input
                      type="email"
                      value={row.email}
                      onChange={e => updateCell(rowIndex, 'email', e.target.value)}
                      onPaste={e => handleTablePaste(e, rowIndex, 0)}
                      className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                      placeholder="email@example.com"
                    />
                  </td>
                  <td className="py-1 px-1">
                    <input
                      type="text"
                      value={row.username}
                      onChange={e => updateCell(rowIndex, 'username', e.target.value)}
                      onPaste={e => handleTablePaste(e, rowIndex, 1)}
                      className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                      placeholder="Auto from email"
                    />
                  </td>
                  {gameweeks.map((gw, gwIndex) => (
                    <td key={gw} className="py-1 px-1">
                      <input
                        type="text"
                        value={row.picks[gw] || ''}
                        onChange={e => updateCell(rowIndex, String(gw), e.target.value)}
                        onPaste={e => handleTablePaste(e, rowIndex, 2 + gwIndex)}
                        className="w-full px-1 py-1 border border-gray-200 rounded text-xs text-center uppercase focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                        placeholder="-"
                        maxLength={3}
                      />
                    </td>
                  ))}
                  <td className="py-1 px-1 text-center">
                    <button
                      onClick={() => removeRow(rowIndex)}
                      className="text-danger-500 hover:text-danger-700 text-xs cursor-pointer"
                      title="Remove row"
                    >
                      &times;
                    </button>
                  </td>
                </tr>
              ))}
              {tableData.length === 0 && (
                <tr>
                  <td colSpan={gameweeks.length + 3} className="text-center py-8 text-gray-400">
                    No data. Click "+ Add Row" to get started, or paste spreadsheet data into the first cell.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
