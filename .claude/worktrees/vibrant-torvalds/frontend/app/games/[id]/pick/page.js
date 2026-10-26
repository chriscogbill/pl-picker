'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/AuthContext';
import { api } from '../../../../lib/api';
import AdBanner from '../../../../components/AdBanner';

export default function PickPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user, loading, currentGameweek } = useAuth();
  const [teams, setTeams] = useState([]);
  const [fixtures, setFixtures] = useState([]);
  const [myPicks, setMyPicks] = useState([]);
  const [playerStatus, setPlayerStatus] = useState(null);
  const [deadline, setDeadline] = useState(null);
  const [deadlinePassed, setDeadlinePassed] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [currentPick, setCurrentPick] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loadingData, setLoadingData] = useState(true);
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    if (!loading && currentGameweek) {
      loadData();
    }
  }, [loading, currentGameweek]);

  // Countdown timer
  useEffect(() => {
    if (!deadline || deadlinePassed) return;

    const interval = setInterval(() => {
      const now = new Date();
      const dl = new Date(deadline);
      const diff = dl - now;

      if (diff <= 0) {
        setDeadlinePassed(true);
        setTimeLeft('Deadline passed');
        clearInterval(interval);
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeLeft(
        days > 0 ? `${days}d ${hours}h ${minutes}m` :
        hours > 0 ? `${hours}h ${minutes}m ${seconds}s` :
        `${minutes}m ${seconds}s`
      );
    }, 1000);

    return () => clearInterval(interval);
  }, [deadline, deadlinePassed]);

  async function loadData() {
    try {
      const [teamsData, fixturesData, picksData, deadlineData] = await Promise.all([
        api.getPlTeams(),
        api.getFixtures(currentGameweek),
        api.getMyPicks(id),
        api.getDeadline(currentGameweek)
      ]);

      setTeams(teamsData.teams || []);
      setFixtures(fixturesData.fixtures || []);
      setMyPicks(picksData.picks || []);
      setPlayerStatus(picksData.playerStatus);
      setDeadline(deadlineData.deadline);
      setDeadlinePassed(deadlineData.isPast || false);

      // Check if there's already a pick for this gameweek
      const thisWeekPick = picksData.picks?.find(p => p.gameweek === currentGameweek);
      if (thisWeekPick) {
        setCurrentPick(thisWeekPick);
        setSelectedTeam(thisWeekPick.team_id);
      }
    } catch (error) {
      console.error('Error loading pick data:', error);
      setError(error.message || 'Failed to load data');
    } finally {
      setLoadingData(false);
    }
  }

  async function handleSubmit() {
    if (!selectedTeam) return;
    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const result = await api.submitPick(id, selectedTeam);
      setSuccess(result.message);
      setCurrentPick({ team_id: selectedTeam });
      // Refresh picks
      const picksData = await api.getMyPicks(id);
      setMyPicks(picksData.picks || []);
    } catch (err) {
      setError(err.message || 'Failed to submit pick');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || loadingData) {
    return <div className="text-center py-12 text-gray-500">Loading...</div>;
  }

  if (!user) {
    return <div className="card text-center"><p className="text-gray-600">Please log in.</p></div>;
  }

  if (playerStatus === 'eliminated') {
    return (
      <div className="card text-center">
        <div className="text-4xl mb-4">&#128532;</div>
        <h1 className="text-2xl font-bold text-danger-600 mb-2">Eliminated</h1>
        <p className="text-gray-600">You've been knocked out of this game.</p>
        <button onClick={() => router.push(`/games/${id}`)} className="btn-secondary mt-4">
          Back to Game
        </button>
      </div>
    );
  }

  // Build team data with fixture info and used status
  const usedTeamIds = new Set(myPicks.filter(p => p.gameweek !== currentGameweek).map(p => p.team_id));
  const allUsed = usedTeamIds.size >= 20;

  const teamMap = {};
  teams.forEach(t => { teamMap[t.team_id] = t; });

  // Teams that have a fixture this gameweek (tracked to find those without)
  const teamsWithFixture = new Set();
  fixtures.forEach(f => {
    teamsWithFixture.add(f.home_team_id);
    teamsWithFixture.add(f.away_team_id);
  });
  const teamsWithoutFixture = teams.filter(t => !teamsWithFixture.has(t.team_id));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Make Your Pick</h1>
          <p className="text-sm text-gray-500">Gameweek {currentGameweek}</p>
        </div>
        <button onClick={() => router.push(`/games/${id}`)} className="btn-secondary text-sm">
          Back to Game
        </button>
      </div>

      {/* Deadline */}
      <div className={`rounded-lg p-4 text-center ${
        deadlinePassed ? 'bg-danger-100 text-danger-700' :
        timeLeft && !timeLeft.includes('d') ? 'bg-warning-100 text-warning-700' :
        'bg-link-100 text-link-700'
      }`}>
        <p className="text-sm font-medium">
          {deadlinePassed ? 'Deadline has passed' : `Deadline: ${timeLeft}`}
        </p>
        {deadline && (
          <p className="text-xs mt-1">
            {new Date(deadline).toLocaleDateString('en-GB', {
              weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
            })}
          </p>
        )}
      </div>

      <AdBanner adSlot="XXXXXXXXXX" />

      {error && (
        <div className="bg-danger-100 border border-danger-400 text-danger-700 px-4 py-3 rounded">{error}</div>
      )}
      {success && (
        <div className="bg-positive-100 border border-positive-400 text-positive-700 px-4 py-3 rounded">{success}</div>
      )}

      {/* Current pick */}
      {currentPick && !deadlinePassed && (
        <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
          <p className="text-sm text-primary-700">
            Current pick: <strong>{teams.find(t => t.team_id === currentPick.team_id)?.name || 'Unknown'}</strong>
            <span className="text-primary-500 ml-2">(you can change this before the deadline)</span>
          </p>
        </div>
      )}

      {/* Fixture-based team selection */}
      {!deadlinePassed ? (
        <div>
          <h2 className="font-bold mb-3">Select a team to win:</h2>

          {/* Submit button - shown above fixtures on mobile when a team is selected */}
          {selectedTeam && (
            <div className="mb-4 text-center sm:hidden">
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="btn-primary px-8 py-3 text-lg w-full disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {submitting ? 'Submitting...' : currentPick ? 'Change Pick' : 'Confirm Pick'}
              </button>
            </div>
          )}

          <div className="space-y-3">
            {fixtures.map(fixture => {
              const homeTeam = teamMap[fixture.home_team_id];
              const awayTeam = teamMap[fixture.away_team_id];
              if (!homeTeam || !awayTeam) return null;

              const homeUsed = !allUsed && usedTeamIds.has(fixture.home_team_id);
              const awayUsed = !allUsed && usedTeamIds.has(fixture.away_team_id);
              const homeSelected = selectedTeam === fixture.home_team_id;
              const awaySelected = selectedTeam === fixture.away_team_id;

              return (
                <div key={fixture.fixture_id} className="flex items-stretch rounded-lg border border-gray-200 overflow-hidden bg-white">
                  {/* Home team */}
                  <button
                    onClick={() => !homeUsed && setSelectedTeam(fixture.home_team_id)}
                    disabled={homeUsed}
                    className={`flex-1 w-0 p-3 sm:p-4 flex items-center gap-2 sm:gap-3 transition-all cursor-pointer text-left overflow-hidden
                      ${homeSelected
                        ? 'bg-primary-50 ring-2 ring-inset ring-primary-500'
                        : homeUsed
                        ? 'bg-gray-100 opacity-50 cursor-not-allowed'
                        : 'hover:bg-gray-50'
                      }
                    `}
                  >
                    {homeTeam.crest_url && (
                      <img src={homeTeam.crest_url} alt="" className="w-7 h-7 sm:w-8 sm:h-8 object-contain shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`font-semibold text-sm sm:text-base truncate ${homeUsed ? 'line-through text-gray-400' : ''}`}>
                        {homeTeam.name}
                      </p>
                    </div>

                  </button>

                  {/* VS divider */}
                  <div className="flex items-center px-2 sm:px-3 bg-gray-50 border-x border-gray-200">
                    <span className="text-xs font-bold text-gray-400">vs</span>
                  </div>

                  {/* Away team */}
                  <button
                    onClick={() => !awayUsed && setSelectedTeam(fixture.away_team_id)}
                    disabled={awayUsed}
                    className={`flex-1 w-0 p-3 sm:p-4 flex items-center gap-2 sm:gap-3 transition-all cursor-pointer text-left overflow-hidden
                      ${awaySelected
                        ? 'bg-primary-50 ring-2 ring-inset ring-primary-500'
                        : awayUsed
                        ? 'bg-gray-100 opacity-50 cursor-not-allowed'
                        : 'hover:bg-gray-50'
                      }
                    `}
                  >
                    {awayTeam.crest_url && (
                      <img src={awayTeam.crest_url} alt="" className="w-7 h-7 sm:w-8 sm:h-8 object-contain shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`font-semibold text-sm sm:text-base truncate ${awayUsed ? 'line-through text-gray-400' : ''}`}>
                        {awayTeam.name}
                      </p>
                    </div>

                  </button>
                </div>
              );
            })}
          </div>

          {/* Teams without a fixture this GW */}
          {teamsWithoutFixture.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-gray-400 mb-2">No fixture this gameweek:</p>
              <div className="flex flex-wrap gap-2">
                {teamsWithoutFixture.map(team => (
                  <span key={team.team_id} className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">
                    {team.short_name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {selectedTeam && (
            <div className="mt-6 text-center hidden sm:block">
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="btn-primary px-8 py-3 text-lg disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {submitting ? 'Submitting...' : currentPick ? 'Change Pick' : 'Confirm Pick'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="card text-center">
          <p className="text-gray-600">
            {currentPick
              ? `Your pick: ${teams.find(t => t.team_id === currentPick.team_id)?.name || 'Unknown'}`
              : 'No pick submitted for this gameweek.'}
          </p>
        </div>
      )}

      {/* Past picks */}
      {myPicks.length > 0 && (
        <div className="card">
          <h2 className="font-bold mb-3">Your Previous Picks</h2>
          <div className="space-y-1">
            {myPicks.filter(p => p.gameweek !== currentGameweek).map(pick => (
              <div key={pick.pick_id} className="flex justify-between items-center py-1 text-sm border-b border-gray-100">
                <span className="text-gray-500">GW {pick.gameweek}</span>
                <span className="font-medium">{pick.team_name}</span>
                <span>
                  {pick.result === 'win' && <span className="text-positive-600 font-bold">W</span>}
                  {pick.result === 'draw' && <span className="text-warning-600 font-bold">D</span>}
                  {pick.result === 'loss' && <span className="text-danger-600 font-bold">L</span>}
                  {!pick.result && <span className="text-gray-400">-</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
