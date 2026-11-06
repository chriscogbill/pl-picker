const express = require('express');
const cors = require('cors');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('./src/db/connection');

// Separate pool for the shared auth/session database (cogsAuth)
const authPool = process.env.AUTH_DATABASE_URL
  ? new Pool({
      connectionString: process.env.AUTH_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      user: process.env.DB_USER || 'chriscogbill',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.AUTH_DB_NAME || 'cogsAuth',
      password: process.env.DB_PASSWORD || '',
      port: parseInt(process.env.DB_PORT || '5432'),
    });

// Import routes
const gamesRouter = require('./src/routes/games');
const picksRouter = require('./src/routes/picks');
const fixturesRouter = require('./src/routes/fixtures');
const settingsRouter = require('./src/routes/settings');
const { startResultsCron } = require('./src/cron/resultsCron');

const app = express();
const PORT = process.env.PORT || 3003;

// Make authPool accessible from route handlers via req.app.locals
app.locals.authPool = authPool;

// Trust Railway's reverse proxy so req.protocol reports 'https' correctly
// (required for Secure cookies to be set behind a proxy)
app.set('trust proxy', 1);

// ============================================
// Middleware
// ============================================

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3004,http://localhost:3002').split(',');
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

const isProduction = process.env.NODE_ENV === 'production';
const cookieConfig = {
  secure: isProduction,
  httpOnly: true,
  sameSite: isProduction ? 'none' : 'lax', // 'none' required for cross-subdomain fetch with credentials
  maxAge: 24 * 60 * 60 * 1000
};

if (process.env.COOKIE_DOMAIN) {
  cookieConfig.domain = process.env.COOKIE_DOMAIN;
}

app.use(session({
  store: new pgSession({
    pool: authPool,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || (() => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET must be set in production (refusing the shared insecure fallback)');
    }
    console.warn('[session] SESSION_SECRET unset — using an ephemeral dev secret; sessions will not persist or share');
    return require('crypto').randomBytes(32).toString('hex');
  })(),
  resave: false,
  saveUninitialized: false,
  cookie: cookieConfig
}));

app.use(express.json());

// Lazy sync: ensure authenticated users have a profile in the local user_profiles table
app.use(async (req, res, next) => {
  if (req.session?.userId && req.session?.email) {
    try {
      await pool.query(
        `INSERT INTO user_profiles (user_id, email, username, full_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET username = EXCLUDED.username, full_name = EXCLUDED.full_name`,
        [req.session.userId, req.session.email, req.session.username || req.session.email, null]
      );
    } catch (err) {
      console.error('User profile sync error:', err.message);
    }
  }
  next();
});

// Request logging
app.use((req, res, next) => {
  const sessionInfo = req.session?.userId ? `[User: ${req.session.email}]` : '[Not authenticated]';
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} ${sessionInfo}`);
  next();
});

// ============================================
// Routes
// ============================================

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT NOW()');
    let authDatabase = 'connected';
    try {
      await authPool.query('SELECT 1');
    } catch (authErr) {
      console.error('Health check: auth database error:', authErr.message);
      authDatabase = 'error';
    }
    res.json({
      status: authDatabase === 'connected' ? 'healthy' : 'degraded',
      database: 'connected',
      authDatabase,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Health check: database error:', error.message);
    res.status(503).json({ status: 'unhealthy', database: 'error', timestamp: new Date().toISOString() });
  }
});

app.get('/', (req, res) => {
  res.json({
    name: 'Prem Picker API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      games: '/api/games',
      fixtures: '/api/fixtures',
      teams: '/api/teams',
      settings: '/api/settings',
      health: '/health'
    }
  });
});

// ============================================
// Auth routes
// Login, register and forgot-password go straight from the browser to cogs-auth
// (auth.cogs.tech), not through this server. cogs-auth rate-limits per client IP,
// so proxying them would put every pl-picker user in one bucket: this server's.
// ============================================
app.get('/api/auth/me', (req, res) => {
  if (req.session?.userId) {
    res.json({
      success: true,
      user: {
        userId: req.session.userId,
        email: req.session.email,
        username: req.session.username,
        role: req.session.role || 'user'
      }
    });
  } else {
    res.status(401).json({ success: false, error: 'Not authenticated' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Logout failed' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true, message: 'Logged out' });
  });
});

// POST /api/auth/change-password — Change own password (authenticated)
app.post('/api/auth/change-password', async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Current and new passwords are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });
    }

    // Get current password hash
    const userResult = await authPool.query(
      'SELECT user_id, password_hash FROM users WHERE user_id = $1',
      [req.session.userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Verify current password
    const valid = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    }

    // Hash and update
    const newHash = await bcrypt.hash(newPassword, 10);
    await authPool.query(
      'UPDATE users SET password_hash = $1 WHERE user_id = $2',
      [newHash, req.session.userId]
    );

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ success: false, error: 'Password change failed' });
  }
});

// POST /api/auth/reset-password — Reset password with token (unauthenticated)
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ success: false, error: 'Token and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    // Hash the token to compare with stored hash
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const result = await authPool.query(
      'SELECT user_id, email FROM users WHERE password_reset_token = $1 AND password_reset_expires > NOW()',
      [hashedToken]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid or expired reset token' });
    }

    const user = result.rows[0];

    // Update password and clear token
    const newHash = await bcrypt.hash(newPassword, 10);
    await authPool.query(
      'UPDATE users SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL WHERE user_id = $2',
      [newHash, user.user_id]
    );

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ success: false, error: 'Password reset failed' });
  }
});

// GET /api/auth/users — Admin only: list all users
app.get('/api/auth/users', async (req, res) => {
  try {
    if (!req.session?.userId || req.session.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const result = await authPool.query(
      'SELECT user_id, email, username, role, created_at, last_login FROM users ORDER BY created_at DESC'
    );

    res.json({ success: true, users: result.rows });
  } catch (error) {
    console.error('Error listing users:', error);
    res.status(500).json({ success: false, error: 'Failed to list users' });
  }
});

// POST /api/auth/admin-reset-password — Admin only: reset a user's password
app.post('/api/auth/admin-reset-password', async (req, res) => {
  try {
    if (!req.session?.userId || req.session.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const { userId, newPassword } = req.body;
    if (!userId || !newPassword) {
      return res.status(400).json({ success: false, error: 'User ID and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    // Verify user exists
    const userResult = await authPool.query(
      'SELECT user_id, email FROM users WHERE user_id = $1',
      [userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await authPool.query(
      'UPDATE users SET password_hash = $1 WHERE user_id = $2',
      [newHash, userId]
    );

    res.json({ success: true, message: `Password reset for ${userResult.rows[0].email}` });
  } catch (error) {
    console.error('Error resetting user password:', error);
    res.status(500).json({ success: false, error: 'Password reset failed' });
  }
});

app.use('/api/games', gamesRouter);
app.use('/api/fixtures', fixturesRouter);
app.use('/api/settings', settingsRouter);
// Picks are nested under games: /api/games/:id/picks, /api/games/:id/my-picks, etc.
// Mounted in games router

// ============================================
// Error Handling
// ============================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path
  });
});

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : (err.message || 'Internal server error')
  });
});

// ============================================
// Server Startup
// ============================================

app.listen(PORT, async () => {
  console.log('\n===========================================');
  console.log('Prem Picker API');
  console.log('===========================================');
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  try {
    const result = await pool.query('SELECT COUNT(*) as game_count FROM games');
    console.log(`✓ Database connected (${result.rows[0].game_count} games)`);
  } catch (error) {
    console.error('✗ Database connection failed:', error.message);
  }

  // Start automated results cron job
  startResultsCron();

  console.log('\nAvailable endpoints:');
  console.log('  GET  /health                          - Health check');
  console.log('  GET  /api/games                       - List games');
  console.log('  POST /api/games                       - Create game');
  console.log('  GET  /api/games/:id                   - Game details');
  console.log('  GET  /api/games/:id/standings          - Game standings');
  console.log('  POST /api/games/:id/picks              - Submit pick');
  console.log('  GET  /api/fixtures/:gameweek            - Gameweek fixtures');
  console.log('  GET  /api/teams                        - PL teams');
  console.log('===========================================\n');
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  await pool.end();
  await authPool.end();
  process.exit(0);
});
