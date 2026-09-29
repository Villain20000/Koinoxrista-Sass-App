import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AuthContext = createContext(null);

export function AuthContextProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [t, u] = await Promise.all([
          AsyncStorage.getItem('token'),
          AsyncStorage.getItem('user'),
        ]);
        if (t) setToken(t);
        if (u) setUser(JSON.parse(u));
      } finally {
        setReady(true);
      }
    })();
  }, []);

  async function signIn(newToken, newUser) {
    setToken(newToken);
    setUser(newUser);
    await AsyncStorage.setItem('token', newToken);
    await AsyncStorage.setItem('user', JSON.stringify(newUser));
  }

  async function signOut() {
    setToken(null);
    setUser(null);
    await AsyncStorage.multiRemove(['token', 'user']);
  }

  function updateUser(patch) {
    setUser((prev) => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  }

  return (
    <AuthContext.Provider value={{ token, user, ready, signIn, signOut, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}