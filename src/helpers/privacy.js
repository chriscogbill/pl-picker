// Player emails are only for the game admin and site admins. Everyone else
// sees display names (game_players.username) and an `is_me` flag, so the UI
// can still find "my" row without knowing anyone's email.

function viewerIsGameAdmin(req, game) {
  return req.session?.role === 'admin' || (!!req.session?.email && req.session.email === game.admin_email);
}

// Adds is_me to each row and, unless the viewer may see emails, removes
// user_email. Mutates and returns the rows.
function redactPlayerEmails(req, game, rows) {
  const seeEmails = viewerIsGameAdmin(req, game);
  for (const row of rows) {
    row.is_me = !!req.session?.email && row.user_email === req.session.email;
    if (!seeEmails) delete row.user_email;
  }
  return rows;
}

// The game row itself: admin/creator emails stay with admins; everyone gets
// viewer_is_game_admin so the UI doesn't need the email to decide.
function redactGame(req, game) {
  const out = { ...game, viewer_is_game_admin: viewerIsGameAdmin(req, game) };
  if (!out.viewer_is_game_admin) {
    delete out.admin_email;
    delete out.created_by_email;
    delete out.invite_code;
  }
  return out;
}

module.exports = { viewerIsGameAdmin, redactPlayerEmails, redactGame };
