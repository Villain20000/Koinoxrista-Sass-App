import { PaymentStatus, PrismaClient, Role } from '@prisma/client';
import { hashSync } from 'bcryptjs';

import { splitByLargestRemainder } from '../src/prisma/split-by-largest-remainder';
import { aggregateRun } from '../src/invoices/run-invoices';

const prisma = new PrismaClient();

// bcryptjs + 10 rounds, identical to apps/api/src/auth/auth.service.ts.
const BCRYPT_ROUNDS = 10;

const BUILDING_NAME = 'Κατάστημα Αστυνομίας 12';
const BUILDING_ADDRESS = 'Εγνατία 12';
const BUILDING_CITY = 'Thessaloniki';

/** 12 units whose millimes sum to EXACTLY 1000. */
const MILLIMES = [120, 120, 110, 110, 90, 90, 70, 70, 60, 60, 50, 50];

/** Radiators per unit; larger millimes → more radiators (θέρμανση ανά καλοριφέρ). */
const RADIATORS = [4, 4, 3, 3, 3, 3, 2, 2, 2, 2, 1, 1];

function previousPeriod(now: Date = new Date()): string {
  const previous = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );
  const month = String(previous.getUTCMonth() + 1).padStart(2, '0');
  return `${previous.getUTCFullYear()}-${month}`;
}

async function main(): Promise<void> {
  // ── Building ────────────────────────────────────────────────────────────
  let building = await prisma.building.findFirst({
    where: { name: BUILDING_NAME, address: BUILDING_ADDRESS },
  });
  if (!building) {
    building = await prisma.building.create({
      data: {
        name: BUILDING_NAME,
        address: BUILDING_ADDRESS,
        city: BUILDING_CITY,
      },
    });
  }

  // ── Units Α1..Α6 (floors 1-2), Β1..Β6 (floors 3-4) ──────────────────────
  const units = [];
  for (let i = 0; i < 12; i++) {
    const label = i < 6 ? `Α${i + 1}` : `Β${i - 5}`;
    const floor = Math.floor(i / 3) + 1;
    units.push(
      await prisma.unit.upsert({
        where: { buildingId_label: { buildingId: building.id, label } },
        create: {
          buildingId: building.id,
          label,
          floor,
          millimes: MILLIMES[i],
          radiatorCount: RADIATORS[i],
        },
        update: { floor, millimes: MILLIMES[i], radiatorCount: RADIATORS[i] },
      }),
    );
  }
  const millimesTotal = units.reduce((sum, unit) => sum + unit.millimes, 0);
  if (millimesTotal !== 1000) {
    throw new Error(`millimes must total 1000, got ${millimesTotal}`);
  }

  // ── Users ───────────────────────────────────────────────────────────────
  const admin = await prisma.user.upsert({
    where: { email: 'admin@demo.gr' },
    create: {
      email: 'admin@demo.gr',
      passwordHash: hashSync('Admin1234!', BCRYPT_ROUNDS),
      firstName: 'Γιώργος',
      lastName: 'Παπαδόπουλος',
      role: Role.ADMIN,
      buildingId: building.id,
    },
    update: {
      passwordHash: hashSync('Admin1234!', BCRYPT_ROUNDS),
      role: Role.ADMIN,
      buildingId: building.id,
    },
  });

  const maria = await prisma.user.upsert({
    where: { email: 'maria@demo.gr' },
    create: {
      email: 'maria@demo.gr',
      passwordHash: hashSync('Password123!', BCRYPT_ROUNDS),
      firstName: 'Μαρία',
      lastName: 'Ιωάννου',
      role: Role.RESIDENT,
      buildingId: building.id,
    },
    update: {
      passwordHash: hashSync('Password123!', BCRYPT_ROUNDS),
      buildingId: building.id,
    },
  });

  const nikos = await prisma.user.upsert({
    where: { email: 'nikos@demo.gr' },
    create: {
      email: 'nikos@demo.gr',
      passwordHash: hashSync('Password123!', BCRYPT_ROUNDS),
      firstName: 'Νίκος',
      lastName: 'Ελευθερίου',
      role: Role.RESIDENT,
      buildingId: building.id,
    },
    update: {
      passwordHash: hashSync('Password123!', BCRYPT_ROUNDS),
      buildingId: building.id,
    },
  });

  const provider = await prisma.user.upsert({
    where: { email: 'provider@demo.gr' },
    create: {
      email: 'provider@demo.gr',
      passwordHash: hashSync('Password123!', BCRYPT_ROUNDS),
      firstName: 'Δημήτρης',
      lastName: 'Αναστασιάδης',
      role: Role.PROVIDER,
    },
    update: {
      passwordHash: hashSync('Password123!', BCRYPT_ROUNDS),
    },
  });
  await prisma.providerProfile.upsert({
    where: { userId: provider.id },
    create: {
      userId: provider.id,
      trade: 'Υδραυλικός',
      certs: ['Άδεια εργολάβου Υδραυλικών'],
      city: 'Thessaloniki',
      bio: 'Υδραυλικές εγκαταστάσεις και επισκευές σε πολυκατοικίες από το 2005.',
      hourlyRateCents: 3500,
    },
    update: { city: 'Thessaloniki', hourlyRateCents: 3500 },
  });

  // ── Second provider (Phase 6 directory): Ηλεκτρολόγος ──────────────────
  const electrician = await prisma.user.upsert({
    where: { email: 'electrician@demo.gr' },
    create: {
      email: 'electrician@demo.gr',
      passwordHash: hashSync('Password123!', BCRYPT_ROUNDS),
      firstName: 'Κώστας',
      lastName: 'Δημητριάδης',
      role: Role.PROVIDER,
    },
    update: {
      passwordHash: hashSync('Password123!', BCRYPT_ROUNDS),
    },
  });
  await prisma.providerProfile.upsert({
    where: { userId: electrician.id },
    create: {
      userId: electrician.id,
      trade: 'Ηλεκτρολόγος',
      certs: ['Άδεια ηλεκτρολόγου Α΄ ειδικότητας'],
      city: 'Kalamaria',
      bio: 'Βραχυκυκλώματα, ανελκυστήρες και πινακίδες με πιστοποίηση ΕΛΟΤ.',
      hourlyRateCents: 4000,
    },
    update: { city: 'Kalamaria', hourlyRateCents: 4000 },
  });

  // ── Multi-building demo (Phase 4): second building + ADMIN memberships ──
  const SECOND_BUILDING_NAME = 'Δευτέρα Παράταξη 8';
  const SECOND_BUILDING_ADDRESS = 'Τσιμισκή 8';
  let secondBuilding = await prisma.building.findFirst({
    where: { name: SECOND_BUILDING_NAME, address: SECOND_BUILDING_ADDRESS },
  });
  if (!secondBuilding) {
    secondBuilding = await prisma.building.create({
      data: {
        name: SECOND_BUILDING_NAME,
        address: SECOND_BUILDING_ADDRESS,
        city: BUILDING_CITY,
      },
    });
  }

  const SECOND_MILLIMES = [300, 250, 250, 200];
  const SECOND_RADIATORS = [3, 2, 2, 1];
  for (let i = 0; i < 4; i++) {
    const label = `Γ${i + 1}`;
    await prisma.unit.upsert({
      where: {
        buildingId_label: { buildingId: secondBuilding.id, label },
      },
      create: {
        buildingId: secondBuilding.id,
        label,
        floor: i + 1,
        millimes: SECOND_MILLIMES[i],
        radiatorCount: SECOND_RADIATORS[i],
      },
      update: {
        floor: i + 1,
        millimes: SECOND_MILLIMES[i],
        radiatorCount: SECOND_RADIATORS[i],
      },
    });
  }

  for (const target of [
    { userId: admin.id, buildingId: building.id },
    { userId: admin.id, buildingId: secondBuilding.id },
  ]) {
    await prisma.membership.upsert({
      where: { userId_buildingId: target },
      create: { ...target, role: Role.ADMIN, isDefault: false },
      update: {},
    });
  }
  await prisma.membership.updateMany({
    where: { userId: admin.id, buildingId: building.id },
    data: { isDefault: true },
  });

  // ── Ownership rows: 2 units per resident ────────────────────────────────
  const ownershipPlan: Array<{ userId: string; unitIndexes: number[] }> = [
    { userId: maria.id, unitIndexes: [0, 6] }, // Α1 + Β1
    { userId: nikos.id, unitIndexes: [2, 8] }, // Α3 + Β3
  ];
  for (const plan of ownershipPlan) {
    for (const unitIndex of plan.unitIndexes) {
      const unit = units[unitIndex];
      const existing = await prisma.ownership.findFirst({
        where: { unitId: unit.id, userId: plan.userId },
      });
      if (!existing) {
        await prisma.ownership.create({
          data: {
            unitId: unit.id,
            userId: plan.userId,
            shareMillimes: unit.millimes,
            periodStart: new Date(
              `${new Date().getUTCFullYear()}-01-01T00:00:00Z`,
            ),
          },
        });
      }
    }
  }

  // ── Expense categories ──────────────────────────────────────────────────
  const categoryByName = async (
    name: string,
    strategy: 'MILIMES' | 'UNITS' | 'RADIATORS',
  ) => {
    const existing = await prisma.expenseCategory.findFirst({
      where: { buildingId: building.id, name },
    });
    if (existing) return existing;
    return prisma.expenseCategory.create({
      data: { buildingId: building.id, name, strategy },
    });
  };

  const cleaning = await categoryByName('Καθαριότητα', 'MILIMES');
  const elevator = await categoryByName('Ανελκυστήρας', 'MILIMES');
  const power = await categoryByName('Ρεύμα κοινόχρηστο', 'UNITS');
  const heating = await categoryByName('Θέρμανση', 'RADIATORS');

  // ── Recurring template (Phase 9): monthly auto-billed elevator fee ─────
  const recurringName = 'Συντήρηση ανελκυστήρα (μηνιαίο πάγιο)';
  const existingRecurring = await prisma.recurringExpense.findFirst({
    where: { buildingId: building.id, name: recurringName },
  });
  if (!existingRecurring) {
    await prisma.recurringExpense.create({
      data: {
        buildingId: building.id,
        name: recurringName,
        categoryId: elevator.id,
        amountCents: 8000,
        strategy: 'MILIMES',
        active: true,
      },
    });
  }

  // ── Compliance registry (Phase 15): building insurance + elevator cert ──
  const year = new Date().getUTCFullYear();
  const existingCompliance = await prisma.complianceItem.findFirst({
    where: { buildingId: building.id },
  });
  if (!existingCompliance) {
    await prisma.complianceItem.createMany({
      data: [
        {
          buildingId: building.id,
          kind: 'INSURANCE',
          title: 'Κτιριακή ασφάλιση πολυκατοικίας',
          providerName: 'Ελληνική Ασφαλιστική',
          policyNumber: 'POL-2026-0042',
          premiumCents: 42_000,
          startsOn: new Date(Date.UTC(year, 0, 1)),
          endsOn: new Date(Date.UTC(year, 11, 31)),
          notes: 'Ν.4756/2020 υποχρεωτική κτιριακή ασφάλιση.',
        },
        {
          buildingId: building.id,
          kind: 'ELEVATOR_CERTIFICATE',
          title: 'Πιστοποιητικό επιθεώρησης ανελκυστήρα',
          providerName: 'TÜV Hellas',
          policyNumber: 'EL-CERT-1188',
          premiumCents: null,
          startsOn: new Date(Date.UTC(year, 2, 10)),
          endsOn: new Date(Date.UTC(year + 1, 2, 9)),
          notes: null,
        },
      ],
    });
  }

  // ── Budget lines (Phase 16): annual plan for the current year ───────────
  const existingBudgets = await prisma.budgetLine.findFirst({
    where: { buildingId: building.id, year },
  });
  if (!existingBudgets) {
    await prisma.budgetLine.createMany({
      data: [
        { buildingId: building.id, year, categoryId: cleaning.id, name: 'Καθαριότητα', plannedCents: 180_000 },
        { buildingId: building.id, year, categoryId: elevator.id, name: 'Ανελκυστήρας', plannedCents: 120_000 },
        { buildingId: building.id, year, categoryId: heating.id, name: 'Θέρμανση', plannedCents: 240_000 },
        { buildingId: building.id, year, categoryId: power.id, name: 'Ρεύμα κοινόχρηστο', plannedCents: 150_000 },
      ],
    });
  }

  // ── Expenses for the previous month (shares recomputed inline) ──────────
  const periodYearMonth = previousPeriod();
  const expensePlans = [
    {
      category: cleaning,
      description: 'Καθαριότητα κοινοχρήστων',
      totalCents: 15000,
      strategy: 'MILIMES' as const,
    },
    {
      category: elevator,
      description: 'Συντήρηση ανελκυστήρα',
      totalCents: 8000,
      strategy: 'MILIMES' as const,
    },
    {
      category: power,
      description: 'Πάγιο ρεύματος κοινόχρηστων',
      totalCents: 12000,
      strategy: 'UNITS' as const,
    },
    {
      category: heating,
      description: 'Πετρέλαιο θέρμανσης',
      totalCents: 20000,
      strategy: 'RADIATORS' as const,
    },
  ];

  const expenses = [];
  for (const plan of expensePlans) {
    let expense = await prisma.expense.findFirst({
      where: {
        buildingId: building.id,
        categoryId: plan.category.id,
        description: plan.description,
        periodYearMonth,
      },
    });
    if (!expense) {
      expense = await prisma.expense.create({
        data: {
          buildingId: building.id,
          categoryId: plan.category.id,
          description: plan.description,
          totalCents: plan.totalCents,
          periodYearMonth,
          createdById: admin.id,
        },
      });
    }

    const weights =
      plan.strategy === 'UNITS'
        ? units.map(() => 1)
        : plan.strategy === 'RADIATORS'
          ? units.map((unit) => unit.radiatorCount)
          : units.map((unit) => unit.millimes);
    const splits = splitByLargestRemainder(
      plan.totalCents,
      units.map((unit, index) => ({ id: unit.id, weight: weights[index] })),
    );

    for (const split of splits) {
      await prisma.share.upsert({
        where: {
          expenseId_unitId: { expenseId: expense.id, unitId: split.id },
        },
        create: {
          expenseId: expense.id,
          unitId: split.id,
          amountCents: split.amountCents,
        },
        update: { amountCents: split.amountCents },
      });
    }
    expenses.push(expense);
  }

  // ── Invoice run for the same month (preserves paidCents) ────────────────
  const expensesWithShares = await prisma.expense.findMany({
    where: { buildingId: building.id, periodYearMonth },
    include: { shares: { select: { unitId: true, amountCents: true } } },
  });
  const totals = new Map(
    aggregateRun(expensesWithShares).map((entry) => [
      entry.unitId,
      entry.totalCents,
    ]),
  );
  for (const unit of units) {
    const totalCents = totals.get(unit.id) ?? 0;
    const existing = await prisma.invoice.findUnique({
      where: {
        unitId_periodYearMonth: { unitId: unit.id, periodYearMonth },
      },
    });
    const paidCents = existing?.paidCents ?? 0;
    const status =
      totalCents > 0 && paidCents >= totalCents
        ? PaymentStatus.PAID
        : PaymentStatus.PENDING;
    await prisma.invoice.upsert({
      where: {
        unitId_periodYearMonth: { unitId: unit.id, periodYearMonth },
      },
      create: {
        buildingId: building.id,
        unitId: unit.id,
        periodYearMonth,
        totalCents,
        paidCents,
        status,
      },
      update: { totalCents, status },
    });
  }

  // ── Governance: an open assembly vote (closes in 7 days) ────────────────
  const openVoteTopic = 'Αντικατάσταση ανελκυστήρα';
  const existingOpenVote = await prisma.vote.findFirst({
    where: { buildingId: building.id, topic: openVoteTopic, result: null },
  });
  if (!existingOpenVote) {
    await prisma.vote.create({
      data: {
        buildingId: building.id,
        topic: openVoteTopic,
        description:
          'Το υπάρχον ανυψωτικό μηχάνημα έχει κατασκευαστικό έτος 1985. Προτείνεται η αντικατάστασή του με νέο ενεργειακής κλάσης Α+.',
        thresholdType: 'MILLIMES_MAJORITY',
        opensAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        closesAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  }

  // ── Marketplace: an OPEN RFP job with one submitted bid ─────────────────
  const jobTitle = 'Επισκευή αντλίας νερού υπογείου';
  let job = await prisma.job.findFirst({
    where: { buildingId: building.id, title: jobTitle },
  });
  if (!job) {
    job = await prisma.job.create({
      data: {
        buildingId: building.id,
        title: jobTitle,
        description:
          'Η αντλία του δοχείου πίεσης παρουσιάζει διαρροή. Απαιτείται επίσκεψη, εκτίμηση και επισκευή ή αντικατάσταση.',
        budgetCents: 50000,
      },
    });
  }
  const existingBid = await prisma.bid.findFirst({
    where: { jobId: job.id, providerUserId: provider.id },
  });
  if (!existingBid) {
    await prisma.bid.create({
      data: {
        jobId: job.id,
        providerUserId: provider.id,
        amountCents: 45000,
        message: 'Περιλαμβάνει επίσκεψη, ανταλλακτικά και εγγύηση 2 ετών.',
      },
    });
  }

  // ── Overdue cycle (3 months back) so the arrears dashboard has data ─────
  const now = new Date();
  const overduePeriodDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1),
  );
  const overduePeriod = `${overduePeriodDate.getUTCFullYear()}-${String(
    overduePeriodDate.getUTCMonth() + 1,
  ).padStart(2, '0')}`;
  const overdueDescription = 'Καθαριότητα κοινοχρήστων';
  let overdueExpense = await prisma.expense.findFirst({
    where: {
      buildingId: building.id,
      categoryId: cleaning.id,
      description: overdueDescription,
      periodYearMonth: overduePeriod,
    },
  });
  if (!overdueExpense) {
    overdueExpense = await prisma.expense.create({
      data: {
        buildingId: building.id,
        categoryId: cleaning.id,
        description: overdueDescription,
        totalCents: 15000,
        periodYearMonth: overduePeriod,
        createdById: admin.id,
      },
    });
    const overdueSplits = splitByLargestRemainder(
      15000,
      units.map((unit) => ({ id: unit.id, weight: unit.millimes })),
    );
    for (const split of overdueSplits) {
      await prisma.share.create({
        data: {
          expenseId: overdueExpense.id,
          unitId: split.id,
          amountCents: split.amountCents,
        },
      });
    }
    const overdueTotals = new Map(
      aggregateRun([
        {
          ...overdueExpense,
          shares: await prisma.share.findMany({
            where: { expenseId: overdueExpense.id },
            select: { unitId: true, amountCents: true },
          }),
        },
      ]).map((entry) => [entry.unitId, entry.totalCents]),
    );
    for (const unit of units) {
      await prisma.invoice.upsert({
        where: {
          unitId_periodYearMonth: {
            unitId: unit.id,
            periodYearMonth: overduePeriod,
          },
        },
        create: {
          buildingId: building.id,
          unitId: unit.id,
          periodYearMonth: overduePeriod,
          totalCents: overdueTotals.get(unit.id) ?? 0,
          paidCents: 0,
          status: PaymentStatus.PENDING,
        },
        update: {},
      });
    }
  }

  const counts = {
    building: building.name,
    units: await prisma.unit.count({ where: { buildingId: building.id } }),
    users: await prisma.user.count(),
    ownerships: await prisma.ownership.count(),
    expenseCategories: await prisma.expenseCategory.count(),
    recurringTemplates: await prisma.recurringExpense.count({
      where: { buildingId: building.id },
    }),
    expenses: await prisma.expense.count(),
    shares: await prisma.share.count(),
    invoices: await prisma.invoice.count({ where: { periodYearMonth } }),
    votes: await prisma.vote.count({ where: { buildingId: building.id } }),
    jobs: await prisma.job.count({ where: { buildingId: building.id } }),
    bids: await prisma.bid.count(),
    overduePeriod,
    periodYearMonth,
  };
  console.log('Seed completed:', JSON.stringify(counts, null, 2));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
