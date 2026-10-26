'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../../lib/AuthContext';
import { api } from '../../../lib/api';

export default function AdminSettingsPage() {
  const { user, loading, currentSeason, currentGameweek, refreshGameweek } = useAuth();
  const [importing, setImporting] = useState(false);
  const [updatingResults, setUpdatingResults] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Testing controls state
  const [gwOverride, setGwOverride] = useState('');
  const [deadlineOverride, setDeadlineOverride] = useState(false);
  const [loadingOverrides, setLoadingOverrides] = useState(true);
  const [savingOverrides, setSavingOverrides] = useState(false);

  useEffect(() => {
    if (!loading && user?.role === 'admin') {
      loadOverrides();
    }
  }, [loading, user]);

  async function loadOverrides() {
    try {
      const settings = await api.getSettings();
      const testing = settings.settings?._testing?.value;
      if (testing) {
        const parsed = JSON.parse(testing);
        setGwOverride(parsed.gameweekOverride ? String(parsed.gameweekOverride) : '');
        setDeadlineOverride(parsed.deadlineOverride || false);
      }
    } catch (err) {
      console.error('Failed to load overrides:', err);
    } finally {
      setLoadingOverrides(false);
    }
  }

  const [importingFull, setImportingFull] = useState(false);

  async function handleImportFixtures(fullSeason = false) {
    if (fullSeason) {
      setImportingFull(true);
    } else {
      setImporting(true);
    }
    setMessage('');
    setError('');
    try {
      const result = await api.importFixtures(currentSeason, !fullSeason);
      setMessage(result.message);
    } catch (err) {
      setError(err.message || 'Failed to import fixtures');
    } finally {
      setImporting(false);
      setImportingFull(false);
    }
  }

  async function handleUpdateResults() {
    setUpdatingResults(true);
    setMessage('');
    setError('');
    try {
      const result = await api.updateResults(currentSeason);
      setMessage(result.message);
    } catch (err) {
      setError(err.message || 'Failed to update results');
    } finally {
      setUpdatingResults(false);
    }
  }

  async function handleSaveOverrides() {
    setSavingOverrides(true);
    setMessage('');
    setError('');
    try {
      await api.updateSetting('gameweek_override', gwOverride || '');
      await api.updateSetting('deadline_override', deadlineOverride ? 'true' : 'false');
      setMessage('Testing overrides saved. Refresh game pages to see changes.');
      // Refresh the global gameweek so the nav updates
      await refreshGameweek();
    } catch (err) {
      setError(err.message || 'Failed to save overrides');
    } finally {
      setSavingOverrides(false);
    }
  }

  async function handleClearOverrides() {
    setSavingOverrides(true);
    setMessage('');
    setError('');
    try {
      await api.updateSetting('gameweek_override', '');
      await api.updateSetting('deadline_override', 'false');
      setGwOverride('');
      setDeadlineOverride(false);
      setMessage('Overrides cleared — back to auto-detect mode.');
      await refreshGameweek();
    } catch (err) {
      setError(err.message || 'Failed to clear overrides');
    } finally {
      setSavingOverrides(false);
    }
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading...</div>;
  }

  if (!user || user.role !== 'admin') {
    return <div className="card text-center"><p className="text-gray-600">Admin access required.</p></div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Admin Settings</h1>

      {message && (
        <div className="bg-positive-100 border border-positive-400 text-positive-700 px-4 py-3 rounded">{message}</div>
      )}
      {error && (
        <div className="bg-danger-100 border border-danger-400 text-danger-700 px-4 py-3 rounded">{error}</div>
      )}

      <div className="card">
        <h2 className="font-bold text-lg mb-2">Current Season</h2>
        <p className="text-gray-600 mb-4">
          {currentSeason}/{(currentSeason + 1).toString().slice(-2)} — GW {currentGameweek}
        </p>
      </div>

      <div className="card">
        <h2 className="font-bold text-lg mb-2">Fixture Management</h2>
        <p className="text-sm text-gray-600 mb-4">
          Import fixtures from football-data.org or update results for completed matches.
        </p>
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={() => handleImportFixtures(false)}
            disabled={importing || importingFull}
            className="btn-primary disabled:bg-gray-400"
          >
            {importing ? 'Importing...' : 'Import Upcoming'}
          </button>
          <button
            onClick={() => handleImportFixtures(true)}
            disabled={importing || importingFull}
            className="btn-secondary disabled:bg-gray-400"
          >
            {importingFull ? 'Importing...' : 'Import Full Season'}
          </button>
          <button
            onClick={handleUpdateResults}
            disabled={updatingResults}
            className="btn-secondary disabled:bg-gray-400"
          >
            {updatingResults ? 'Updating...' : 'Update Results'}
          </button>
        </div>
      </div>

      {/* Testing Controls */}
      <div className="card border-2 border-warning-300 bg-warning-50">
        <h2 className="font-bold text-lg mb-1">Testing Controls</h2>
        <p className="text-sm text-gray-600 mb-4">
          Override gameweek and deadline settings for testing. Clear overrides to return to auto-detect.
        </p>

        {loadingOverrides ? (
          <p className="text-gray-500 text-sm">Loading...</p>
        ) : (
          <div className="space-y-4">
            {/* Gameweek override */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Gameweek Override
              </label>
              <div className="flex gap-2 items-center">
                <select
                  value={gwOverride}
                  onChange={(e) => setGwOverride(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded text-sm"
                >
                  <option value="">Auto-detect (GW {currentGameweek})</option>
                  {Array.from({ length: 38 }, (_, i) => i + 1).map(gw => (
                    <option key={gw} value={gw}>GW {gw}</option>
                  ))}
                </select>
                {gwOverride && (
                  <span className="text-xs text-warning-600 font-medium">Override active</span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Sets which gameweek the app treats as &quot;current&quot; for picks and standings.
              </p>
            </div>

            {/* Deadline override */}
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deadlineOverride}
                  onChange={(e) => setDeadlineOverride(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-sm font-medium text-gray-700">
                  Bypass deadlines
                </span>
                {deadlineOverride && (
                  <span className="text-xs text-warning-600 font-medium">Active</span>
                )}
              </label>
              <p className="text-xs text-gray-500 mt-1">
                When enabled, all gameweek deadlines are treated as not yet passed.
                Allows making picks for past gameweeks and hides other players&apos; picks.
              </p>
            </div>

            {/* Save / Clear buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleSaveOverrides}
                disabled={savingOverrides}
                className="btn-primary text-sm disabled:bg-gray-400"
              >
                {savingOverrides ? 'Saving...' : 'Save Overrides'}
              </button>
              {(gwOverride || deadlineOverride) && (
                <button
                  onClick={handleClearOverrides}
                  disabled={savingOverrides}
                  className="btn-secondary text-sm disabled:bg-gray-400"
                >
                  Clear All Overrides
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
