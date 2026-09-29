import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../api';
import { useAuth } from '../AuthContext';

export function DashboardScreen() {
  const { user, signOut } = useAuth();
  const [balance, setBalance] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [bal, ann] = await Promise.all([
          api.balance(),
          api.announcements(),
        ]);
        setBalance(bal?.totalOutstanding ?? bal);
        setAnnouncements(ann ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.greeting}>
          {user?.name ? `Hi, ${user.name}` : 'Resident'}
        </Text>
        <TouchableOpacity onPress={signOut}>
          <Text style={styles.logout}>Log out</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 48 }} color="#0f766e" />
      ) : (
        <FlatList
          data={announcements}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16 }}
          ListHeaderComponent={
            <View style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>Outstanding balance</Text>
              <Text style={styles.balanceValue}>
                {balance != null ? `€ ${Number(balance).toFixed(2)}` : '—'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardBody}>{item.body}</Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>No announcements yet.</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  greeting: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  logout: { color: '#0f766e', fontWeight: '600' },
  balanceCard: {
    backgroundColor: '#0f766e',
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
  },
  balanceLabel: { color: '#ccfbf1', fontSize: 14 },
  balanceValue: { color: '#fff', fontSize: 30, fontWeight: '800', marginTop: 4 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  cardBody: { fontSize: 14, color: '#334155', marginTop: 4 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 32 },
});