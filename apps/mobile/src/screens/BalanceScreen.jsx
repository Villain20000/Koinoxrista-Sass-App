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
import { api, formatMoney } from '../api';
import { useAuth } from '../AuthContext';

export function BalanceScreen() {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const currency = user?.currency ?? 'EUR';
  const locale = currency === 'EUR' ? 'el-GR' : currency === 'USD' ? 'en-US' : currency === 'BRL' ? 'pt-BR' : 'el-GR';

  const load = useCallback(async () => {
    try {
      const data = await api.invoices();
      setInvoices(Array.isArray(data) ? data : data?.items ?? []);
    } catch {
      // keep empty on error (offline)
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalOutstanding = invoices
    .filter((i) => i.status !== 'PAID')
    .reduce((s, i) => s + (i.totalCents - (i.paidCents ?? 0)), 0);
  const totalPaid = invoices
    .filter((i) => i.status === 'PAID')
    .reduce((s, i) => s + i.totalCents, 0);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator style={{ marginTop: 48 }} color="#0f766e" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={invoices}
        keyExtractor={(item) => String(item.id ?? item.periodYearMonth)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        contentContainerStyle={{ padding: 16 }}
        ListHeaderComponent={
          <View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Outstanding</Text>
              <Text style={styles.summaryValue}>{formatMoney(totalOutstanding, currency, locale)}</Text>
              <Text style={styles.summarySub}>{invoices.length} periods · paid {formatMoney(totalPaid, currency, locale)}</Text>
            </View>
            <Text style={styles.sectionTitle}>Invoices</Text>
          </View>
        }
        renderItem={({ item }) => {
          const due = (item.totalCents ?? 0) - (item.paidCents ?? 0);
          return (
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.cardTitle}>{item.periodYearMonth ?? item.period ?? '—'}</Text>
                <Text style={[styles.badge, item.status === 'PAID' ? styles.badgePaid : styles.badgePending]}>{item.status ?? 'PENDING'}</Text>
              </View>
              <Text style={styles.cardAmount}>{formatMoney(item.totalCents ?? 0, currency, locale)}</Text>
              {item.status !== 'PAID' ? <Text style={styles.cardDue}>Due: {formatMoney(due, currency, locale)}</Text> : null}
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No invoices yet.</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  summaryCard: { backgroundColor: '#0f766e', borderRadius: 14, padding: 20, marginBottom: 16 },
  summaryLabel: { color: '#ccfbf1', fontSize: 14 },
  summaryValue: { color: '#fff', fontSize: 28, fontWeight: '800', marginTop: 4 },
  summarySub: { color: '#99f6e4', fontSize: 12, marginTop: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  cardAmount: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginTop: 6 },
  cardDue: { fontSize: 13, color: '#dc2626', marginTop: 2 },
  badge: { fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  badgePaid: { backgroundColor: '#dcfce7', color: '#166534' },
  badgePending: { backgroundColor: '#fef9c3', color: '#854d0e' },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 32 },
});
