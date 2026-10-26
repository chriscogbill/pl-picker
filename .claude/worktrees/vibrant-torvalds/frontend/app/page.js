'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '../lib/AuthContext';
import { api } from '../lib/api';
import AdBanner from '../components/AdBanner';

export default function HomePage() {
  const { user, loading } = useAuth();
  const [games, setGames] = useState([]);
  const [loadingGames, setLoadingGames] = useState(true);

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

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading...</div>;
  }

  const myGames = games.filter(g => g.is_member);
  const activeGames = myGames.filter(g => g.status === 'active');

  return (
    <div className="space-y-8">
      <div className="text-center">
        <img src="/logo.svg" alt="PL Picker" className="h-16 mx-auto mb-2" />
        <p className="text-lg text-gray-600">Premier League Last Man Standing</p>
      </div>

      {user ? (
        <div className="space-y-6">
          {/* Quick actions */}
          <div className="flex gap-4 justify-center">
            <Link href="/games/create" className="btn-primary">Create Game</Link>
            <Link href="/games" className="btn-secondary">My Games</Link>
          </div>

          {/* Active games summary */}
          {activeGames.length > 0 && (
            <div>
              <h2 className="text-xl font-bold mb-4">Your Active Games</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {activeGames.map(game => (
                  <Link key={game.game_id} href={`/games/${game.game_id}`} className="card block">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-bold text-lg">{game.game_name}</h3>
                        <p className="text-sm text-gray-500">
                          {game.alive_count} of {game.player_count} players remaining
                        </p>
                      </div>
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
                        game.user_status === 'alive'
                          ? 'bg-positive-100 text-positive-700'
                          : game.user_status === 'eliminated'
                          ? 'bg-danger-100 text-danger-700'
                          : 'bg-gray-100 text-gray-700'
                      }`}>
                        {game.user_status === 'alive' ? 'Alive' : game.user_status === 'eliminated' ? 'Eliminated' : game.user_status}
                      </span>
                    </div>
                    {game.user_status === 'alive' && (
                      <div className="mt-3">
                        <span className="text-sm text-primary-600 font-medium">Make your pick &rarr;</span>
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {myGames.length === 0 && !loadingGames && (
            <div className="card text-center">
              <p className="text-gray-600 mb-4">You're not in any games yet.</p>
              <div className="flex gap-4 justify-center">
                <Link href="/games/create" className="btn-primary">Create a Game</Link>
                <Link href="/games" className="btn-secondary">Join a Game</Link>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="card text-center">
          <p className="text-gray-600 mb-4">Log in to create or join a game.</p>
          <div className="flex gap-4 justify-center">
            <Link href="/login" className="btn-primary">Login</Link>
            <Link href="/register" className="btn-secondary">Register</Link>
          </div>
        </div>
      )}

      <AdBanner adSlot="XXXXXXXXXX" />

      {/* Rules */}
      <div className="card">
        <h2 className="text-xl font-bold mb-4">How It Works</h2>
        <div className="space-y-3 text-gray-700">
          <div className="flex gap-3">
            <span className="font-bold text-primary-600 shrink-0">1.</span>
            <p>Each gameweek, pick one Premier League team to <strong>win</strong> their match.</p>
          </div>
          <div className="flex gap-3">
            <span className="font-bold text-primary-600 shrink-0">2.</span>
            <p>If your team doesn't win (draw or loss), you're <strong>eliminated</strong>.</p>
          </div>
          <div className="flex gap-3">
            <span className="font-bold text-primary-600 shrink-0">3.</span>
            <p>You <strong>can't pick the same team twice</strong> (unless you've used all available teams already).</p>
          </div>
          <div className="flex gap-3">
            <span className="font-bold text-primary-600 shrink-0">4.</span>
            <p>Last player standing <strong>wins</strong>!</p>
          </div>
        </div>
      </div>
    </div>
  );
}
