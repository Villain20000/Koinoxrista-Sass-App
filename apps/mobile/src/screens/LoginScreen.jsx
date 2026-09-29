import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../api';
import { useAuth } from '../AuthContext';

export function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function completeSignIn(accessToken) {
    // Token must be stored before /auth/me so the Authorization header attaches.
    const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
    await AsyncStorage.setItem('token', accessToken);
    const user = await api.me();
    await signIn(accessToken, user);
  }

  async function handleLogin() {
    setError(null);
    setLoading(true);
    try {
      const res = await api.login({ email, password });
      if (res.twoFactorRequired && res.ticket) {
        setTicket(res.ticket);
        return;
      }
      const accessToken = res.accessToken ?? res.token;
      if (!accessToken) throw new Error('No access token returned');
      await completeSignIn(accessToken);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handle2fa() {
    setError(null);
    setLoading(true);
    try {
      const res = await api.login2fa({ ticket, token: code.trim() });
      const accessToken = res.accessToken ?? res.token;
      if (!accessToken) throw new Error('No access token returned');
      await completeSignIn(accessToken);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <Text style={styles.title}>PolykatoikiaOS</Text>
        <Text style={styles.subtitle}>Koinoxrista</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {ticket ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="6-digit code or recovery code"
              autoCapitalize="none"
              value={code}
              onChangeText={setCode}
            />
            <TouchableOpacity style={styles.button} onPress={handle2fa} disabled={loading || !code.trim()}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.link} onPress={() => setTicket(null)}>
              <Text style={styles.linkText}>Back to sign in</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={styles.button}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </TouchableOpacity>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  title: { fontSize: 30, fontWeight: '800', color: '#0f766e', textAlign: 'center' },
  subtitle: { fontSize: 16, color: '#64748b', textAlign: 'center', marginBottom: 32 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#0f766e',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  error: { color: '#dc2626', marginBottom: 8, textAlign: 'center' },
  link: { paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  linkText: { color: '#0f766e', fontWeight: '600' },
});