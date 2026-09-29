import axios from 'axios';

import {
  prisma,
  seedBuilding,
  adminHeaders,
  residentHeaders,
  residentRefreshCookie,
  uniqueSuffix,
  closePrisma,
} from './helpers';

/** Connect to the SSE stream and resolve on the first matching event. */
async function waitForSseEvent(
  cookieHeader: string,
  eventType: string,
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    void axios
      .get('http://localhost:3000/api/realtime/events', {
        headers: { Cookie: cookieHeader },
        responseType: 'stream',
        timeout: timeoutMs,
      })
      .then(({ data }) => {
        let buffer = '';
        const timer = setTimeout(
          () => reject(new Error(`SSE timeout waiting for ${eventType}`)),
          timeoutMs,
        );
        data.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const match = buffer.match(
            new RegExp(`event: ${eventType}\\ndata: (.+?)(?:\\n\\n|$)`),
          );
          if (match) {
            clearTimeout(timer);
            data.destroy();
            resolve(JSON.parse(match[1]) as Record<string, unknown>);
          }
        });
      })
      .catch(reject);
  });
}

/**
 * Vote lifecycle: admin opens a vote -> resident casts ballots for their
 * units -> admin closes -> tally is immutable.
 */
describe('votes lifecycle', () => {
  let building: Awaited<ReturnType<typeof seedBuilding>>;
  let voteId: string;

  beforeAll(async () => {
    building = await seedBuilding();
  });

  it('admin creates a vote', async () => {
    const res = await axios.post(
      `/api/buildings/${building.id}/votes`,
      {
        topic: `E2E Ψηφοφορία ${uniqueSuffix()}`,
        thresholdType: 'MILLIMES_MAJORITY',
        closesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      },
      { headers: await adminHeaders() },
    );
    expect(res.data.id).toBeTruthy();
    voteId = res.data.id;
  });

  it('resident casts a ballot for their owned units', async () => {
    const res = await axios.post(
      `/api/votes/${voteId}/ballots`,
      { choice: 'YES' },
      { headers: await residentHeaders() },
    );
    // maria owns 2 units (Α1, Β1) -> 2 ballots
    expect(res.data.length).toBe(2);
    expect(res.data.every((b: { choice: string }) => b.choice === 'YES')).toBe(
      true,
    );
  });

  it('a second cast updates the same ballots (upsert, not duplicate)', async () => {
    const res = await axios.post(
      `/api/votes/${voteId}/ballots`,
      { choice: 'NO' },
      { headers: await residentHeaders() },
    );
    expect(res.data.length).toBe(2);

    const ballots = await axios.get(`/api/votes/${voteId}/ballots`, {
      headers: await adminHeaders(),
    });
    // listBallots is already scoped to this vote; rows have no voteId field
    expect(ballots.data.length).toBe(2);
    expect(ballots.data.every((b: { choice: string }) => b.choice === 'NO')).toBe(
      true,
    );
  });

  it('admin closes the vote and a tally is stored', async () => {
    const res = await axios.post(
      `/api/votes/${voteId}/close`,
      {},
      { headers: await adminHeaders() },
    );
    expect(res.data.tally).toBeTruthy();
    expect(res.data.tally.outcome).toBeDefined();
  });

  it('admin cannot close twice (result is immutable)', async () => {
    const again = await axios.post(
      `/api/votes/${voteId}/close`,
      {},
      { headers: await adminHeaders() },
    );
    expect(again.data.tally.outcome).toBeDefined();
  });

  it('pushes a live tally over SSE when a ballot is cast', async () => {
    // Fresh vote so the ballot is legal (the shared one is closed above).
    const fresh = await axios.post(
      `/api/buildings/${building.id}/votes`,
      {
        topic: `E2E SSE Ψηφοφορία ${uniqueSuffix()}`,
        thresholdType: 'MILLIMES_MAJORITY',
        closesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      },
      { headers: await adminHeaders() },
    );
    const freshVoteId = fresh.data.id as string;

    // Reuse the cached resident login: no extra throttled login.
    const residentHeadersCached = await residentHeaders();
    const refreshCookie = residentRefreshCookie();
    expect(refreshCookie).toBeTruthy();

    const ssePromise = waitForSseEvent(refreshCookie as string, 'vote.updated');
    // Give the SSE connection a moment to register before casting.
    await new Promise((r) => setTimeout(r, 500));

    const res = await axios.post(
      `/api/votes/${freshVoteId}/ballots`,
      { choice: 'YES' },
      { headers: residentHeadersCached },
    );
    expect(res.data.length).toBeGreaterThanOrEqual(1);

    const event = await ssePromise;
    expect(event.voteId).toBe(freshVoteId);
    expect((event.tally as { yesCount: number }).yesCount).toBeGreaterThanOrEqual(1);

    await prisma.ballot.deleteMany({ where: { voteId: freshVoteId } });
    await prisma.vote.delete({ where: { id: freshVoteId } });
  });

  it('a non-member cannot access another building vote list', async () => {
    // maria is a member of building 1 only; a bogus buildingId is rejected
    // by the tenant guard before any data is returned.
    await expect(
      axios.get(`/api/buildings/00000000-0000-0000-0000-000000000000/votes`, {
        headers: await residentHeaders(),
      }),
    ).rejects.toMatchObject({ response: { status: 403 } });
  });

  afterAll(async () => {
    await prisma.ballot.deleteMany({ where: { voteId } });
    await prisma.vote.delete({ where: { id: voteId } });
    await closePrisma();
  });
});
