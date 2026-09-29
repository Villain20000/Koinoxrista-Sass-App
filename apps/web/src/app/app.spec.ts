import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { AuthService } from './core/auth.service';
import { canActivateRole, homeForRole } from './core/role.guard';
import { closesAtLabel, voteStatusOf } from './core/api/votes-api.service';
import { arrearsSummary, bucketCls } from './pages/admin/admin-arrears.component';
import { buildCreateVoteDto } from './pages/admin/admin-votes.component';
import { jobsForTab } from './pages/admin/admin-jobs.component';
import {
  findOwnActiveBid,
  parseCerts,
} from './pages/provider/provider-portal.component';
import { isMockCheckout } from './pages/balance/balance.component';

describe('homeForRole', () => {
  it('maps ADMIN to /admin', () => {
    expect(homeForRole('ADMIN')).toBe('/admin');
  });

  it('maps RESIDENT to /balance', () => {
    expect(homeForRole('RESIDENT')).toBe('/balance');
  });

  it('maps PROVIDER to /provider', () => {
    expect(homeForRole('PROVIDER')).toBe('/provider');
  });

  it('defaults anonymous visitors to /login', () => {
    expect(homeForRole(null)).toBe('/login');
    expect(homeForRole(undefined)).toBe('/login');
  });
});

describe('canActivateRole', () => {
  const route = {} as ActivatedRouteSnapshot;
  const state = { url: '/admin' } as RouterStateSnapshot;

  function run(
    guard: ReturnType<typeof canActivateRole>,
  ): boolean | UrlTree {
    return TestBed.runInInjectionContext(() =>
      guard(route, state),
    ) as boolean | UrlTree;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
  });

  it('redirects unauthenticated users to /login', () => {
    const result = run(canActivateRole('ADMIN'));
    expect(result instanceof UrlTree).toBe(true);
    expect((result as UrlTree).toString()).toBe('/login');
  });

  it('redirects users with the wrong role to their home', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const auth = TestBed.inject(AuthService);

    const restore$ = auth.tryRestoreSession().subscribe({
      error: () => undefined,
    });
    httpMock.expectOne('/api/auth/refresh').flush({ accessToken: 'token-1' });
    httpMock
      .expectOne('/api/auth/me')
      .flush({ id: 'u1', email: 'a@b.gr', role: 'RESIDENT', buildingId: 'b1' });
    restore$.unsubscribe();

    const result = run(canActivateRole('ADMIN'));
    expect(result instanceof UrlTree).toBe(true);
    expect((result as UrlTree).toString()).toBe('/balance');
  });

  it('allows access when the role matches', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const auth = TestBed.inject(AuthService);

    const restore$ = auth.tryRestoreSession().subscribe({
      error: () => undefined,
    });
    httpMock.expectOne('/api/auth/refresh').flush({ accessToken: 'token-1' });
    httpMock
      .expectOne('/api/auth/me')
      .flush({ id: 'u1', email: 'a@b.gr', role: 'ADMIN', buildingId: 'b1' });
    restore$.unsubscribe();

    expect(run(canActivateRole('ADMIN'))).toBe(true);
  });
});

describe('vote helpers', () => {
  const before = new Date('2026-01-01T00:00:00Z').getTime();
  const during = new Date('2026-06-15T12:00:00Z').getTime();
  const after = new Date('2026-12-31T00:00:00Z').getTime();
  const toTime = (iso: string) => new Date(iso).getTime();

  it('voteStatusOf derives SCHEDULED / OPEN / CLOSED', () => {
    expect(
      voteStatusOf(
        { opensAt: '2026-06-01T00:00:00Z', closesAt: '2026-07-01T00:00:00Z' },
        new Date(before),
      ),
    ).toBe('SCHEDULED');
    expect(
      voteStatusOf(
        { opensAt: '2026-06-01T00:00:00Z', closesAt: '2026-07-01T00:00:00Z' },
        new Date(during),
      ),
    ).toBe('OPEN');
    expect(
      voteStatusOf(
        { opensAt: '2026-06-01T00:00:00Z', closesAt: '2026-07-01T00:00:00Z' },
        new Date(after),
      ),
    ).toBe('CLOSED');
  });

  it('voteStatusOf treats a stored result as CLOSED', () => {
    expect(
      voteStatusOf(
        {
          opensAt: '2026-06-01T00:00:00Z',
          closesAt: '2026-07-01T00:00:00Z',
          result: 'PASSED',
        },
        new Date(during),
      ),
    ).toBe('CLOSED');
  });

  it('closesAtLabel counts up after close and down before it', () => {
    const closesAt = '2026-06-10T00:00:00Z';
    const beforeLabel = closesAtLabel(closesAt, new Date(toTime(closesAt) - 36 * 60 * 60 * 1000));
    expect(beforeLabel).toContain('Λήγει σε');
    const afterLabel = closesAtLabel(closesAt, new Date(toTime(closesAt) + 2 * 24 * 60 * 60 * 1000));
    expect(afterLabel).toContain('Έκλεισε πριν από');
  });
});

describe('buildCreateVoteDto', () => {
  it('builds ISO timestamps and trims fields', () => {
    const dto = buildCreateVoteDto({
      topic: '  Αντικατάσταση ανελκυστήρα  ',
      description: ' ',
      thresholdType: 'MILLIMES_MAJORITY',
      opensAt: '',
      closesAt: '2026-03-01T10:00',
    });
    expect(dto).not.toBeNull();
    const closesAt = dto ? dto.closesAt : '';
    expect(dto?.topic).toBe('Αντικατάσταση ανελκυστήρα');
    expect(dto?.thresholdType).toBe('MILLIMES_MAJORITY');
    expect(Number.isFinite(Date.parse(closesAt))).toBe(true);
    expect(dto?.description).toBeUndefined();
    expect(dto?.opensAt).toBeUndefined();
  });

  it('rejects blank topics or unparsable dates', () => {
    expect(
      buildCreateVoteDto({
        topic: '',
        description: '',
        thresholdType: 'SIMPLE_MAJORITY',
        opensAt: '',
        closesAt: '2026-03-01T10:00',
      }),
    ).toBeNull();
    expect(
      buildCreateVoteDto({
        topic: 'Θέμα',
        description: '',
        thresholdType: 'SIMPLE_MAJORITY',
        opensAt: '',
        closesAt: 'not-a-date',
      }),
    ).toBeNull();
  });
});

describe('arrearsSummary / bucketCls', () => {
  it('sums outstanding totals and counts non-empty buckets', () => {
    const summary = arrearsSummary([
      {
        unitId: 'u1',
        unitLabel: 'Α1',
        ownerNames: ['Ι. Παπαδόπουλος'],
        outstandingCents: 1000,
        bucketCurrentCents: 400,
        bucket30Cents: 600,
        bucket60Cents: 0,
        bucket90PlusCents: 0,
        oldestUnpaidPeriod: '2026-05',
      },
      {
        unitId: 'u2',
        unitLabel: 'Β2',
        ownerNames: [],
        outstandingCents: 250,
        bucketCurrentCents: 0,
        bucket30Cents: 0,
        bucket60Cents: 0,
        bucket90PlusCents: 250,
        oldestUnpaidPeriod: null,
      },
    ]);
    expect(summary.totalOutstandingCents).toBe(1250);
    expect(summary.currentCount).toBe(1);
    expect(summary.b30Count).toBe(1);
    expect(summary.b60Count).toBe(0);
    expect(summary.b90PlusCount).toBe(1);
  });

  it('bucketCls highlights only non-empty buckets', () => {
    expect(bucketCls(0)).not.toContain('text-red-700');
    expect(bucketCls(500)).toContain('text-red-700');
  });
});

describe('jobsForTab', () => {
  it('groups jobs by tab statuses', () => {
    const open = { id: 'j1', status: 'OPEN' };
    const awarded = { id: 'j2', status: 'AWARDED' };
    const inProgress = { id: 'j3', status: 'IN_PROGRESS' };
    const completed = { id: 'j4', status: 'COMPLETED' };
    const cancelled = { id: 'j5', status: 'CANCELLED' };
    const all = [open, awarded, inProgress, completed, cancelled] as never[];
    expect(jobsForTab(all, 'OPEN')).toEqual([open]);
    expect(jobsForTab(all, 'ACTIVE')).toEqual([awarded, inProgress]);
    expect(jobsForTab(all, 'DONE')).toEqual([completed, cancelled]);
  });
});

describe('provider helpers', () => {
  it('findOwnActiveBid matches only SUBMITTED bids of the user', () => {
    const bids = [
      { providerUserId: 'p1', status: 'REJECTED' },
      { providerUserId: 'p2', status: 'SUBMITTED' },
      { providerUserId: 'p1', status: 'SUBMITTED' },
    ];
    expect(findOwnActiveBid({ bids: [...bids] as never[] }, 'p1')?.status).toBe(
      'SUBMITTED',
    );
    expect(findOwnActiveBid({ bids: [] }, 'p1')).toBeNull();
    expect(findOwnActiveBid({ bids: [...bids] as never[] }, null)).toBeNull();
  });

  it('parseCerts splits on commas and drops empties', () => {
    expect(parseCerts(' ISO 9001 , Ηλεκτρολόγος ,,')).toEqual([
      'ISO 9001',
      'Ηλεκτρολόγος',
    ]);
    expect(parseCerts('')).toEqual([]);
  });
});

describe('isMockCheckout', () => {
  it('detects sandbox order URLs only', () => {
    expect(isMockCheckout('/mockOrder/checkout?code=123')).toBe(true);
    expect(isMockCheckout('https://demo.vivapayments.com/web/checkout')).toBe(false);
  });
});

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
  });

  it('renders without a session (empty router outlet)', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).not.toBeNull();
    expect(compiled.textContent).not.toContain('Welcome');
  });
});
