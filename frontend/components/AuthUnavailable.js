'use client';

import { RETRY_SECONDS } from '../lib/sessionLookup';

// Shown by AuthProvider in place of the app when the session check couldn't
// get an answer (as opposed to being told "not signed in"). AuthProvider keeps
// re-checking in the background and swaps the app back in when it succeeds.
export default function AuthUnavailable() {
  return (
    <main
      style={{
        maxWidth: '24rem',
        margin: '0 auto',
        padding: '5rem 1rem',
        fontSize: '0.875rem',
        lineHeight: 1.6,
      }}
    >
      <h1 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem' }}>
        Can&apos;t reach sign-in right now
      </h1>
      <p style={{ opacity: 0.7, marginBottom: '0.75rem' }}>
        The sign-in check didn&apos;t get an answer, so this page can&apos;t confirm who you are.
        If you were signed in, you still are, and there&apos;s no need to log in again. This is
        usually brief.
      </p>
      <p style={{ opacity: 0.7 }}>
        Retrying every {RETRY_SECONDS} seconds, or{' '}
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            font: 'inherit',
            color: 'inherit',
            background: 'none',
            border: 0,
            padding: 0,
            cursor: 'pointer',
            textDecoration: 'underline dotted',
            textUnderlineOffset: '4px',
          }}
        >
          try again now
        </button>
        .
      </p>
    </main>
  );
}
