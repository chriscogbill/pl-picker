const cron = require('node-cron');
const pool = require('../db/connection');
const { getCurrentSeason, getCurrentGameweek, autoDetectGameweek, updateSetting } = require('../helpers/settings');

/**
 * Fetch latest fixture results from football-data.org and update the database.
 * Returns the number of newly updated fixtures.
 */
async function fetchLatestResults() {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey || apiKey === 'your-key-here' || apiKey === 'your-api-key-here') {
    console.log('[cron] Skipping results fetch — FOOTBALL_DATA_API_KEY not configured');
    return 0;
  }

  const season = await getCurrentSeason(pool);
  const headers = { 'X-Auth-Token': apiKey };

  const response = await fetch(
    `https://api.football-data.org/v4/competitions/PL/matches?season=${season}`,
    { headers }
  );

  if (!response.ok) {
    throw new Error(`Football-data API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  let updated = 0;

  for (const match of data.matches) {
    if (match.status !== 'FINISHED') continue;

    const result = await pool.query(
      `UPDATE pl_fixtures
       SET home_score = $1, away_score = $2, status = 'finished', updated_at = CURRENT_TIMESTAMP
       WHERE api_match_id = $3 AND status != 'finished'`,
      [match.score.fullTime.home, match.score.fullTime.away, match.id]
    );
    updated += result.rowCount;
  }

  // Auto-update current_gameweek
  const detectedGw = await autoDetectGameweek(pool, season);
  if (detectedGw != null) {
    await updateSetting(pool, 'current_gameweek', detectedGw);
  }

  return updated;
}

/**
 * Process results for all active games for a given gameweek.
 * Only processes if ALL fixtures in the gameweek are finished.
 * Returns summary of what was processed.
 */
async function processGameResults(gameweek) {
  const season = await getCurrentSeason(pool);

  // Check if all fixtures in this gameweek are finished
  const unfinished = await pool.query(
    `SELECT COUNT(*) AS count FROM pl_fixtures
     WHERE gameweek = $1 AND season = $2 AND status != 'finished'`,
    [gameweek, season]
  );

  if (parseInt(unfinished.rows[0].count) > 0) {
    return { processed: false, reason: `${unfinished.rows[0].count} fixtures still not finished in GW${gameweek}` };
  }

  // Build team results map
  const fixtures = await pool.query(
    `SELECT home_team_id, away_team_id, home_score, away_score
     FROM pl_fixtures
     WHERE gameweek = $1 AND season = $2 AND status = 'finished'`,
    [gameweek, season]
  );

  const teamResults = {};
  for (const f of fixtures.rows) {
    if (f.home_score > f.away_score) {
      teamResults[f.home_team_id] = 'win';
      teamResults[f.away_team_id] = 'loss';
    } else if (f.home_score < f.away_score) {
      teamResults[f.home_team_id] = 'loss';
      teamResults[f.away_team_id] = 'win';
    } else {
      teamResults[f.home_team_id] = 'draw';
      teamResults[f.away_team_id] = 'draw';
    }
  }

  // Get all active games that include this gameweek
  const activeGames = await pool.query(
    `SELECT game_id, game_name, start_gameweek FROM games
     WHERE status = 'active' AND start_gameweek <= $1`,
    [gameweek]
  );

  const results = [];

  for (const game of activeGames.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if this gameweek has already been processed for this game
      const alreadyProcessed = await client.query(
        `SELECT COUNT(*) AS count FROM picks
         WHERE game_id = $1 AND gameweek = $2 AND result IS NOT NULL`,
        [game.game_id, gameweek]
      );

      if (parseInt(alreadyProcessed.rows[0].count) > 0) {
        await client.query('ROLLBACK');
        results.push({ game: game.game_name, status: 'already processed' });
        continue;
      }

      // Get picks for this gameweek
      const picks = await client.query(
        `SELECT p.pick_id, p.game_player_id, p.pl_team_id
         FROM picks p
         WHERE p.game_id = $1 AND p.gameweek = $2`,
        [game.game_id, gameweek]
      );

      const eliminated = [];
      const survived = [];

      for (const pick of picks.rows) {
        const result = teamResults[pick.pl_team_id] || 'loss';
        await client.query(
          'UPDATE picks SET result = $1 WHERE pick_id = $2',
          [result, pick.pick_id]
        );

        if (result !== 'win') {
          eliminated.push({ playerId: pick.game_player_id, pickId: pick.pick_id });
        } else {
          survived.push(pick.game_player_id);
        }
      }

      // Auto-eliminate players who didn't pick
      const alivePlayers = await client.query(
        `SELECT player_id FROM game_players
         WHERE game_id = $1 AND status = 'alive'`,
        [game.game_id]
      );

      const playersWhoPicked = new Set(picks.rows.map(p => p.game_player_id));
      for (const player of alivePlayers.rows) {
        if (!playersWhoPicked.has(player.player_id)) {
          eliminated.push({ playerId: player.player_id, pickId: null });
        }
      }

      // Mark eliminated players
      for (const e of eliminated) {
        await client.query(
          `UPDATE game_players
           SET status = 'eliminated', eliminated_gameweek = $1, eliminated_pick_id = $2
           WHERE player_id = $3 AND status = 'alive'`,
          [gameweek, e.pickId, e.playerId]
        );
      }

      // Check for winner/draw
      const remaining = await client.query(
        `SELECT COUNT(*) AS count FROM game_players
         WHERE game_id = $1 AND status = 'alive'`,
        [game.game_id]
      );
      const aliveCount = parseInt(remaining.rows[0].count);

      if (aliveCount === 1) {
        const winner = await client.query(
          `SELECT player_id FROM game_players WHERE game_id = $1 AND status = 'alive'`,
          [game.game_id]
        );
        await client.query(
          `UPDATE game_players SET status = 'winner' WHERE player_id = $1`,
          [winner.rows[0].player_id]
        );
        await client.query(
          `UPDATE games SET status = 'completed', winner_player_id = $1 WHERE game_id = $2`,
          [winner.rows[0].player_id, game.game_id]
        );
      } else if (aliveCount === 0) {
        for (const e of eliminated) {
          await client.query(
            `UPDATE game_players SET status = 'drawn' WHERE player_id = $1`,
            [e.playerId]
          );
        }
        await client.query(
          `UPDATE games SET status = 'completed', is_draw = TRUE WHERE game_id = $1`,
          [game.game_id]
        );
      }

      await client.query('COMMIT');
      results.push({
        game: game.game_name,
        status: 'processed',
        eliminated: eliminated.length,
        alive: aliveCount,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`[cron] Error processing game "${game.game_name}":`, error);
      results.push({ game: game.game_name, status: 'error', error: error.message });
    } finally {
      client.release();
    }
  }

  return { processed: true, gameweek, games: results };
}

/**
 * Main cron tick: fetch results, then try to process any completed gameweeks.
 */
async function runResultsCheck() {
  try {
    console.log(`[cron] Running results check at ${new Date().toISOString()}`);

    // 1. Fetch latest fixture results from football-data.org
    const updated = await fetchLatestResults();
    if (updated > 0) {
      console.log(`[cron] Updated ${updated} fixture results`);
    }

    // 2. Find gameweeks that might need processing
    //    (gameweeks with all finished fixtures that have active games with unprocessed picks)
    const season = await getCurrentSeason(pool);
    const currentGw = await getCurrentGameweek(pool);

    // Check the last few gameweeks (in case some were missed)
    for (let gw = Math.max(1, currentGw - 2); gw <= currentGw; gw++) {
      const result = await processGameResults(gw);
      if (result.processed) {
        console.log(`[cron] GW${gw} processing:`, JSON.stringify(result.games));
      }
    }
  } catch (error) {
    console.error('[cron] Results check failed:', error);
  }
}

/**
 * Start the cron schedule.
 * Runs at specific times (UK) aligned with typical PL match finish times:
 *   14:30, 16:00, 16:50, 17:00, 17:15, 18:00, 18:45, 19:30, 20:30, 22:00
 * Server timezone is UTC, UK is Europe/London (UTC+0 winter / UTC+1 summer BST).
 */
function startResultsCron() {
  // Schedule each check time in Europe/London timezone
  const checkTimes = [
    '30 14 * * *',  // 14:30 — early Saturday 12:30 kickoffs
    '0 16 * * *',   // 16:00 — Saturday 15:00 kickoffs
    '50 16 * * *',  // 16:50 — late-finishing 15:00 games
    '0 17 * * *',   // 17:00 — buffer
    '15 17 * * *',  // 17:15 — buffer
    '0 18 * * *',   // 18:00 — Sunday 16:00 kickoffs
    '45 18 * * *',  // 18:45 — Saturday 17:30 kickoffs
    '30 19 * * *',  // 19:30 — Sunday 16:30/17:30 kickoffs
    '30 20 * * *',  // 20:30 — buffer for late finishes
    '0 22 * * *',   // 22:00 — midweek/Monday/Friday 20:00 kickoffs
  ];

  const cronOptions = { timezone: 'Europe/London' };

  checkTimes.forEach(schedule => {
    cron.schedule(schedule, runResultsCheck, cronOptions);
  });

  console.log(`✓ Results cron scheduled (${checkTimes.length} daily check times, Europe/London)`);

  // Also run once on startup (after a short delay to let the server fully initialize)
  setTimeout(runResultsCheck, 10000);
}

module.exports = { startResultsCron, runResultsCheck, fetchLatestResults, processGameResults };
