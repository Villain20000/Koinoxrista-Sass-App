import axios from 'axios';
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export const SEED_ADMIN = { email: 'admin@demo.gr', password: 'Admin1234!' };
export const SEED_RESIDENT = { email: 'maria@demo.gr', password: 'Password123!' };

let adminToken: string | null = null;
let residentToken: string | null = null;
/** HttpOnly refresh cookie captured from the cached resident login. */
let residentCookie: string | null = null;

export async function login(email: string, password: string): Promise<string> {
  const res = await axios.post('/api/auth/login', { email, password });
  return res.data.accessToken as string;
}

export async function adminHeaders(): Promise<Record<string, string>> {
  if (!adminToken) adminToken = await login(SEED_ADMIN.email, SEED_ADMIN.password);
  return { Authorization: `Bearer ${adminToken}` };
}

export async function residentHeaders(): Promise<Record<string, string>> {
  if (!residentToken) {
    const res = await axios.post('/api/auth/login', {
      email: SEED_RESIDENT.email,
      password: SEED_RESIDENT.password,
    });
    residentToken = res.data.accessToken as string;
    const setCookie = res.headers['set-cookie'] ?? [];
    residentCookie =
      (setCookie as string[])
        .map((c) => c.split(';')[0])
        .find((c) => c.startsWith('refresh_token=')) ?? null;
  }
  return { Authorization: `Bearer ${residentToken}` };
}

/** The refresh cookie from the cached resident login (for SSE auth). */
export function residentRefreshCookie(): string | null {
  return residentCookie;
}

export interface SeedUnit {
  id: string;
  label: string;
}

export interface SeedBuilding {
  id: string;
  name: string;
  units: SeedUnit[];
}

let buildingCache: SeedBuilding | null = null;

export async function seedBuilding(): Promise<SeedBuilding> {
  if (buildingCache) return buildingCache;
  const res = await axios.get('/api/buildings/mine', {
    headers: await adminHeaders(),
  });
  buildingCache = res.data as SeedBuilding;
  return buildingCache;
}

/** Unique short suffix for labels/descriptions so reruns never collide. */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Valid YYYY-MM period far in the future; nearly-unique per run. */
export function uniquePeriod(): string {
  const year = 2100 + (Date.now() % 40);
  const month = 1 + (Date.now() % 12);
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Create an expense + run invoices for a fresh period; returns ids for cleanup. */
export async function createExpenseAndRun(buildingId: string, period: string) {
  const suffix = uniqueSuffix();
  const cat = await axios.post(
    `/api/buildings/${buildingId}/categories`,
    { name: `E2E Κατηγορία ${suffix}`, strategy: 'MILIMES' },
    { headers: await adminHeaders() },
  );
  const categoryId = cat.data.id as string;

  const exp = await axios.post(
    `/api/buildings/${buildingId}/expenses`,
    {
      categoryId,
      description: `E2E Δαπάνη ${suffix}`,
      totalCents: 10000,
      periodYearMonth: period,
    },
    { headers: await adminHeaders() },
  );
  const expenseId = exp.data.id as string;

  const run = await axios.post(
    `/api/buildings/${buildingId}/invoices/run`,
    { periodYearMonth: period },
    { headers: await adminHeaders() },
  );
  const invoices = run.data as Array<{ id: string; unitId: string }>;

  return { categoryId, expenseId, invoices };
}

export async function closePrisma(): Promise<void> {
  await prisma.$disconnect();
}
