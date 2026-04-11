async function getCurrentSeason(pool) {
  const result = await pool.query(
    "SELECT setting_value FROM app_settings WHERE setting_key = 'current_season'"
  );
  return parseInt(result.rows[0]?.setting_value) || 2024;
}

async function getCurrentGameweek(pool) {
  const result = await pool.query(
    "SELECT setting_value FROM app_settings WHERE setting_key = 'current_gameweek'"
  );
  return parseInt(result.rows[0]?.setting_value) || 1;
}

/**
 * Check if the gameweek override is set.
 * Returns the override value (integer) or null if not set.
 */
async function getGameweekOverride(pool) {
  const result = await pool.query(
    "SELECT setting_value FROM app_settings WHERE setting_key = 'gameweek_override'"
  );
  const val = result.rows[0]?.setting_value;
  if (val && val !== '' && val !== '0') {
    return parseInt(val);
  }
  return null;
}

/**
 * Check if deadline override is enabled.
 * When true, all deadlines are treated as NOT passed (for testing).
 */
async function isDeadlineOverridden(pool) {
  const result = await pool.query(
    "SELECT setting_value FROM app_settings WHERE setting_key = 'deadline_override'"
  );
  return result.rows[0]?.setting_value === 'true';
}

// Auto-detect current gameweek from fixture dates
// Returns the earliest gameweek with unfinished matches, or null if no fixtures exist.
// Postponed fixtures are ignored: a postponed match (often with a stale original
// match_date) must not keep its original gameweek "active" indefinitely.
async function autoDetectGameweek(pool, season) {
  const result = await pool.query(
    `SELECT MIN(gameweek) AS current_gw
     FROM pl_fixtures
     WHERE season = $1 AND status NOT IN ('finished', 'postponed')`,
    [season]
  );

  if (result.rows[0]?.current_gw != null) {
    return result.rows[0].current_gw;
  }

  // If all matches are finished, check if there are any fixtures at all
  const countResult = await pool.query(
    'SELECT COUNT(*) AS total FROM pl_fixtures WHERE season = $1',
    [season]
  );

  if (parseInt(countResult.rows[0].total) > 0) {
    // All fixtures finished — return the last gameweek
    const lastGw = await pool.query(
      'SELECT MAX(gameweek) AS last_gw FROM pl_fixtures WHERE season = $1',
      [season]
    );
    return lastGw.rows[0].last_gw;
  }

  // No fixtures at all — can't auto-detect
  return null;
}

// Update a setting in the database
async function updateSetting(pool, key, value) {
  await pool.query(
    `UPDATE app_settings SET setting_value = $1, updated_at = CURRENT_TIMESTAMP WHERE setting_key = $2`,
    [String(value), key]
  );
}

module.exports = { getCurrentSeason, getCurrentGameweek, autoDetectGameweek, updateSetting, getGameweekOverride, isDeadlineOverridden };
