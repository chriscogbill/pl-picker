// 500 responses: the details go to the server log (each route already
// console.errors them); clients only see raw Postgres/driver messages in dev.
function internalError(error) {
  return {
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : (error && error.message) || 'Internal server error',
  };
}

module.exports = { internalError };
