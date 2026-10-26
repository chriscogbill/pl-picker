const pool = require('../db/connection');

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      error: 'Not authenticated'
    });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      error: 'Not authenticated'
    });
  }

  if (req.session.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Admin access required'
    });
  }

  next();
}

// Verifies the authenticated user is the admin of a specific game.
// Reads game_id from req.params.id
function requireGameAdmin() {
  return async (req, res, next) => {
    if (!req.session.userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    // Site admins bypass
    if (req.session.role === 'admin') {
      return next();
    }

    const gameId = req.params.id;
    if (!gameId) {
      return res.status(400).json({ success: false, error: 'Game ID is required' });
    }

    try {
      const result = await pool.query(
        'SELECT admin_email FROM games WHERE game_id = $1',
        [gameId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Game not found' });
      }

      if (result.rows[0].admin_email !== req.session.email) {
        return res.status(403).json({ success: false, error: 'Only the game admin can perform this action' });
      }

      next();
    } catch (error) {
      console.error('Error checking game admin:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };
}

module.exports = { requireAuth, requireAdmin, requireGameAdmin };
