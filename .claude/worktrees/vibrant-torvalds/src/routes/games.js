const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { requireAuth, requireAdmin, requireGameAdmin } = require('../middleware/requireAuth');
const { getCurrentSeason, getCurrentGameweek, getGameweekOverride, isDeadlineOverridden } = require('../helpers/settings');
const { ensureUserExists } = require('../helpers/userManager');
const picksRouter = require('./picks');

// Mount picks routes under /api/games/:id/
router.use('/:id', picksRouter);

// GET /api/games - List games
router.get('/', async (req, res) => {
  try {
    const season = req.query.season || await getCurrentSeason(pool);

    const result = await pool.query(
      `SELECT g.game_id, g.game_name, g.season, g.admin_email, g.start_gameweek,
              g.status, g.is_draw, g.created_at,
              COUNT(gp.player_id) AS player_count,
              COUNT(gp.player_id) FILTER (WHERE gp.status = 'alive') AS alive_count
       FROM games g
       LEFT JOIN game_players gp ON g.game_id = gp.game_id
       WHERE g.season = $1
       GROUP BY g.game_id
       ORDER BY g.status ASC, g.created_at DESC`,
      [season]
    );

    // If user is authenticated, add their membership info
    if (req.session?.email) {
      const memberResult = await pool.query(
        `SELECT game_id, status AS player_status
         FROM game_players
         WHERE user_email = $1`,
        [req.session.email]
      );
      const memberMap = {};
      memberResult.rows.forEach(r => { memberMap[r.game_id] = r.player_status; });

      result.rows.forEach(game => {
        game.user_status = memberMap[game.game_id] || null;
        game.is_member = !!memberMap[game.game_id];
      });
    }

    res.json({ success: true, games: result.rows });
  } catch (error) {
    console.error('Error fetching games:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/games/:id - Get game detail with players
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const gameResult = await pool.query(
      `SELECT * FROM games WHERE game_id = $1`,
      [id]
    );

    if (gameResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Game not found' });
    }

    const game = gameResult.rows[0];

    const playersResult = await pool.query(
      `SELECT gp.player_id, gp.user_email, gp.username, gp.status,
              gp.eliminated_gameweek, gp.joined_at,
              COUNT(p.pick_id) AS picks_made
       FROM game_players gp
       LEFT JOIN picks p ON gp.player_id = p.game_player_id
       WHERE gp.game_id = $1
       GROUP BY gp.player_id
       ORDER BY
         CASE gp.status
           WHEN 'winner' THEN 1
           WHEN 'alive' THEN 2
           WHEN 'drawn' THEN 3
           WHEN 'eliminated' THEN 4
         END,
         gp.eliminated_gameweek DESC NULLS FIRST`,
      [id]
    );

    // Only include invite_code if the user is the game admin
    const isAdmin = req.session?.email === game.admin_email || req.session?.role === 'admin';

    res.json({
      success: true,
      game: {
        ...game,
        invite_code: isAdmin ? game.invite_code : undefined
      },
      players: playersResult.rows
    });
  } catch (error) {
    console.error('Error fetching game:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/games - Create a new game
router.post('/', requireAuth, async (req, res) => {
  try {
    const { gameName, startGameweek } = req.body;

    if (!gameName) {
      return res.status(400).json({ success: false, error: 'gameName is required' });
    }

    const season = await getCurrentSeason(pool);
    const inviteCode = Math.random().toString(36).substring(2, 10).toUpperCase();

    const result = await pool.query(
      `INSERT INTO games (game_name, season, created_by_email, admin_email, invite_code, start_gameweek, status)
       VALUES ($1, $2, $3, $3, $4, $5, 'active')
       RETURNING *`,
      [gameName, season, req.session.email, inviteCode, startGameweek || 1]
    );

    const game = result.rows[0];

    // Auto-add the creator as a player
    await pool.query(
      `INSERT INTO game_players (game_id, user_email, username)
       VALUES ($1, $2, $3)`,
      [game.game_id, req.session.email, req.session.username || req.session.email]
    );

    res.status(201).json({
      success: true,
      game,
      message: `Game created! Share invite code: ${inviteCode}`
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, error: 'Invite code conflict, please try again' });
    }
    console.error('Error creating game:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/games/join - Join a game via invite code
router.post('/join', requireAuth, async (req, res) => {
  try {
    const { inviteCode } = req.body;

    if (!inviteCode) {
      return res.status(400).json({ success: false, error: 'inviteCode is required' });
    }

    const gameResult = await pool.query(
      'SELECT * FROM games WHERE invite_code = $1',
      [inviteCode.toUpperCase()]
    );

    if (gameResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Invalid invite code' });
    }

    const game = gameResult.rows[0];

    if (game.status !== 'open') {
      return res.status(400).json({ success: false, error: 'This game is no longer accepting players' });
    }

    // Check if already a member
    const existingResult = await pool.query(
      'SELECT * FROM game_players WHERE game_id = $1 AND user_email = $2',
      [game.game_id, req.session.email]
    );

    if (existingResult.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'You are already in this game' });
    }

    await pool.query(
      `INSERT INTO game_players (game_id, user_email, username)
       VALUES ($1, $2, $3)`,
      [game.game_id, req.session.email, req.session.username || req.session.email]
    );

    res.json({
      success: true,
      game_id: game.game_id,
      message: `Joined "${game.game_name}" successfully`
    });
  } catch (error) {
    console.error('Error joining game:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/games/:id/start - Start a game (game admin only)
router.post('/:id/start', requireAuth, requireGameAdmin(), async (req, res) => {
  try {
    const { id } = req.params;

    const gameResult = await pool.query('SELECT * FROM games WHERE game_id = $1', [id]);
    if (gameResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Game not found' });
    }

    const game = gameResult.rows[0];

    if (game.status !== 'open') {
      return res.status(400).json({ success: false, error: 'Game is not in open status' });
    }

    // Need at least 2 players
    const playerCount = await pool.query(
      'SELECT COUNT(*) AS count FROM game_players WHERE game_id = $1',
      [id]
    );

    if (parseInt(playerCount.rows[0].count) < 2) {
      return res.status(400).json({ success: false, error: 'Need at least 2 players to start a game' });
    }

    await pool.query(
      `UPDATE games SET status = 'active' WHERE game_id = $1`,
      [id]
    );

    res.json({
      success: true,
      message: 'Game started!'
    });
  } catch (error) {
    console.error('Error starting game:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/games/:id/standings - Get game standings
router.get('/:id/standings', async (req, res) => {
  try {
    const { id } = req.params;

    const gameResult = await pool.query('SELECT * FROM games WHERE game_id = $1', [id]);
    if (gameResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Game not found' });
    }

    const playersResult = await pool.query(
      `SELECT gp.player_id, gp.user_email, gp.username, gp.status,
              gp.eliminated_gameweek,
              COUNT(p.pick_id) AS picks_made,
              COUNT(DISTINCT p.pl_team_id) AS teams_used
       FROM game_players gp
       LEFT JOIN picks p ON gp.player_id = p.game_player_id
       WHERE gp.game_id = $1
       GROUP BY gp.player_id
       ORDER BY
         CASE gp.status
           WHEN 'winner' THEN 1
           WHEN 'alive' THEN 2
           WHEN 'drawn' THEN 3
           WHEN 'eliminated' THEN 4
         END,
         gp.eliminated_gameweek DESC NULLS FIRST`,
      [id]
    );

    res.json({
      success: true,
      game: gameResult.rows[0],
      standings: playersResult.rows
    });
  } catch (error) {
    console.error('Error fetching standings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/games/:id/history - Get pick history per gameweek (deadline-aware)
router.get('/:id/history', async (req, res) => {
  try {
    const { id } = req.params;
    const season = await getCurrentSeason(pool);
    const requestingUser = req.session?.email;
    const requestingRole = req.session?.role;

    // Use gameweek override if set (testing mode), otherwise auto-detect
    const gwOverride = await getGameweekOverride(pool);
    let currentGameweek;
    if (gwOverride != null) {
      currentGameweek = gwOverride;
    } else {
      currentGameweek = await getCurrentGameweek(pool);
      // Also try auto-detect from fixtures
      const { autoDetectGameweek } = require('../helpers/settings');
      const detected = await autoDetectGameweek(pool, season);
      if (detected != null) currentGameweek = detected;
    }

    // Check deadline override (testing mode)
    const deadlineOverride = await isDeadlineOverridden(pool);

    // Get the game to know the start_gameweek and admin
    const gameResult = await pool.query('SELECT start_gameweek, admin_email FROM games WHERE game_id = $1', [id]);
    if (gameResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Game not found' });
    }
    const startGw = gameResult.rows[0].start_gameweek;
    const isGameAdmin = requestingUser === gameResult.rows[0].admin_email || requestingRole === 'admin';

    // Get deadlines for all gameweeks that have fixtures. Postponed fixtures
    // are excluded — their match_date is often a stale pre-postponement kickoff
    // and would falsely anchor the deadline earlier than it really was.
    const deadlinesResult = await pool.query(
      `SELECT gameweek, MIN(match_date) AS deadline
       FROM pl_fixtures
       WHERE season = $1
         AND match_date IS NOT NULL
         AND status != 'postponed'
       GROUP BY gameweek
       ORDER BY gameweek`,
      [season]
    );
    const deadlines = {};
    deadlinesResult.rows.forEach(row => {
      deadlines[row.gameweek] = row.deadline;
    });

    // Get all picks for this game
    const result = await pool.query(
      `SELECT p.pick_id, p.gameweek, p.result,
              gp.player_id, gp.username, gp.user_email, gp.status AS player_status,
              t.name AS team_name, t.short_name AS team_short
       FROM picks p
       JOIN game_players gp ON p.game_player_id = gp.player_id
       JOIN pl_teams t ON p.pl_team_id = t.team_id
       WHERE p.game_id = $1
       ORDER BY p.gameweek, gp.username`,
      [id]
    );

    // Group by gameweek, applying deadline visibility
    const history = {};
    const now = new Date();

    result.rows.forEach(row => {
      const gw = row.gameweek;
      if (!history[gw]) {
        const deadline = deadlines[gw];
        // If deadline override is on, treat all deadlines as NOT passed
        const deadlinePassed = deadlineOverride ? false : (deadline ? new Date(deadline) < now : false);
        history[gw] = { deadlinePassed, picks: [] };
      }

      const isOwnPick = row.user_email === requestingUser;

      if (history[gw].deadlinePassed || isOwnPick || isGameAdmin) {
        // Show the pick (team visible)
        history[gw].picks.push({
          pick_id: row.pick_id,
          player_id: row.player_id,
          username: row.username,
          user_email: row.user_email,
          team_name: row.team_name,
          team_short: row.team_short,
          result: row.result,
        });
      } else {
        // Deadline not passed and not own pick: hide team but show that a pick was made
        history[gw].picks.push({
          pick_id: row.pick_id,
          player_id: row.player_id,
          username: row.username,
          user_email: row.user_email,
          team_name: null,
          team_short: null,
          result: null,
          hidden: true,
        });
      }
    });

    res.json({
      success: true,
      history,
      currentGameweek,
      startGameweek: startGw,
    });
  } catch (error) {
    console.error('Error fetching game history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/games/:id - Delete a game (game admin or site admin only)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const gameResult = await pool.query('SELECT * FROM games WHERE game_id = $1', [id]);
    if (gameResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Game not found' });
    }

    const game = gameResult.rows[0];

    // Only game admin or site admin can delete
    if (req.session.email !== game.admin_email && req.session.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Only the game admin can delete this game' });
    }

    // CASCADE handles picks and game_players
    await pool.query('DELETE FROM games WHERE game_id = $1', [id]);

    res.json({
      success: true,
      message: `Game "${game.game_name}" deleted successfully`
    });
  } catch (error) {
    console.error('Error deleting game:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/games/:id/add-player - Add a player to a game (game admin only)
router.post('/:id/add-player', requireAuth, requireGameAdmin(), async (req, res) => {
  try {
    const { id } = req.params;
    const { email, username } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'email is required' });
    }

    // Check if already a member
    const existing = await pool.query(
      'SELECT * FROM game_players WHERE game_id = $1 AND user_email = $2',
      [id, email]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'Player is already in this game' });
    }

    // Ensure user account exists (auto-creates if needed)
    const authPool = req.app.locals.authPool;
    const userInfo = await ensureUserExists(authPool, pool, email, username);
    const playerUsername = username || userInfo.username;

    const result = await pool.query(
      `INSERT INTO game_players (game_id, user_email, username)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, email.trim().toLowerCase(), playerUsername]
    );

    const msg = userInfo.created
      ? `Added ${playerUsername} to the game (account created — they'll need to set a password)`
      : `Added ${playerUsername} to the game`;

    res.status(201).json({
      success: true,
      player: result.rows[0],
      message: msg
    });
  } catch (error) {
    console.error('Error adding player:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/games/:id/import-pick - Import a pick for a player (game admin only, for retrospective entry)
router.post('/:id/import-pick', requireAuth, requireGameAdmin(), async (req, res) => {
  try {
    const { id } = req.params;
    const { playerEmail, gameweek, teamShortName } = req.body;

    if (!playerEmail || !gameweek || !teamShortName) {
      return res.status(400).json({ success: false, error: 'playerEmail, gameweek, and teamShortName are required' });
    }

    const season = await getCurrentSeason(pool);

    // Look up player
    const playerResult = await pool.query(
      'SELECT player_id, username FROM game_players WHERE game_id = $1 AND user_email = $2',
      [id, playerEmail]
    );
    if (playerResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Player not found in this game' });
    }
    const player = playerResult.rows[0];

    // Look up team
    const teamResult = await pool.query(
      'SELECT team_id, name FROM pl_teams WHERE short_name = $1 AND season = $2',
      [teamShortName.toUpperCase(), season]
    );
    if (teamResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: `Team "${teamShortName}" not found for season ${season}` });
    }
    const team = teamResult.rows[0];

    // Check if team's fixture exists and determine result
    const fixtureResult = await pool.query(
      `SELECT home_team_id, away_team_id, home_score, away_score, status
       FROM pl_fixtures
       WHERE (home_team_id = $1 OR away_team_id = $1) AND gameweek = $2 AND season = $3`,
      [team.team_id, gameweek, season]
    );

    let result = null;
    if (fixtureResult.rows.length > 0 && fixtureResult.rows[0].status === 'finished') {
      const f = fixtureResult.rows[0];
      const isHome = f.home_team_id === team.team_id;
      if (f.home_score > f.away_score) {
        result = isHome ? 'win' : 'loss';
      } else if (f.home_score < f.away_score) {
        result = isHome ? 'loss' : 'win';
      } else {
        result = 'draw';
      }
    }

    // Upsert pick
    const pickResult = await pool.query(
      `INSERT INTO picks (game_id, game_player_id, gameweek, pl_team_id, result)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (game_id, game_player_id, gameweek) DO UPDATE SET
         pl_team_id = EXCLUDED.pl_team_id, result = EXCLUDED.result, created_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [id, player.player_id, gameweek, team.team_id, result]
    );

    // If the result is a loss or draw, eliminate the player
    let statusChanged = false;
    if (result && result !== 'win') {
      const updateResult = await pool.query(
        `UPDATE game_players
         SET status = 'eliminated', eliminated_gameweek = $1, eliminated_pick_id = $2
         WHERE player_id = $3 AND status = 'alive'
         RETURNING player_id`,
        [gameweek, pickResult.rows[0].pick_id, player.player_id]
      );
      statusChanged = updateResult.rows.length > 0;
    }

    res.json({
      success: true,
      pick: pickResult.rows[0],
      eliminated: statusChanged,
      message: `Imported pick: ${player.username} → ${team.name} (GW${gameweek})${result ? ` [${result}]` : ''}${statusChanged ? ' — player eliminated' : ''}`
    });
  } catch (error) {
    console.error('Error importing pick:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/games/:id/bulk-import - Bulk import players and picks (game admin only)
router.post('/:id/bulk-import', requireAuth, requireGameAdmin(), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { rows: importRows, gameweeks } = req.body;

    if (!importRows || !Array.isArray(importRows) || importRows.length === 0) {
      return res.status(400).json({ success: false, error: 'rows array is required' });
    }
    if (!gameweeks || !Array.isArray(gameweeks)) {
      return res.status(400).json({ success: false, error: 'gameweeks array is required' });
    }

    const season = await getCurrentSeason(pool);

    // Get all team short names for lookup
    const teamsResult = await pool.query(
      'SELECT team_id, short_name, name FROM pl_teams WHERE season = $1',
      [season]
    );
    const teamLookup = {};
    teamsResult.rows.forEach(t => {
      teamLookup[t.short_name.toUpperCase()] = t;
    });

    await client.query('BEGIN');

    const results = [];

    for (const row of importRows) {
      const { email, username, picks } = row;
      if (!email) continue;

      const trimmedEmail = email.trim().toLowerCase();
      let playerUsername = username?.trim();

      // Check if player already exists in the game
      let playerResult = await client.query(
        'SELECT player_id, username FROM game_players WHERE game_id = $1 AND user_email = $2',
        [id, trimmedEmail]
      );

      if (playerResult.rows.length === 0) {
        // Ensure user account exists (auto-creates if needed)
        const authPool = req.app.locals.authPool;
        const userInfo = await ensureUserExists(authPool, pool, trimmedEmail, playerUsername);
        if (!playerUsername) {
          playerUsername = userInfo.username;
        }

        // Add player to game
        playerResult = await client.query(
          `INSERT INTO game_players (game_id, user_email, username) VALUES ($1, $2, $3) RETURNING player_id, username`,
          [id, trimmedEmail, playerUsername]
        );
      } else {
        playerUsername = playerResult.rows[0].username;
      }

      const playerId = playerResult.rows[0].player_id;
      let picksImported = 0;

      // Import picks for each gameweek
      if (picks && typeof picks === 'object') {
        for (const [gwStr, teamShort] of Object.entries(picks)) {
          const gw = parseInt(gwStr);
          const teamCode = (teamShort || '').trim().toUpperCase();
          if (!teamCode || !gw) continue;

          const team = teamLookup[teamCode];
          if (!team) {
            results.push({ email: trimmedEmail, error: `Unknown team "${teamShort}" for GW${gw}` });
            continue;
          }

          // Check fixture and determine result
          const fixtureResult = await client.query(
            `SELECT home_team_id, away_team_id, home_score, away_score, status
             FROM pl_fixtures
             WHERE (home_team_id = $1 OR away_team_id = $1) AND gameweek = $2 AND season = $3`,
            [team.team_id, gw, season]
          );

          let result = null;
          if (fixtureResult.rows.length > 0 && fixtureResult.rows[0].status === 'finished') {
            const f = fixtureResult.rows[0];
            const isHome = f.home_team_id === team.team_id;
            if (f.home_score > f.away_score) {
              result = isHome ? 'win' : 'loss';
            } else if (f.home_score < f.away_score) {
              result = isHome ? 'loss' : 'win';
            } else {
              result = 'draw';
            }
          }

          // Upsert pick
          await client.query(
            `INSERT INTO picks (game_id, game_player_id, gameweek, pl_team_id, result)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (game_id, game_player_id, gameweek) DO UPDATE SET
               pl_team_id = EXCLUDED.pl_team_id, result = EXCLUDED.result, created_at = CURRENT_TIMESTAMP`,
            [id, playerId, gw, team.team_id, result]
          );
          picksImported++;
        }
      }

      results.push({ email: trimmedEmail, username: playerUsername, picksImported });
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      results,
      message: `Imported ${results.filter(r => !r.error).length} players with picks`
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error in bulk import:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

// POST /api/games/:id/set-player-status - Update a player's status (game admin only)
router.post('/:id/set-player-status', requireAuth, requireGameAdmin(), async (req, res) => {
  try {
    const { id } = req.params;
    const { playerEmail, status, eliminatedGameweek } = req.body;

    if (!playerEmail || !status) {
      return res.status(400).json({ success: false, error: 'playerEmail and status are required' });
    }

    const validStatuses = ['alive', 'eliminated', 'winner', 'drawn'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const updateFields = ['status = $1'];
    const values = [status, id, playerEmail];
    let paramIndex = 4;

    if (status === 'eliminated' && eliminatedGameweek) {
      updateFields.push(`eliminated_gameweek = $${paramIndex}`);
      values.push(eliminatedGameweek);
      paramIndex++;
    } else if (status === 'alive') {
      updateFields.push('eliminated_gameweek = NULL', 'eliminated_pick_id = NULL');
    }

    const result = await pool.query(
      `UPDATE game_players SET ${updateFields.join(', ')}
       WHERE game_id = $2 AND user_email = $3
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Player not found in this game' });
    }

    res.json({
      success: true,
      player: result.rows[0],
      message: `${result.rows[0].username} status set to ${status}`
    });
  } catch (error) {
    console.error('Error updating player status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/games/:id/transfer-admin - Transfer game admin to another player (game admin only)
router.post('/:id/transfer-admin', requireAuth, requireGameAdmin(), async (req, res) => {
  try {
    const { id } = req.params;
    const { newAdminEmail } = req.body;

    if (!newAdminEmail) {
      return res.status(400).json({ success: false, error: 'newAdminEmail is required' });
    }

    // Verify the new admin is a player in this game
    const playerCheck = await pool.query(
      'SELECT * FROM game_players WHERE game_id = $1 AND user_email = $2',
      [id, newAdminEmail]
    );

    if (playerCheck.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'That email is not a player in this game' });
    }

    await pool.query(
      'UPDATE games SET admin_email = $1 WHERE game_id = $2',
      [newAdminEmail, id]
    );

    res.json({
      success: true,
      message: `Game admin transferred to ${playerCheck.rows[0].username || newAdminEmail}`
    });
  } catch (error) {
    console.error('Error transferring admin:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
