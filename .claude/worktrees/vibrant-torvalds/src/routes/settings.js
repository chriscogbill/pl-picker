const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { requireAdmin } = require('../middleware/requireAuth');
const { getCurrentSeason, autoDetectGameweek, getGameweekOverride, isDeadlineOverridden } = require('../helpers/settings');

// GET /api/settings - Get all settings (with auto-detected gameweek)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT setting_key, setting_value, description, updated_at
       FROM app_settings
       ORDER BY setting_key`
    );

    const settings = {};
    result.rows.forEach(row => {
      settings[row.setting_key] = {
        value: row.setting_value,
        description: row.description,
        updated_at: row.updated_at
      };
    });

    // Check for gameweek override first (testing mode)
    const gwOverride = await getGameweekOverride(pool);
    if (gwOverride != null) {
      settings.current_gameweek.value = String(gwOverride);
    } else {
      // Auto-detect gameweek from fixture dates if fixtures exist
      const season = parseInt(settings.current_season?.value) || 2024;
      const detectedGw = await autoDetectGameweek(pool, season);
      if (detectedGw != null) {
        settings.current_gameweek.value = String(detectedGw);
      }
    }

    // Include override/testing flags in response
    const deadlineOvr = await isDeadlineOverridden(pool);
    settings._testing = {
      value: JSON.stringify({
        gameweekOverride: gwOverride,
        deadlineOverride: deadlineOvr,
      })
    };

    res.json({ success: true, settings });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/settings/:key - Get specific setting
router.get('/:key', async (req, res) => {
  try {
    const { key } = req.params;

    const result = await pool.query(
      `SELECT setting_value, description, updated_at
       FROM app_settings
       WHERE setting_key = $1`,
      [key]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Setting not found' });
    }

    let value = result.rows[0].setting_value;

    // Auto-detect gameweek from fixture dates (or use override)
    if (key === 'current_gameweek') {
      const gwOverride = await getGameweekOverride(pool);
      if (gwOverride != null) {
        value = String(gwOverride);
      } else {
        const season = await getCurrentSeason(pool);
        const detectedGw = await autoDetectGameweek(pool, season);
        if (detectedGw != null) {
          value = String(detectedGw);
        }
      }
    }

    res.json({
      success: true,
      key,
      value,
      description: result.rows[0].description,
      updated_at: result.rows[0].updated_at
    });
  } catch (error) {
    console.error('Error fetching setting:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/settings/:key - Update setting (admin only)
// Creates the setting if it doesn't exist (upsert)
router.put('/:key', requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined || value === null) {
      return res.status(400).json({ success: false, error: 'value is required' });
    }

    const result = await pool.query(
      `INSERT INTO app_settings (setting_key, setting_value)
       VALUES ($1, $2)
       ON CONFLICT (setting_key) DO UPDATE SET
         setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [key, String(value)]
    );

    res.json({
      success: true,
      message: `Setting '${key}' updated successfully`,
      setting: {
        key: result.rows[0].setting_key,
        value: result.rows[0].setting_value,
        description: result.rows[0].description,
        updated_at: result.rows[0].updated_at
      }
    });
  } catch (error) {
    console.error('Error updating setting:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
