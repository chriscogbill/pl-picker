'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await api.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err.message || 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto mt-12">
      <div className="card">
        <h1 className="text-3xl font-bold mb-6 text-center">Forgot Password</h1>

        {sent ? (
          <div className="text-center space-y-4">
            <div className="bg-positive-100 border border-positive-400 text-positive-700 px-4 py-3 rounded text-sm">
              If an account exists with that email, a password reset link has been sent. Please check your inbox.
            </div>
            <Link href="/login" className="text-link font-medium text-sm">
              Back to Login
            </Link>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-600 mb-4">
              Enter your email address and we'll send you a link to reset your password.
            </p>

            {error && (
              <div className="bg-danger-100 border border-danger-400 text-danger-700 px-4 py-3 rounded mb-4 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="your@email.com"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full btn-primary disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </form>

            <div className="mt-6 text-center text-sm text-gray-600">
              Remember your password?{' '}
              <Link href="/login" className="text-link font-medium">Back to Login</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
