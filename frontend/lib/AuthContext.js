'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import { api } from './api';
import { retryUntilAnswered } from './sessionLookup';
import AuthUnavailable from '../components/AuthUnavailable';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // True when the session check got no answer (not the same as signed out).
  const [authUnavailable, setAuthUnavailable] = useState(false);
  const [currentSeason, setCurrentSeason] = useState(null);
  const [currentGameweek, setCurrentGameweek] = useState(null);

  useEffect(() => {
    initializeApp();
  }, []);

  // While the session check can't get an answer, keep asking in the
  // background and bring the app back as soon as it does.
  useEffect(() => {
    if (!authUnavailable) return;
    return retryUntilAnswered(() => api.lookupSession(), applySession);
  }, [authUnavailable]);

  function applySession(session) {
    setAuthUnavailable(session.kind === 'unavailable');
    setUser(session.kind === 'ok' ? session.user : null);
  }

  async function initializeApp() {
    try {
      const [seasonData, gameweekData, session] = await Promise.allSettled([
        api.getCurrentSeason(),
        api.getCurrentGameweek(),
        api.lookupSession()
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

      // lookupSession never rejects; "unavailable" is its answer for a failed check.
      applySession(session.status === 'fulfilled' ? session.value : { kind: 'unavailable' });
    } catch (error) {
      console.error('Error initializing app:', error);
      setCurrentSeason(new Date().getFullYear());
      setCurrentGameweek(1);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function register(email, username, password) {
    const response = await api.register(email, username, password);
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
      user, loading, register, changePassword, logout,
      currentSeason, currentGameweek, refreshGameweek
    }}>
      {authUnavailable ? <AuthUnavailable /> : children}
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
