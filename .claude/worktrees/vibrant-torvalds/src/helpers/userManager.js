const bcrypt = require('bcrypt');
const crypto = require('crypto');

/**
 * Ensure a user account exists in cogsAuth for the given email.
 * If not, auto-creates one with a random password and flags for password setup.
 *
 * @param {Pool} authPool - Connection to cogsAuth database
 * @param {Pool} appPool - Connection to premPicker database
 * @param {string} email - User email (will be normalised)
 * @param {string} [username] - Optional username; falls back to email prefix
 * @returns {{ userId: number, username: string, created: boolean }}
 */
async function ensureUserExists(authPool, appPool, email, username) {
  const normEmail = email.trim().toLowerCase();

  // 1. Check if user already exists in cogsAuth
  const existing = await authPool.query(
    'SELECT user_id, email, username FROM users WHERE email = $1',
    [normEmail]
  );

  if (existing.rows.length > 0) {
    const user = existing.rows[0];

    // Ensure they have a local user_profiles row (without password setup flag)
    await appPool.query(
      `INSERT INTO user_profiles (user_id, email, username)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING`,
      [user.user_id, user.email, user.username]
    );

    return { userId: user.user_id, username: user.username, created: false };
  }

  // 2. User doesn't exist — auto-create
  const playerUsername = username?.trim() || normEmail.split('@')[0];

  // Generate a random password (user will set their own via setup flow)
  const randomPassword = crypto.randomBytes(32).toString('hex');
  const passwordHash = await bcrypt.hash(randomPassword, 10);

  // Ensure unique username — append random suffix if needed
  let finalUsername = playerUsername;
  const usernameCheck = await authPool.query(
    'SELECT user_id FROM users WHERE username = $1',
    [finalUsername]
  );
  if (usernameCheck.rows.length > 0) {
    finalUsername = `${playerUsername}_${crypto.randomBytes(3).toString('hex')}`;
  }

  const result = await authPool.query(
    `INSERT INTO users (email, username, password_hash)
     VALUES ($1, $2, $3)
     RETURNING user_id, email, username`,
    [normEmail, finalUsername, passwordHash]
  );

  const newUser = result.rows[0];

  // Create local profile with password setup flag
  await appPool.query(
    `INSERT INTO user_profiles (user_id, email, username, needs_password_setup)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (email) DO UPDATE SET needs_password_setup = TRUE`,
    [newUser.user_id, newUser.email, newUser.username]
  );

  console.log(`[userManager] Auto-created user account for ${normEmail} (needs password setup)`);

  return { userId: newUser.user_id, username: newUser.username, created: true };
}

module.exports = { ensureUserExists };
