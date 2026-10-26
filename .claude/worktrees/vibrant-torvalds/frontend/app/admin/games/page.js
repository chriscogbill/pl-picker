'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '../../../lib/AuthContext';
import { api } from '../../../lib/api';

export default function AdminGamesPage() {
  const { user, loading } = useAuth();
  const [games, setGames] = useState([]);
  const [loadingGames, setLoadingGames] = useState(true);

  useEffect(() => {
    if (!loading) loadGames();
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

  if (loading || loadingGames) {
    return <div className="text-center py-12 text-gray-500">Loading...</div>;
  }

  if (!user || user.role !== 'admin') {
    return <div className="card text-center"><p className="text-gray-600">Admin access required.</p></div>;
  }

  const activeGames = games.filter(g => g.status === 'active');
  const openGames = games.filter(g => g.status === 'open');
  const completedGames = games.filter(g => g.status === 'completed');

  const statusColors = {
    active: 'bg-positive-100 text-positive-700',
    open: 'bg-link-100 text-link-700',
    completed: 'bg-gray-100 text-gray-600',
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">All Games</h1>

      {games.length === 0 ? (
        <div className="card text-center py-8">
          <p className="text-gray-600">No games found.</p>
        </div>
      ) : (
        <div className="card p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-gray-200 bg-gray-50">
                  <th className="text-left py-3 px-4">Game</th>
                  <th className="text-left py-3 px-4">Admin</th>
                  <th className="text-center py-3 px-4">Players</th>
                  <th className="text-center py-3 px-4">Alive</th>
                  <th className="text-center py-3 px-4">Status</th>
                  <th className="text-center py-3 px-4">Start GW</th>
                  <th className="text-right py-3 px-4">Created</th>
                </tr>
              </thead>
              <tbody>
                {[...activeGames, ...openGames, ...completedGames].map(game => (
                  <tr key={game.game_id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4">
                      <Link href={`/games/${game.game_id}`} className="text-link-600 hover:underline font-medium">
                        {game.game_name}
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-gray-600">{game.admin_email}</td>
                    <td className="py-3 px-4 text-center">{game.player_count}</td>
                    <td className="py-3 px-4 text-center">{game.status === 'active' ? game.alive_count : '-'}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${statusColors[game.status] || 'bg-gray-100 text-gray-600'}`}>
                        {game.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">GW{game.start_gameweek}</td>
                    <td className="py-3 px-4 text-right text-gray-500 text-xs whitespace-nowrap">
                      {new Date(game.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
