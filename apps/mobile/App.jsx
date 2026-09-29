import React, { useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoginScreen } from './src/screens/LoginScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { BalanceScreen } from './src/screens/BalanceScreen';
import { VotesScreen } from './src/screens/VotesScreen';
import { ShopScreen } from './src/screens/ShopScreen';
import { FeedScreen } from './src/screens/FeedScreen';
import { AuthContextProvider, useAuth } from './src/AuthContext';

const Stack = createNativeStackNavigator();

const TABS = [
  { key: 'overview', label: 'Home', icon: '⌂' },
  { key: 'balance', label: 'Balance', icon: '€' },
  { key: 'votes', label: 'Votes', icon: '✓' },
  { key: 'shop', label: 'Shop', icon: '🛒' },
  { key: 'feed', label: 'Feed', icon: '≡' },
];

function MainTabs() {
  const [active, setActive] = useState('overview');
  let Screen;
  switch (active) {
    case 'balance':
      Screen = BalanceScreen;
      break;
    case 'votes':
      Screen = VotesScreen;
      break;
    case 'shop':
      Screen = ShopScreen;
      break;
    case 'feed':
      Screen = FeedScreen;
      break;
    default:
      Screen = DashboardScreen;
  }
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}><Screen /></View>
      <SafeAreaView edges={['bottom']} style={styles.tabBar}>
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => setActive(tab.key)}
              style={[styles.tab, isActive && styles.tabActive]}
            >
              <Text style={[styles.tabIcon, isActive && styles.tabIconActive]}>{tab.icon}</Text>
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    backgroundColor: '#fff',
    paddingVertical: 6,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  tabActive: { },
  tabIcon: { fontSize: 16, color: '#64748b' },
  tabIconActive: { color: '#0f766e' },
  tabLabel: { fontSize: 10, color: '#64748b', marginTop: 2, fontWeight: '600' },
  tabLabelActive: { color: '#0f766e' },
});

function Root() {
  const { token, ready } = useAuth();
  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#0f766e" />
      </View>
    );
  }
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {token ? (
          <Stack.Screen name="Main" component={MainTabs} />
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <AuthContextProvider>
      <StatusBar style="dark" />
      <Root />
    </AuthContextProvider>
  );
}