import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, formatMoney } from '../api';
import { useAuth } from '../AuthContext';

export function ShopScreen() {
  const { user } = useAuth();
  const buildingId = user?.buildingId;
  const currency = user?.currency ?? 'EUR';
  const locale = currency === 'EUR' ? 'el-GR' : currency === 'USD' ? 'en-US' : currency === 'BRL' ? 'pt-BR' : 'el-GR';

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [ordering, setOrdering] = useState(null);

  const load = useCallback(async () => {
    if (!buildingId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const data = await api.catalog(buildingId).catch(() => api.products(buildingId));
      const list = Array.isArray(data) ? data : data?.items ?? data?.products ?? [];
      setProducts(list);
    } catch {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [buildingId]);

  useEffect(() => {
    load();
  }, [load]);

  async function order(product) {
    if (!buildingId) return;
    setOrdering(product.id);
    try {
      await api.createOrder(buildingId, { productId: product.id, qty: 1 });
      Alert.alert('Ordered', `${product.name} ordered.`);
      load();
    } catch (e) {
      Alert.alert('Order failed', e.message);
    } finally {
      setOrdering(null);
    }
  }

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
        <Text style={styles.headerTitle}>Shop</Text>
        <TouchableOpacity onPress={() => { setRefreshing(true); load(); }}><Text style={styles.refresh}>Refresh</Text></TouchableOpacity>
      </View>
      <FlatList
        data={products}
        keyExtractor={(item) => String(item.id)}
        numColumns={2}
        columnWrapperStyle={products.length > 1 ? { gap: 12 } : undefined}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle} numberOfLines={2}>{item.name}</Text>
            <Text style={styles.cardPrice}>{formatMoney(item.priceCents ?? item.price ?? 0, currency, locale)}</Text>
            <Text style={styles.cardStock}>{(item.stock ?? 0) > 0 ? `${item.stock} in stock` : 'Out of stock'}</Text>
            <TouchableOpacity
              style={[styles.button, (item.stock ?? 0) <= 0 || ordering ? styles.buttonDisabled : null]}
              disabled={(item.stock ?? 0) <= 0 || !!ordering}
              onPress={() => order(item)}
            >
              {ordering === item.id ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.buttonText}>Order</Text>}
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No products in this building.</Text>}
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
  card: { flex: 1, backgroundColor: '#fff', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a', minHeight: 38 },
  cardPrice: { fontSize: 16, fontWeight: '800', color: '#0f766e', marginTop: 6 },
  cardStock: { fontSize: 11, color: '#64748b', marginTop: 2 },
  button: { backgroundColor: '#0f766e', borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 10 },
  buttonDisabled: { backgroundColor: '#94a3b8' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 32 },
});
