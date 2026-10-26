'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '../../lib/AuthContext';
import { api } from '../../lib/api';

export default function GamesPage() {
  const { user, loading } = useAuth();
  const [games, setGames] = useState([]);
  const [loadingGames, setLoadingGames] = useState(true);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!loading) {
      loadGames();
    }
  }, [loading]);

  async function loadGames() {
    try {
      const data = await api.getGames();
      setGames(data.games || []);
    } catch (error) {
      console.error('Error loading games:', error);
    } finally {
      setLoadingGames(false);
    }
  }

  async function handleJoin() {
    setJoinError('');
    setJoining(true);
    try {
      const result = await api.joinGame(inviteCode);
      setShowJoinModal(false);
      setInviteCode('');
      window.location.href = `/games/${result.game_id}`;
    } catch (error) {
      setJoinError(error.message || 'Failed to join game');
    } finally {
      setJoining(false);
    }
  }

  if (loading || loadingGames) {
    return <div className="text-center py-12 text-gray-500">Loading...</div>;
  }

  if (!user) {
    return (
      <div className="card text-center">
        <p className="text-gray-600">Please <Link href="/login" className="text-link">log in</Link> to view your games.</p>
      </div>
    );
  }

  const myGames = games.filter(g => g.is_member);
  const activeGames = myGames.filter(g => g.status === 'active');
  const openGames = myGames.filter(g => g.status === 'open');
  const completedGames = myGames.filter(g => g.status === 'completed');

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">My Games</h1>
        <div className="flex gap-3">
          <button onClick={() => setShowJoinModal(true)} className="btn-secondary">
            Join Game
          </button>
          <Link href="/games/create" className="btn-primary">
            Create Game
          </Link>
        </div>
      </div>

      {myGames.length === 0 ? (
        <div className="card text-center py-8">
          <p className="text-gray-600 mb-4">You haven't joined any games yet.</p>
          <button onClick={() => setShowJoinModal(true)} className="btn-primary">
            Join with Invite Code
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {activeGames.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3 text-positive-700">Active Games</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {activeGames.map(game => (
                  <GameCard key={game.game_id} game={game} />
                ))}
              </div>
            </div>
          )}

          {openGames.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3 text-link-600">Open Games (Waiting to Start)</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {openGames.map(game => (
                  <GameCard key={game.game_id} game={game} />
                ))}
              </div>
            </div>
          )}

          {completedGames.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3 text-gray-500">Completed Games</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {completedGames.map(game => (
                  <GameCard key={game.game_id} game={game} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Join Modal */}
      {showJoinModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold mb-4">Join a Game</h2>
            <p className="text-sm text-gray-600 mb-4">Enter the invite code shared by the game admin.</p>

            {joinError && (
              <div className="bg-danger-100 border border-danger-400 text-danger-700 px-3 py-2 rounded mb-4 text-sm">
                {joinError}
              </div>
            )}

            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              placeholder="Enter invite code"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent mb-4 uppercase"
              maxLength={8}
            />

            <div className="flex gap-3 justify-end">
              <button onClick={() => { setShowJoinModal(false); setJoinError(''); setInviteCode(''); }} className="btn-secondary">
                Cancel
              </button>
              <button onClick={handleJoin} disabled={!inviteCode || joining} className="btn-primary disabled:bg-gray-400 disabled:cursor-not-allowed">
                {joining ? 'Joining...' : 'Join Game'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GameCard({ game }) {
  const statusColors = {
    active: 'bg-positive-100 text-positive-700',
    open: 'bg-link-100 text-link-700',
    completed: 'bg-gray-100 text-gray-600',
  };

  const playerStatusColors = {
    alive: 'bg-positive-100 text-positive-700',
    eliminated: 'bg-danger-100 text-danger-700',
    winner: 'bg-warning-100 text-warning-700',
    drawn: 'bg-warning-100 text-warning-700',
  };

  return (
    <Link href={`/games/${game.game_id}`} className="card block">
      <div className="flex justify-between items-start mb-2">
        <h3 className="font-bold text-lg">{game.game_name}</h3>
        <span className={`px-2 py-1 rounded text-xs font-semibold ${statusColors[game.status] || 'bg-gray-100 text-gray-600'}`}>
          {game.status}
        </span>
      </div>
      <p className="text-sm text-gray-500 mb-2">
        {game.player_count} players
        {game.status === 'active' && ` (${game.alive_count} alive)`}
      </p>
      {game.user_status && (
        <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${playerStatusColors[game.user_status] || 'bg-gray-100 text-gray-600'}`}>
          You: {game.user_status}
        </span>
      )}
    </Link>
  );
}
