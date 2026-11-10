'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  tier: string;
  apiKey: string;
  createdAt: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, pass: string) => Promise<{ success: boolean; error?: string }>;
  signup: (name: string, email: string, pass: string, role?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

const STORAGE_KEY = 'anomaly_engine_session_v2';

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  login: async () => ({ success: false }),
  signup: async () => ({ success: false }),
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      // Remove the prefilled demo account older builds stored.
      localStorage.removeItem('anomaly_engine_auth_user');
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as User;
        // Only accept sessions created by this local demo. Older builds stored
        // demo personas that looked like real accounts, so drop those.
        if (parsed && typeof parsed.id === 'string' && parsed.id.startsWith('local_')) {
          setUser(parsed);
        } else {
          localStorage.removeItem(STORAGE_KEY);
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = async (email: string, pass: string) => {
    if (!email || !pass) {
      return { success: false, error: 'Email and password are required' };
    }
    // This build has no authentication server. The session is stored locally
    // and the password is not verified, so no fake credentials are invented.
    const loggedUser: User = {
      id: 'local_' + String(Date.now()),
      name: email.split('@')[0].replace(/[._-]/g, ' ').toUpperCase(),
      email,
      role: 'Local user',
      tier: 'Local demo',
      apiKey: '',
      createdAt: new Date().toISOString(),
    };
    setUser(loggedUser);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loggedUser));
    return { success: true };
  };

  const signup = async (name: string, email: string, pass: string, role?: string) => {
    if (!name || !email || !pass) {
      return { success: false, error: 'All fields are required' };
    }
    const newUser: User = {
      id: 'local_' + String(Date.now()),
      name,
      email,
      role: role || 'Local user',
      tier: 'Local demo',
      apiKey: '',
      createdAt: new Date().toISOString(),
    };
    setUser(newUser);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newUser));
    return { success: true };
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
