'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import { api } from './api';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentSeason, setCurrentSeason] = useState(null);
  const [currentGameweek, setCurrentGameweek] = useState(null);

  useEffect(() => {
    initializeApp();
  }, []);

  async function initializeApp() {
    try {
      const [seasonData, gameweekData, authResponse] = await Promise.allSettled([
        api.getCurrentSeason(),
        api.getCurrentGameweek(),
        api.getCurrentUser()
      ]);

      if (seasonData.status === 'fulfilled') {
        setCurrentSeason(seasonData.value);
      } else {
        setCurrentSeason(new Date().getFullYear());
      }

      if (gameweekData.status === 'fulfilled') {
        setCurrentGameweek(gameweekData.value);
      } else {
        setCurrentGameweek(1);
      }

      if (authResponse.status === 'fulfilled') {
        setUser(authResponse.value.user);
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('Error initializing app:', error);
      setCurrentSeason(new Date().getFullYear());
      setCurrentGameweek(1);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function login(email, password) {
    const response = await api.login(email, password);
    setUser(response.user);
    return response;
  }

  async function register(email, username, password) {
    const response = await api.register(email, username, password);
    setUser(response.user);
    return response;
  }

  async function setupPassword(email, password) {
    const response = await api.setupPassword(email, password);
    setUser(response.user);
    return response;
  }

  async function changePassword(currentPassword, newPassword) {
    return api.changePassword(currentPassword, newPassword);
  }

  async function logout() {
    await api.logout();
    setUser(null);
  }

  async function refreshGameweek() {
    try {
      const gw = await api.getCurrentGameweek();
      setCurrentGameweek(gw);
    } catch (error) {
      console.error('Error refreshing gameweek:', error);
    }
  }

  return (
    <AuthContext.Provider value={{
      user, loading, login, register, setupPassword, changePassword, logout,
      currentSeason, currentGameweek, refreshGameweek
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
