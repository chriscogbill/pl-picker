'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/AuthContext';
import { api } from '../../../lib/api';

export default function CreateGamePage() {
  const { user, loading, currentGameweek } = useAuth();
  const router = useRouter();
  const [gameName, setGameName] = useState('');
  const [startGameweek, setStartGameweek] = useState(currentGameweek || 1);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdGame, setCreatedGame] = useState(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setCreating(true);

    try {
      const result = await api.createGame({ gameName, startGameweek });
      setCreatedGame(result.game);
    } catch (err) {
      setError(err.message || 'Failed to create game');
    } finally {
      setCreating(false);
    }
  }

  async function copyInviteCode() {
    try {
      await navigator.clipboard.writeText(createdGame.invite_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading...</div>;
  }

  if (!user) {
    return (
      <div className="card text-center">
        <p className="text-gray-600">Please log in to create a game.</p>
      </div>
    );
  }

  if (createdGame) {
    return (
      <div className="max-w-md mx-auto mt-8">
        <div className="card text-center">
          <div className="text-4xl mb-4">&#9917;</div>
          <h1 className="text-2xl font-bold mb-2">Game Created!</h1>
          <p className="text-gray-600 mb-6">{createdGame.game_name}</p>

          <div className="bg-primary-50 border-2 border-primary-200 rounded-lg p-6 mb-6">
            <p className="text-sm text-gray-600 mb-2">Share this invite code with your friends:</p>
            <div className="text-3xl font-mono font-bold text-primary-600 tracking-widest mb-3">
              {createdGame.invite_code}
            </div>
            <button onClick={copyInviteCode} className="btn-primary text-sm">
              {copied ? 'Copied!' : 'Copy Code'}
            </button>
          </div>

          <button
            onClick={() => router.push(`/games/${createdGame.game_id}`)}
            className="btn-secondary w-full"
          >
            Go to Game
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-8">
      <div className="card">
        <h1 className="text-2xl font-bold mb-6">Create a Game</h1>

        {error && (
          <div className="bg-danger-100 border border-danger-400 text-danger-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Game Name</label>
            <input
              type="text"
              value={gameName}
              onChange={(e) => setGameName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="e.g., Office Last Man Standing"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start Gameweek</label>
            <select
              value={startGameweek}
              onChange={(e) => setStartGameweek(parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              {Array.from({ length: 38 }, (_, i) => i + 1).map(gw => (
                <option key={gw} value={gw}>Gameweek {gw}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">The first gameweek where players must make picks.</p>
          </div>

          <button
            type="submit"
            disabled={creating || !gameName}
            className="w-full btn-primary disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {creating ? 'Creating...' : 'Create Game'}
          </button>
        </form>
      </div>
    </div>
  );
}
