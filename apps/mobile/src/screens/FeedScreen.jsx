import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import { useAuth } from '../AuthContext';

export function FeedScreen() {
  const { user } = useAuth();
  const buildingId = user?.buildingId;
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!buildingId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const data = await api.feed(buildingId);
      const list = Array.isArray(data) ? data : data?.items ?? data?.announcements ?? [];
      setItems(list);
    } catch {
      // keep empty
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
      <View style={styles.header}><Text style={styles.headerTitle}>Announcements</Text></View>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => (
          <View style={styles.card}>
            {item.pinned ? <Text style={styles.pinned}>📌 Pinned</Text> : null}
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardBody}>{item.body}</Text>
            <Text style={styles.cardMeta}>{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ''} · {item.audience ?? 'ALL'}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No announcements yet.</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  pinned: { fontSize: 11, fontWeight: '800', color: '#0f766e', marginBottom: 4 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  cardBody: { fontSize: 13, color: '#334155', marginTop: 6 },
  cardMeta: { fontSize: 11, color: '#94a3b8', marginTop: 8 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 32 },
});
