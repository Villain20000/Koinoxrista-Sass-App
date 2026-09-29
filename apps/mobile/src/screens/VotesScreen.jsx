import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import { useAuth } from '../AuthContext';

export function VotesScreen() {
  const { user } = useAuth();
  const [votes, setVotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const buildingId = user?.buildingId;

  const load = useCallback(async () => {
    if (!buildingId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      setError(null);
      const data = await api.votes(buildingId);
      setVotes(Array.isArray(data) ? data : data?.items ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [buildingId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!buildingId) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><Text style={styles.empty}>No building assigned.</Text></View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}><ActivityIndicator style={{ marginTop: 48 }} color="#0f766e" /></SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Votes</Text>
        <TouchableOpacity onPress={() => { setRefreshing(true); load(); }}><Text style={styles.refresh}>Refresh</Text></TouchableOpacity>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={votes}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => {
          const isOpen = !item.result && new Date(item.closesAt) > new Date();
          return (
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.cardTitle}>{item.topic ?? item.title ?? 'Untitled'}</Text>
                <Text style={[styles.badge, isOpen ? styles.badgeOpen : styles.badgeClosed]}>{isOpen ? 'OPEN' : item.result ?? 'CLOSED'}</Text>
              </View>
              {item.description ? <Text style={styles.cardBody}>{item.description}</Text> : null}
              <Text style={styles.cardMeta}>Closes: {item.closesAt ? new Date(item.closesAt).toLocaleDateString() : '—'} · {item.thresholdType ?? ''}</Text>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No votes for this building.</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  refresh: { color: '#0f766e', fontWeight: '600' },
  error: { color: '#dc2626', textAlign: 'center', padding: 8 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a', flex: 1, marginRight: 8 },
  cardBody: { fontSize: 13, color: '#334155', marginTop: 6 },
  cardMeta: { fontSize: 12, color: '#64748b', marginTop: 8 },
  badge: { fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  badgeOpen: { backgroundColor: '#dcfce7', color: '#166534' },
  badgeClosed: { backgroundColor: '#e2e8f0', color: '#475569' },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 32 },
});
