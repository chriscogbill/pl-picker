'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/AuthContext';

// Centralised login: redirect to auth.cogs.tech/login.
// After successful auth, auth.cogs.tech redirects back here and the
// .cogs.tech session cookie is already set — AuthContext picks it up.

const AUTH_LOGIN_URL = process.env.NEXT_PUBLIC_AUTH_LOGIN_URL || 'https://auth.cogs.tech/login';

export default function LoginPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    if (user) {
      router.push('/');
    } else {
      const redirect = encodeURIComponent(window.location.origin + '/');
      window.location.href = `${AUTH_LOGIN_URL}?redirect=${redirect}`;
    }
  }, [user, loading, router]);

  return (
    <div style={{ textAlign: 'center', padding: '5rem 1rem', color: '#888' }}>
      Redirecting to login...
    </div>
  );
}
