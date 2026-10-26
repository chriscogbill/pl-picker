const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { requireAdmin } = require('../middleware/requireAuth');
const { getCurrentSeason, autoDetectGameweek, updateSetting, isDeadlineOverridden } = require('../helpers/settings');

// GET /api/teams - List PL teams for current season
router.get('/teams', async (req, res) => {
  try {
    const season = req.query.season || await getCurrentSeason(pool);
    const result = await pool.query(
      `SELECT team_id, name, short_name, api_id, crest_url, season
       FROM pl_teams
       WHERE season = $1
       ORDER BY name`,
      [season]
    );
    res.json({ success: true, teams: result.rows });
  } catch (error) {
    console.error('Error fetching teams:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/fixtures/:gameweek - Get fixtures for a specific gameweek
router.get('/:gameweek', async (req, res) => {
  try {
    const { gameweek } = req.params;
    const season = req.query.season || await getCurrentSeason(pool);

    const result = await pool.query(
      `SELECT f.fixture_id, f.season, f.gameweek,
              f.home_team_id, ht.name AS home_team, ht.short_name AS home_short,
              f.away_team_id, at.name AS away_team, at.short_name AS away_short,
              f.match_date, f.home_score, f.away_score, f.status
       FROM pl_fixtures f
       JOIN pl_teams ht ON f.home_team_id = ht.team_id
       JOIN pl_teams at ON f.away_team_id = at.team_id
       WHERE f.gameweek = $1 AND f.season = $2
       ORDER BY f.match_date`,
      [gameweek, season]
    );

    res.json({ success: true, fixtures: result.rows });
  } catch (error) {
    console.error('Error fetching fixtures:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/fixtures/:gameweek/deadline - Get deadline (earliest kickoff) for gameweek
router.get('/:gameweek/deadline', async (req, res) => {
  try {
    const { gameweek } = req.params;
    const season = req.query.season || await getCurrentSeason(pool);

    const result = await pool.query(
      `SELECT MIN(match_date) AS deadline
       FROM pl_fixtures
       WHERE gameweek = $1 AND season = $2
         AND match_date IS NOT NULL
         AND status != 'postponed'`,
      [gameweek, season]
    );

    const deadline = result.rows[0]?.deadline;
    const deadlineOverride = await isDeadlineOverridden(pool);
    res.json({
      success: true,
      gameweek: parseInt(gameweek),
      deadline,
      isPast: deadlineOverride ? false : (deadline ? new Date(deadline) < new Date() : null)
    });
  } catch (error) {
    console.error('Error fetching deadline:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/fixtures/import - Import fixtures from football-data.org (admin only)
router.post('/import', requireAdmin, async (req, res) => {
  try {
    const apiKey = process.env.FOOTBALL_DATA_API_KEY;
    if (!apiKey || apiKey === 'your-key-here' || apiKey === 'your-api-key-here') {
      return res.status(400).json({ success: false, error: 'FOOTBALL_DATA_API_KEY not configured' });
    }

    const season = req.body.season || await getCurrentSeason(pool);
    const upcomingOnly = req.body.upcomingOnly !== false; // default true
    const headers = { 'X-Auth-Token': apiKey };

    // Fetch teams (always import all teams)
    const teamsResponse = await fetch(`https://api.football-data.org/v4/competitions/PL/teams?season=${season}`, { headers });
    if (!teamsResponse.ok) {
      const errorText = await teamsResponse.text();
      return res.status(teamsResponse.status).json({ success: false, error: `Football-data API error: ${errorText}` });
    }
    const teamsData = await teamsResponse.json();

    let teamsImported = 0;
    for (const team of teamsData.teams) {
      await pool.query(
        `INSERT INTO pl_teams (name, short_name, api_id, crest_url, season)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (short_name, season) DO UPDATE SET
           name = EXCLUDED.name, api_id = EXCLUDED.api_id, crest_url = EXCLUDED.crest_url`,
        [team.name, team.tla, team.id, team.crest, season]
      );
      teamsImported++;
    }

    // Determine which gameweeks to import
    let currentGw = null;
    if (upcomingOnly) {
      currentGw = await autoDetectGameweek(pool, season);
      // If we can't detect, fall back to importing everything
    }

    // Fetch fixtures — use matchday filter if importing upcoming only and we know the current GW
    let matchesUrl = `https://api.football-data.org/v4/competitions/PL/matches?season=${season}`;
    if (upcomingOnly && currentGw) {
      // Import current GW + next 2 GWs (covers the immediate upcoming period)
      const fromGw = Math.max(1, currentGw);
      const toGw = Math.min(38, currentGw + 2);
      matchesUrl += `&matchday=${fromGw}`;
      // football-data.org only supports single matchday filter, so fetch range by looping
    }

    // For upcoming-only with known GW, fetch just a few gameweeks
    let allMatches = [];
    if (upcomingOnly && currentGw) {
      const fromGw = Math.max(1, currentGw);
      const toGw = Math.min(38, currentGw + 2);
      for (let gw = fromGw; gw <= toGw; gw++) {
        const gwUrl = `https://api.football-data.org/v4/competitions/PL/matches?season=${season}&matchday=${gw}`;
        const gwResponse = await fetch(gwUrl, { headers });
        if (gwResponse.ok) {
          const gwData = await gwResponse.json();
          allMatches.push(...(gwData.matches || []));
        }
      }
    } else {
      // Full season import
      const matchesResponse = await fetch(`https://api.football-data.org/v4/competitions/PL/matches?season=${season}`, { headers });
      if (!matchesResponse.ok) {
        const errorText = await matchesResponse.text();
        return res.status(matchesResponse.status).json({ success: false, error: `Football-data API error: ${errorText}` });
      }
      const matchesData = await matchesResponse.json();
      allMatches = matchesData.matches || [];
    }

    let fixturesImported = 0;
    for (const match of allMatches) {
      // Look up team IDs by api_id
      const homeTeam = await pool.query(
        'SELECT team_id FROM pl_teams WHERE api_id = $1 AND season = $2',
        [match.homeTeam.id, season]
      );
      const awayTeam = await pool.query(
        'SELECT team_id FROM pl_teams WHERE api_id = $1 AND season = $2',
        [match.awayTeam.id, season]
      );

      if (homeTeam.rows.length === 0 || awayTeam.rows.length === 0) continue;

      const status = match.status === 'FINISHED' ? 'finished'
        : match.status === 'IN_PLAY' || match.status === 'PAUSED' ? 'in_play'
        : match.status === 'POSTPONED' ? 'postponed'
        : 'scheduled';

      await pool.query(
        `INSERT INTO pl_fixtures (season, gameweek, home_team_id, away_team_id, match_date, home_score, away_score, status, api_match_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (season, gameweek, home_team_id, away_team_id) DO UPDATE SET
           match_date = EXCLUDED.match_date, home_score = EXCLUDED.home_score,
           away_score = EXCLUDED.away_score, status = EXCLUDED.status,
           api_match_id = EXCLUDED.api_match_id, updated_at = CURRENT_TIMESTAMP`,
        [
          season,
          match.matchday,
          homeTeam.rows[0].team_id,
          awayTeam.rows[0].team_id,
          match.utcDate,
          match.score?.fullTime?.home ?? null,
          match.score?.fullTime?.away ?? null,
          status,
          match.id
        ]
      );
      fixturesImported++;
    }

    // Auto-update current_season and current_gameweek settings
    await updateSetting(pool, 'current_season', season);
    const detectedGw = await autoDetectGameweek(pool, season);
    if (detectedGw != null) {
      await updateSetting(pool, 'current_gameweek', detectedGw);
    }

    const gwRange = (upcomingOnly && currentGw)
      ? ` (GW${currentGw}-${Math.min(38, currentGw + 2)})`
      : ' (full season)';
    res.json({
      success: true,
      message: `Imported ${teamsImported} teams and ${fixturesImported} fixtures${gwRange} for season ${season}/${season + 1}`
    });
  } catch (error) {
    console.error('Error importing fixtures:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/fixtures/update-results - Fetch latest results from football-data.org (admin only)
router.post('/update-results', requireAdmin, async (req, res) => {
  try {
    const apiKey = process.env.FOOTBALL_DATA_API_KEY;
    if (!apiKey || apiKey === 'your-key-here' || apiKey === 'your-api-key-here') {
      return res.status(400).json({ success: false, error: 'FOOTBALL_DATA_API_KEY not configured' });
    }

    const season = req.body.season || await getCurrentSeason(pool);
    const headers = { 'X-Auth-Token': apiKey };

    // Fetch all matches for the season
    const matchesResponse = await fetch(`https://api.football-data.org/v4/competitions/PL/matches?season=${season}`, { headers });
    if (!matchesResponse.ok) {
      const errorText = await matchesResponse.text();
      return res.status(matchesResponse.status).json({ success: false, error: `Football-data API error: ${errorText}` });
    }
    const matchesData = await matchesResponse.json();

    let updated = 0;
    for (const match of matchesData.matches) {
      if (match.status !== 'FINISHED') continue;

      const result = await pool.query(
        `UPDATE pl_fixtures
         SET home_score = $1, away_score = $2, status = 'finished', updated_at = CURRENT_TIMESTAMP
         WHERE api_match_id = $3 AND status != 'finished'`,
        [match.score.fullTime.home, match.score.fullTime.away, match.id]
      );
      updated += result.rowCount;
    }

    // Auto-update current_gameweek after results update
    const detectedGw = await autoDetectGameweek(pool, season);
    if (detectedGw != null) {
      await updateSetting(pool, 'current_gameweek', detectedGw);
    }

    res.json({
      success: true,
      message: `Updated ${updated} fixture results`
    });
  } catch (error) {
    console.error('Error updating results:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
