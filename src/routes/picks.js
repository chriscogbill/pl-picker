const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../db/connection');
const { requireAuth, requireAdmin } = require('../middleware/requireAuth');
const { getCurrentSeason, getCurrentGameweek, getGameweekOverride, isDeadlineOverridden, autoDetectGameweek } = require('../helpers/settings');

// GET /api/games/:id/my-picks - Get my picks in this game
router.get('/my-picks', requireAuth, async (req, res) => {
  try {
    const gameId = req.params.id;

    const playerResult = await pool.query(
      'SELECT player_id, status FROM game_players WHERE game_id = $1 AND user_email = $2',
      [gameId, req.session.email]
    );

    if (playerResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'You are not in this game' });
    }

    const gamePlayer = playerResult.rows[0];

    const picksResult = await pool.query(
      `SELECT p.pick_id, p.gameweek, p.result, p.created_at,
              t.team_id, t.name AS team_name, t.short_name AS team_short, t.crest_url
       FROM picks p
       JOIN pl_teams t ON p.pl_team_id = t.team_id
       WHERE p.game_player_id = $1
       ORDER BY p.gameweek`,
      [gamePlayer.player_id]
    );

    res.json({
      success: true,
      playerStatus: gamePlayer.status,
      picks: picksResult.rows
    });
  } catch (error) {
    console.error('Error fetching my picks:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/games/:id/picks/:gameweek - Get all picks for a gameweek
router.get('/picks/:gameweek', requireAuth, async (req, res) => {
  try {
    const gameId = req.params.id;
    const { gameweek } = req.params;
    const season = await getCurrentSeason(pool);

    // Check if deadline has passed (respect override for testing)
    const deadlineOverride = await isDeadlineOverridden(pool);
    const deadlineResult = await pool.query(
      `SELECT MIN(match_date) AS deadline
       FROM pl_fixtures
       WHERE gameweek = $1 AND season = $2
         AND match_date IS NOT NULL
         AND status != 'postponed'`,
      [gameweek, season]
    );

    const deadline = deadlineResult.rows[0]?.deadline;
    const deadlinePassed = deadlineOverride ? false : (deadline ? new Date(deadline) < new Date() : false);

    if (!deadlinePassed) {
      // Don't reveal picks before deadline
      return res.json({
        success: true,
        gameweek: parseInt(gameweek),
        deadlinePassed: false,
        picks: [],
        message: 'Picks are hidden until the deadline passes'
      });
    }

    const result = await pool.query(
      `SELECT p.pick_id, p.gameweek, p.result,
              gp.username, gp.user_email, gp.status AS player_status,
              t.name AS team_name, t.short_name AS team_short, t.crest_url
       FROM picks p
       JOIN game_players gp ON p.game_player_id = gp.player_id
       JOIN pl_teams t ON p.pl_team_id = t.team_id
       WHERE p.game_id = $1 AND p.gameweek = $2
       ORDER BY gp.username`,
      [gameId, gameweek]
    );

    res.json({
      success: true,
      gameweek: parseInt(gameweek),
      deadlinePassed: true,
      picks: result.rows
    });
  } catch (error) {
    console.error('Error fetching gameweek picks:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/games/:id/picks - Submit or update pick for current gameweek
router.post('/picks', requireAuth, async (req, res) => {
  try {
    const gameId = req.params.id;
    const { plTeamId } = req.body;

    if (!plTeamId) {
      return res.status(400).json({ success: false, error: 'plTeamId is required' });
    }

    const season = await getCurrentSeason(pool);

    // Use gameweek override if set (testing mode), otherwise auto-detect
    const gwOverride = await getGameweekOverride(pool);
    let currentGameweek;
    if (gwOverride != null) {
      currentGameweek = gwOverride;
    } else {
      const detected = await autoDetectGameweek(pool, season);
      currentGameweek = detected != null ? detected : await getCurrentGameweek(pool);
    }

    // 1. Check game exists and is active
    const gameResult = await pool.query('SELECT * FROM games WHERE game_id = $1', [gameId]);
    if (gameResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Game not found' });
    }
    const game = gameResult.rows[0];

    if (game.status !== 'active') {
      return res.status(400).json({ success: false, error: 'Game is not active' });
    }

    if (currentGameweek < game.start_gameweek) {
      return res.status(400).json({ success: false, error: `Game hasn't started yet (starts GW${game.start_gameweek})` });
    }

    // 2. Check user is a player and alive
    const playerResult = await pool.query(
      'SELECT * FROM game_players WHERE game_id = $1 AND user_email = $2',
      [gameId, req.session.email]
    );
    if (playerResult.rows.length === 0) {
      return res.status(403).json({ success: false, error: 'You are not in this game' });
    }
    const player = playerResult.rows[0];

    if (player.status !== 'alive') {
      return res.status(400).json({ success: false, error: 'You have been eliminated from this game' });
    }

    // 3. Check deadline hasn't passed (skip if deadline override is on)
    const deadlineOverride = await isDeadlineOverridden(pool);
    if (!deadlineOverride) {
      const deadlineResult = await pool.query(
        `SELECT MIN(match_date) AS deadline
         FROM pl_fixtures
         WHERE gameweek = $1 AND season = $2
           AND match_date IS NOT NULL
           AND status != 'postponed'`,
        [currentGameweek, season]
      );
      const deadline = deadlineResult.rows[0]?.deadline;
      if (deadline && new Date(deadline) < new Date()) {
        return res.status(400).json({ success: false, error: 'Deadline has passed for this gameweek' });
      }
    }

    // 4. Check team has a fixture this gameweek
    const fixtureResult = await pool.query(
      `SELECT fixture_id FROM pl_fixtures
       WHERE (home_team_id = $1 OR away_team_id = $1)
         AND gameweek = $2 AND season = $3`,
      [plTeamId, currentGameweek, season]
    );
    if (fixtureResult.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'This team does not have a fixture this gameweek' });
    }

    // 5. Check team hasn't been used before (unless all 20 used)
    const usedTeamsResult = await pool.query(
      `SELECT DISTINCT pl_team_id FROM picks
       WHERE game_player_id = $1 AND game_id = $2`,
      [player.player_id, gameId]
    );
    const usedTeamIds = usedTeamsResult.rows.map(r => r.pl_team_id);

    // Check if they're updating their current pick for this gameweek
    const existingPickResult = await pool.query(
      `SELECT pl_team_id FROM picks
       WHERE game_player_id = $1 AND game_id = $2 AND gameweek = $3`,
      [player.player_id, gameId, currentGameweek]
    );
    const currentPickTeamId = existingPickResult.rows[0]?.pl_team_id;

    // Filter out the current gameweek's pick from "used" list (since they're replacing it)
    const usedExcludingCurrent = usedTeamIds.filter(id => id !== currentPickTeamId);

    const totalTeamsResult = await pool.query(
      'SELECT COUNT(*) AS count FROM pl_teams WHERE season = $1',
      [season]
    );
    const totalTeams = parseInt(totalTeamsResult.rows[0].count);

    if (usedExcludingCurrent.includes(plTeamId) && usedExcludingCurrent.length < totalTeams) {
      return res.status(400).json({ success: false, error: 'You have already used this team' });
    }

    // 6. Upsert pick
    const pickResult = await pool.query(
      `INSERT INTO picks (game_id, game_player_id, gameweek, pl_team_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (game_id, game_player_id, gameweek) DO UPDATE SET
         pl_team_id = EXCLUDED.pl_team_id, created_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [gameId, player.player_id, currentGameweek, plTeamId]
    );

    // Get team name for response
    const teamResult = await pool.query('SELECT name, short_name FROM pl_teams WHERE team_id = $1', [plTeamId]);

    res.json({
      success: true,
      pick: {
        ...pickResult.rows[0],
        team_name: teamResult.rows[0]?.name,
        team_short: teamResult.rows[0]?.short_name
      },
      message: `Pick submitted: ${teamResult.rows[0]?.name}`
    });
  } catch (error) {
    console.error('Error submitting pick:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/games/:id/picks/:gameweek/:playerEmail - Delete a specific pick (admin only)
router.delete('/picks/:gameweek/:playerEmail', requireAdmin, async (req, res) => {
  try {
    const gameId = req.params.id;
    const { gameweek, playerEmail } = req.params;

    // Look up game player
    const playerResult = await pool.query(
      'SELECT player_id, username FROM game_players WHERE game_id = $1 AND user_email = $2',
      [gameId, playerEmail]
    );
    if (playerResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Player not found in this game' });
    }

    const result = await pool.query(
      `DELETE FROM picks WHERE game_id = $1 AND game_player_id = $2 AND gameweek = $3 RETURNING *`,
      [gameId, playerResult.rows[0].player_id, gameweek]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No pick found for this player/gameweek' });
    }

    res.json({
      success: true,
      message: `Deleted ${playerResult.rows[0].username}'s pick for GW${gameweek}`
    });
  } catch (error) {
    console.error('Error deleting pick:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/games/:id/process-results - Process results for a gameweek (admin only)
router.post('/process-results', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const gameId = req.params.id;
    const { gameweek } = req.body;

    if (!gameweek) {
      return res.status(400).json({ success: false, error: 'gameweek is required' });
    }

    const season = await getCurrentSeason(pool);

    await client.query('BEGIN');

    // 1. Get game info
    const gameResult = await client.query('SELECT * FROM games WHERE game_id = $1', [gameId]);
    if (gameResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Game not found' });
    }
    const game = gameResult.rows[0];

    if (game.status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Game is not active' });
    }

    // 2. Check all fixtures in this gameweek are finished
    const unfinishedResult = await client.query(
      `SELECT COUNT(*) AS count FROM pl_fixtures
       WHERE gameweek = $1 AND season = $2 AND status != 'finished'`,
      [gameweek, season]
    );
    if (parseInt(unfinishedResult.rows[0].count) > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: `${unfinishedResult.rows[0].count} fixtures still not finished in GW${gameweek}`
      });
    }

    // 3. Build team results map from fixtures
    const fixturesResult = await client.query(
      `SELECT home_team_id, away_team_id, home_score, away_score
       FROM pl_fixtures
       WHERE gameweek = $1 AND season = $2 AND status = 'finished'`,
      [gameweek, season]
    );

    const teamResults = {};
    for (const f of fixturesResult.rows) {
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

    // 4. Update pick results
    const picksResult = await client.query(
      `SELECT p.pick_id, p.game_player_id, p.pl_team_id
       FROM picks p
       WHERE p.game_id = $1 AND p.gameweek = $2`,
      [gameId, gameweek]
    );

    const eliminated = [];
    const survived = [];

    for (const pick of picksResult.rows) {
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

    // 5. Auto-eliminate players who didn't submit a pick
    const alivePlayers = await client.query(
      `SELECT player_id FROM game_players
       WHERE game_id = $1 AND status = 'alive'`,
      [gameId]
    );

    const playersWhoPicked = new Set(picksResult.rows.map(p => p.game_player_id));
    for (const player of alivePlayers.rows) {
      if (!playersWhoPicked.has(player.player_id)) {
        eliminated.push({ playerId: player.player_id, pickId: null });
      }
    }

    // 6. Mark eliminated players
    for (const e of eliminated) {
      await client.query(
        `UPDATE game_players
         SET status = 'eliminated', eliminated_gameweek = $1, eliminated_pick_id = $2
         WHERE player_id = $3 AND status = 'alive'`,
        [gameweek, e.pickId, e.playerId]
      );
    }

    // 7. Check for winner/draw
    const remainingResult = await client.query(
      `SELECT COUNT(*) AS count FROM game_players
       WHERE game_id = $1 AND status = 'alive'`,
      [gameId]
    );
    const remaining = parseInt(remainingResult.rows[0].count);

    let gameStatus = 'active';

    if (remaining === 1) {
      // Winner!
      const winnerResult = await client.query(
        `SELECT player_id FROM game_players
         WHERE game_id = $1 AND status = 'alive'`,
        [gameId]
      );
      await client.query(
        `UPDATE game_players SET status = 'winner' WHERE player_id = $1`,
        [winnerResult.rows[0].player_id]
      );
      await client.query(
        `UPDATE games SET status = 'completed', winner_player_id = $1 WHERE game_id = $2`,
        [winnerResult.rows[0].player_id, gameId]
      );
      gameStatus = 'completed';
    } else if (remaining === 0) {
      // Shared draw — the players eliminated THIS week share the draw
      for (const e of eliminated) {
        await client.query(
          `UPDATE game_players SET status = 'drawn' WHERE player_id = $1`,
          [e.playerId]
        );
      }
      await client.query(
        `UPDATE games SET status = 'completed', is_draw = TRUE WHERE game_id = $1`,
        [gameId]
      );
      gameStatus = 'completed';
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      gameweek: parseInt(gameweek),
      eliminated: eliminated.length,
      remaining,
      gameStatus,
      message: remaining === 0
        ? `Shared draw! All ${eliminated.length} remaining players eliminated.`
        : remaining === 1
        ? 'Game over! We have a winner!'
        : `${eliminated.length} eliminated, ${remaining} still alive.`
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing results:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

// POST /api/games/:id/update-standings - Recalculate standings from existing picks (game admin)
// Useful after manually amending picks. Resets all statuses and replays eliminations.
router.post('/update-standings', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const gameId = req.params.id;
    const { upToGameweek } = req.body;

    if (!upToGameweek) {
      return res.status(400).json({ success: false, error: 'upToGameweek is required' });
    }

    const season = await getCurrentSeason(pool);

    await client.query('BEGIN');

    // 1. Get game info
    const gameResult = await client.query('SELECT * FROM games WHERE game_id = $1', [gameId]);
    if (gameResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Game not found' });
    }
    const game = gameResult.rows[0];
    const startGw = game.start_gameweek || 1;

    // 2. Reset all players to alive
    await client.query(
      `UPDATE game_players SET status = 'alive', eliminated_gameweek = NULL, eliminated_pick_id = NULL
       WHERE game_id = $1`,
      [gameId]
    );

    // 3. Reset game status
    await client.query(
      `UPDATE games SET status = 'active', winner_player_id = NULL, is_draw = FALSE WHERE game_id = $1`,
      [gameId]
    );

    // 4. Clear all pick results for this game
    await client.query(
      `UPDATE picks SET result = NULL WHERE game_id = $1`,
      [gameId]
    );

    let totalEliminated = 0;
    let finalGameStatus = 'active';
    let lastProcessedGw = startGw;

    // 5. Replay each gameweek from start to upToGameweek
    for (let gw = startGw; gw <= upToGameweek; gw++) {
      // Check if any finished fixtures exist for this GW
      const fixturesResult = await client.query(
        `SELECT home_team_id, away_team_id, home_score, away_score
         FROM pl_fixtures
         WHERE gameweek = $1 AND season = $2 AND status = 'finished'`,
        [gw, season]
      );

      if (fixturesResult.rows.length === 0) continue; // Skip GWs with no finished fixtures
      lastProcessedGw = gw;

      // Build team results
      const teamResults = {};
      for (const f of fixturesResult.rows) {
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

      // Update pick results for this GW
      const picksResult = await client.query(
        `SELECT p.pick_id, p.game_player_id, p.pl_team_id
         FROM picks p
         WHERE p.game_id = $1 AND p.gameweek = $2`,
        [gameId, gw]
      );

      const eliminatedThisGw = [];

      for (const pick of picksResult.rows) {
        const result = teamResults[pick.pl_team_id] || null;
        if (result) {
          await client.query(
            'UPDATE picks SET result = $1 WHERE pick_id = $2',
            [result, pick.pick_id]
          );
        }

        // Check if player is still alive before eliminating
        const playerStatus = await client.query(
          `SELECT status FROM game_players WHERE player_id = $1`,
          [pick.game_player_id]
        );

        if (playerStatus.rows[0]?.status === 'alive' && result && result !== 'win') {
          eliminatedThisGw.push({ playerId: pick.game_player_id, pickId: pick.pick_id });
        }
      }

      // Auto-eliminate alive players who didn't pick this GW
      const alivePlayers = await client.query(
        `SELECT player_id FROM game_players WHERE game_id = $1 AND status = 'alive'`,
        [gameId]
      );
      const playersWhoPicked = new Set(picksResult.rows.map(p => p.game_player_id));
      for (const player of alivePlayers.rows) {
        if (!playersWhoPicked.has(player.player_id)) {
          eliminatedThisGw.push({ playerId: player.player_id, pickId: null });
        }
      }

      // Apply eliminations
      for (const e of eliminatedThisGw) {
        await client.query(
          `UPDATE game_players
           SET status = 'eliminated', eliminated_gameweek = $1, eliminated_pick_id = $2
           WHERE player_id = $3 AND status = 'alive'`,
          [gw, e.pickId, e.playerId]
        );
      }
      totalEliminated += eliminatedThisGw.length;

      // Check for winner/draw
      const remainingResult = await client.query(
        `SELECT COUNT(*) AS count FROM game_players WHERE game_id = $1 AND status = 'alive'`,
        [gameId]
      );
      const remaining = parseInt(remainingResult.rows[0].count);

      if (remaining === 1) {
        const winnerResult = await client.query(
          `SELECT player_id FROM game_players WHERE game_id = $1 AND status = 'alive'`,
          [gameId]
        );
        await client.query(
          `UPDATE game_players SET status = 'winner' WHERE player_id = $1`,
          [winnerResult.rows[0].player_id]
        );
        await client.query(
          `UPDATE games SET status = 'completed', winner_player_id = $1 WHERE game_id = $2`,
          [winnerResult.rows[0].player_id, gameId]
        );
        finalGameStatus = 'completed';
        break;
      } else if (remaining === 0) {
        for (const e of eliminatedThisGw) {
          await client.query(
            `UPDATE game_players SET status = 'drawn' WHERE player_id = $1`,
            [e.playerId]
          );
        }
        await client.query(
          `UPDATE games SET status = 'completed', is_draw = TRUE WHERE game_id = $1`,
          [gameId]
        );
        finalGameStatus = 'completed';
        break;
      }
    }

    // Final count
    const finalRemaining = await client.query(
      `SELECT COUNT(*) AS count FROM game_players WHERE game_id = $1 AND status = 'alive'`,
      [gameId]
    );
    const remaining = parseInt(finalRemaining.rows[0].count);

    await client.query('COMMIT');

    res.json({
      success: true,
      totalEliminated,
      remaining,
      gameStatus: finalGameStatus,
      message: `Standings recalculated (GW${startGw}-${upToGameweek}). ${totalEliminated} eliminated, ${remaining} alive.`
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating standings:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;
