'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../../lib/AuthContext';
import { api } from '../../../lib/api';

export default function AdminUsersPage() {
  const { user, loading } = useAuth();
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [resetUserId, setResetUserId] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (!loading) loadUsers();
  }, [loading]);

  async function loadUsers() {
    try {
      const data = await api.getUsers();
      setUsers(data.users || []);
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setLoadingUsers(false);
    }
  }

  async function handleResetPassword(userId) {
    setResetError('');
    setResetSuccess('');

    if (!newPassword || newPassword.length < 6) {
      setResetError('Password must be at least 6 characters');
      return;
    }

    setResetting(true);
    try {
      const result = await api.adminResetPassword(userId, newPassword);
      setResetSuccess(result.message || 'Password reset successfully');
      setNewPassword('');
      setResetUserId(null);
    } catch (err) {
      setResetError(err.message || 'Failed to reset password');
    } finally {
      setResetting(false);
    }
  }

  if (loading || loadingUsers) {
    return <div className="text-center py-12 text-gray-500">Loading...</div>;
  }

  if (!user || user.role !== 'admin') {
    return <div className="card text-center"><p className="text-gray-600">Admin access required.</p></div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">User Management</h1>

      {resetSuccess && (
        <div className="bg-positive-100 border border-positive-400 text-positive-700 px-4 py-3 rounded text-sm">
          {resetSuccess}
        </div>
      )}

      <div className="card p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200 bg-gray-50">
                <th className="text-left py-3 px-4">Username</th>
                <th className="text-left py-3 px-4">Email</th>
                <th className="text-center py-3 px-4">Role</th>
                <th className="text-right py-3 px-4">Last Login</th>
                <th className="text-right py-3 px-4">Created</th>
                <th className="text-center py-3 px-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.user_id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-4 font-medium">{u.username}</td>
                  <td className="py-3 px-4 text-gray-600">{u.email}</td>
                  <td className="py-3 px-4 text-center">
                    <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                      u.role === 'admin' ? 'bg-warning-100 text-warning-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right text-gray-500 text-xs whitespace-nowrap">
                    {u.last_login ? new Date(u.last_login).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="py-3 px-4 text-right text-gray-500 text-xs whitespace-nowrap">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4 text-center">
                    {resetUserId === u.user_id ? (
                      <div className="flex items-center gap-2 justify-center">
                        <input
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="New password"
                          className="w-32 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          minLength={6}
                        />
                        <button
                          onClick={() => handleResetPassword(u.user_id)}
                          disabled={resetting}
                          className="text-xs bg-primary-600 text-white px-2 py-1 rounded hover:bg-primary-700 disabled:bg-gray-400 cursor-pointer"
                        >
                          {resetting ? '...' : 'Set'}
                        </button>
                        <button
                          onClick={() => { setResetUserId(null); setNewPassword(''); setResetError(''); }}
                          className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setResetUserId(u.user_id); setResetError(''); setResetSuccess(''); }}
                        className="text-xs text-link-600 hover:underline cursor-pointer"
                      >
                        Reset Password
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {resetError && (
        <div className="bg-danger-100 border border-danger-400 text-danger-700 px-4 py-3 rounded text-sm">
          {resetError}
        </div>
      )}
    </div>
  );
}
