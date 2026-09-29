import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__;
const API_URL =
  Constants?.expoConfig?.extra?.apiUrl ??
  (IS_DEV ? 'http://localhost:3333/api' : 'https://api.example.com/api');

async function request(path, { method = 'GET', body, params } = {}) {
  const token = await AsyncStorage.getItem('token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  let url = `${API_URL}${path}`;
  if (params) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null),
    ).toString();
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(err.message || `Request failed: ${res.status}`);
    e.status = res.status;
    throw e;
  }
  if (res.status === 204) return null;
  // Use json() when available (tests mock only json), otherwise fall back to text→JSON
  if (typeof res.json === 'function') {
    try {
      const data = await res.json();
      // Some mocks return already-parsed object; some real responses need parsing guard
      return data;
    } catch {
      // Fallback to text parsing if json() failed (e.g. empty body)
      if (typeof res.text === 'function') {
        const text = await res.text().catch(() => '');
        return text ? JSON.parse(text) : null;
      }
      return null;
    }
  }
  if (typeof res.text === 'function') {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  return null;
}

export function formatMoney(cents, currency = 'EUR', locale = 'el-GR') {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format((cents ?? 0) / 100);
  } catch {
    return `${((cents ?? 0) / 100).toFixed(2)} ${currency}`;
  }
}

export const api = {
  login: (body) => request('/auth/login', { method: 'POST', body }),
  login2fa: (body) => request('/auth/login/2fa', { method: 'POST', body }),
  me: () => request('/auth/me'),
  refresh: () => request('/auth/refresh', { method: 'POST' }),
  balance: () => request('/invoices/mine'),
  invoices: () => request('/invoices/mine'),
  invoicePdf: (id) => request(`/invoices/${id}/pdf`),
  announcements: (buildingId) =>
    buildingId
      ? request(`/buildings/${buildingId}/feed`)
      : request('/announcements'),
  feed: (buildingId) => request(`/buildings/${buildingId}/feed`),
  votes: (buildingId) => request(`/buildings/${buildingId}/votes`),
  vote: (voteId) => request(`/votes/${voteId}`),
  ballot: (voteId, body) => request(`/votes/${voteId}/ballots`, { method: 'POST', body }),
  products: (buildingId) => request(`/buildings/${buildingId}/shop/products`),
  catalog: (buildingId) => request(`/buildings/${buildingId}/shop/catalog`),
  createOrder: (buildingId, body) =>
    request(`/buildings/${buildingId}/shop/orders`, { method: 'POST', body }),
  orders: (buildingId) => request(`/buildings/${buildingId}/shop/orders`),
  createDefect: (buildingId, body) =>
    request(`/buildings/${buildingId}/defects`, { method: 'POST', body }),
  pushSubscribe: (body) => request('/push/subscriptions', { method: 'POST', body }),
};