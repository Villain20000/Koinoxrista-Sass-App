import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, catchError, forkJoin, of } from 'rxjs';
import type { AgendaItemDto, AttendanceDto } from '@org/shared';
import { AssemblyApiService } from '../../core/api/assembly-api.service';
import { RealtimeService } from '../../core/realtime.service';
import { ConfirmModalComponent } from '../../ui/confirm-modal.component';
import { ToastService } from '../../ui/toast.service';

/** Live quorum meter snapshot derived from attendance rows (pure). */
export interface AssemblyMeter {
  unitsTotal: number;
  unitsPresent: number;
  totalMillimes: number;
  millimesPresent: number;
  presentPermille: number;
  quorumMet: boolean;
}

/**
 * Client-side mirror of the server quorum line (present ≥ half of total
 * millimes, proxies included) so the meter reacts instantly between reloads.
 */
export function attendanceStatsOf(rows: AttendanceDto[]): AssemblyMeter {
  const totalMillimes = rows.reduce((sum, row) => sum + row.millimes, 0);
  const present = rows.filter((row) => row.present);
  const millimesPresent = present.reduce((sum, row) => sum + row.millimes, 0);
  return {
    unitsTotal: rows.length,
    unitsPresent: present.length,
    totalMillimes,
    millimesPresent,
    presentPermille:
      totalMillimes > 0
        ? Math.floor((millimesPresent * 1000) / totalMillimes)
        : 0,
    quorumMet:
      totalMillimes === 0
        ? true
        : millimesPresent * 2 >= totalMillimes,
  };
}

/**
 * Swap-based reorder patches for moving one agenda item a slot up/down.
 * Returns an empty array at the boundaries (pure).
 */
export function reorderedPositions(
  items: AgendaItemDto[],
  id: string,
  delta: -1 | 1,
): { id: string; position: number }[] {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const index = sorted.findIndex((item) => item.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= sorted.length) return [];
  const moved = sorted[index];
  const neighbour = sorted[target];
  return [
    { id: neighbour.id, position: moved.position },
    { id: moved.id, position: neighbour.position },
  ];
}

const BALLOT_LABELS: Record<string, string> = {
  YES: 'ΝΑΙ',
  NO: 'ΟΧΙ',
  ABSTAIN: 'ΑΠΟΧΗ',
};

@Component({
  selector: 'app-admin-assembly',
  imports: [ReactiveFormsModule, RouterLink, ConfirmModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-bold text-slate-900">Διαδικτυακή συνέλευση</h1>
      <a routerLink="/admin/praktiko/{{ voteId() }}" class="btn btn-primary">
        Πρακτικό
      </a>
    </div>

    @if (error()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης συνέλευσης.
      </div>
    } @else {
      <section class="card mb-6">
        <h2 class="card-title">Κορμός & παρουσίες</h2>
        <p class="mb-3 text-sm text-slate-600">
          Παρόντα χιλιοστά: <strong>{{ meter().millimesPresent }}</strong>
          από <strong>{{ meter().totalMillimes }}</strong>
          ({{ meter().presentPermille }}‰) ·
          Διαμερίσματα: {{ meter().unitsPresent }}/{{ meter().unitsTotal }}
        </p>
        <div class="mb-2 h-3 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            class="h-full rounded-full transition-all"
            [class.bg-green-600]="meter().quorumMet"
            [class.bg-amber-500]="!meter().quorumMet"
            [style.width.%]="meter().presentPermille / 10"
          ></div>
        </div>
        <span class="badge" [class]="quorumBadge().cls">
          {{ quorumBadge().label }}
        </span>
      </section>

      <section class="card mb-6">
        <h2 class="card-title">Ημερήσια διάταξη</h2>
        <ol class="mb-4 divide-y divide-slate-100">
          @for (item of agenda(); track item.id) {
            <li class="flex items-start justify-between gap-3 py-3">
              @if (editingId() === item.id) {
                <form
                  [formGroup]="editForm"
                  (ngSubmit)="saveEdit(item.id)"
                  class="flex-1 space-y-2"
                >
                  <input type="text" class="input" formControlName="title" />
                  <textarea rows="2" class="input" formControlName="body"></textarea>
                  <div class="flex gap-2">
                    <button type="submit" class="btn btn-primary !px-3 !py-1 text-xs">
                      Αποθήκευση
                    </button>
                    <button
                      type="button"
                      class="btn btn-secondary !px-3 !py-1 text-xs"
                      (click)="cancelEdit()"
                    >
                      Άκυρο
                    </button>
                  </div>
                </form>
              } @else {
                <div class="min-w-0">
                  <p class="font-medium text-slate-900">
                    {{ item.position }}. {{ item.title }}
                  </p>
                  @if (item.body) {
                    <p class="text-sm text-slate-600">{{ item.body }}</p>
                  }
                </div>
                <div class="flex shrink-0 gap-1">
                  <button
                    type="button"
                    class="btn btn-secondary !px-2 !py-1 text-xs"
                    [disabled]="reordering()"
                    (click)="move(item, -1)"
                    aria-label="Μετακίνηση πάνω"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    class="btn btn-secondary !px-2 !py-1 text-xs"
                    [disabled]="reordering()"
                    (click)="move(item, 1)"
                    aria-label="Μετακίνηση κάτω"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    class="btn btn-secondary !px-3 !py-1 text-xs"
                    (click)="startEdit(item)"
                  >
                    Επεξεργασία
                  </button>
                  <button
                    type="button"
                    class="btn btn-danger !px-3 !py-1 text-xs"
                    (click)="confirmDelete.set(item)"
                  >
                    Διαγραφή
                  </button>
                </div>
              }
            </li>
          } @empty {
            <li class="py-3 text-sm text-slate-500">
              Καμία θεματική ενότητα ακόμη — προσθέστε την πρώτη παρακάτω.
            </li>
          }
        </ol>

        <form [formGroup]="addForm" (ngSubmit)="addItem()" class="space-y-2">
          <label class="label" for="agenda-title">Νέο θέμα</label>
          <input
            id="agenda-title"
            type="text"
            class="input"
            formControlName="title"
            placeholder="π.χ. Έγκριση προϋπολογισμού"
          />
          <textarea
            rows="2"
            class="input"
            formControlName="body"
            placeholder="Περιγραφή (προαιρετικό)"
          ></textarea>
          @if (addSubmitted() && addForm.controls.title.invalid) {
            <p class="field-error">Ο τίτλος είναι υποχρεωτικός.</p>
          }
          <button
            type="submit"
            class="btn btn-secondary"
            [disabled]="adding()"
          >
            Προσθήκη στη διάταξη
          </button>
        </form>
      </section>

      <section class="card">
        <h2 class="card-title">Παρουσίες διαμερισμάτων</h2>
        @if (loading()) {
          <p class="text-sm text-slate-500">Φόρτωση…</p>
        } @else {
          <div class="overflow-x-auto">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Διαμέρισμα</th>
                  <th class="text-right">Χιλιοστά</th>
                  <th>Παρουσία</th>
                  <th>Αντιπρόσωπος</th>
                  <th>Ψήφος εξ αποστάσεως</th>
                </tr>
              </thead>
              <tbody>
                @for (row of attendance(); track row.unitId) {
                  <tr>
                    <td class="whitespace-nowrap font-medium">{{ row.unitLabel }}</td>
                    <td class="text-right">{{ row.millimes }}</td>
                    <td>
                      <button
                        type="button"
                        class="btn btn-secondary !px-3 !py-1 text-xs"
                        [class.bg-green-600]="row.present"
                        [class.text-white]="row.present"
                        [class.border-green-600]="row.present"
                        [disabled]="busyUnitId() === row.unitId"
                        (click)="togglePresence(row)"
                      >
                        {{ row.present ? 'Παρών ✓' : 'Απών' }}
                      </button>
                      @if (row.proxyUnitId) {
                        <span class="ml-2 text-xs text-slate-500">δια πληρεξουσίου</span>
                      }
                    </td>
                    <td class="text-xs text-slate-500">
                      {{ proxyLabel(row.proxyUnitId) }}
                    </td>
                    <td>
                      @if (row.ballotChoice) {
                        <span class="badge bg-blue-100 text-blue-800">
                          {{ BALLOT_LABELS[row.ballotChoice] }}
                        </span>
                        @if (!row.present) {
                          <span class="ml-2 text-xs font-medium text-amber-700">
                            Εκκρεμεί καταχώρηση παρουσίας
                          </span>
                        }
                      } @else {
                        <span class="text-xs text-slate-400">—</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    }

    @if (confirmDelete(); as item) {
      <app-confirm-modal
        title="Διαγραφή θέματος"
        [message]="'Θα αφαιρεθεί το «' + item.title + '» από τη διάταξη.'"
        confirmLabel="Διαγραφή"
        [danger]="true"
        (confirmed)="deleteItem()"
        (cancelled)="confirmDelete.set(null)"
      />
    }
  `,
})
export class AdminAssemblyPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(AssemblyApiService);
  private readonly realtime = inject(RealtimeService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly BALLOT_LABELS = BALLOT_LABELS;

  protected readonly voteId = signal('');
  protected readonly agenda = signal<AgendaItemDto[]>([]);
  protected readonly attendance = signal<AttendanceDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  protected readonly adding = signal(false);
  protected readonly addSubmitted = signal(false);
  protected readonly reordering = signal(false);
  protected readonly busyUnitId = signal<string | null>(null);
  protected readonly editingId = signal<string | null>(null);
  protected readonly confirmDelete = signal<AgendaItemDto | null>(null);

  protected readonly meter = computed(() =>
    attendanceStatsOf(this.attendance()),
  );
  protected readonly quorumBadge = computed(() =>
    this.meter().quorumMet
      ? { cls: 'bg-green-100 text-green-800', label: 'Κορμός επιτεύχθηκε' }
      : { cls: 'bg-amber-100 text-amber-800', label: 'Δεν επιτεύχθηκε κορμός' },
  );

  protected readonly addForm = this.fb.nonNullable.group({
    title: ['', Validators.required],
    body: [''],
  });

  protected readonly editForm = this.fb.nonNullable.group({
    title: ['', Validators.required],
    body: [''],
  });

  ngOnInit(): void {
    const param =
      this.route.snapshot.paramMap.get('id') ??
      this.route.snapshot.paramMap.get('voteId');
    if (!param) {
      this.error.set(true);
      this.loading.set(false);
      return;
    }
    this.voteId.set(param);
    this.reload();

    // Live quorum meter: refresh attendance when someone checks in.
    this.attendanceHandler = (event) => {
      if (event.voteId === this.voteId()) this.reload();
    };
    this.realtime.on<{ voteId: string }>('assembly.attendance', this.attendanceHandler);
  }

  private attendanceHandler: ((data: { voteId: string }) => void) | null = null;

  ngOnDestroy(): void {
    if (this.attendanceHandler) {
      this.realtime.off<{ voteId: string }>('assembly.attendance', this.attendanceHandler);
    }
  }

  protected reload(): void {
    const voteId = this.voteId();
    this.loading.set(true);
    this.error.set(false);
    forkJoin({
      agenda: this.api.agenda(voteId).pipe(
        catchError(() => {
          this.error.set(true);
          return of(null);
        }),
      ),
      attendance: this.api.attendance(voteId).pipe(
        catchError(() => {
          this.error.set(true);
          return of(null);
        }),
      ),
    }).subscribe(({ agenda, attendance }) => {
      if (agenda) this.agenda.set(agenda);
      if (attendance) this.attendance.set(attendance);
      this.loading.set(false);
    });
  }

  protected addItem(): void {
    this.addSubmitted.set(true);
    if (this.addForm.invalid || this.adding()) return;
    const { title, body } = this.addForm.getRawValue();
    this.adding.set(true);
    this.api
      .addAgendaItem(this.voteId(), {
        title: title.trim(),
        ...(body.trim() ? { body: body.trim() } : {}),
      })
      .pipe(
        catchError(() => {
          this.toast.error('Η προσθήκη απέτυχε.');
          this.adding.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.toast.success('Το θέμα προστέθηκε.');
        this.adding.set(false);
        this.addSubmitted.set(false);
        this.addForm.reset({ title: '', body: '' });
        this.reload();
      });
  }

  protected startEdit(item: AgendaItemDto): void {
    this.editingId.set(item.id);
    this.editForm.setValue({ title: item.title, body: item.body ?? '' });
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
  }

  protected saveEdit(id: string): void {
    if (this.editForm.invalid) return;
    const { title, body } = this.editForm.getRawValue();
    this.api
      .updateAgendaItem(id, {
        title: title.trim(),
        body: body.trim(),
      })
      .pipe(
        catchError(() => {
          this.toast.error('Η αποθήκευση απέτυχε.');
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.toast.success('Το θέμα ενημερώθηκε.');
        this.editingId.set(null);
        this.reload();
      });
  }

  protected move(item: AgendaItemDto, delta: -1 | 1): void {
    const patches = reorderedPositions(this.agenda(), item.id, delta);
    if (!patches.length || this.reordering()) return;
    this.reordering.set(true);
    forkJoin(
      patches.map((patch) => this.api.updateAgendaItem(patch.id, patch)),
    )
      .pipe(
        catchError(() => {
          this.toast.error('Η αναδιάταξη απέτυχε.');
          this.reordering.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.reordering.set(false);
        this.reload();
      });
  }

  protected deleteItem(): void {
    const item = this.confirmDelete();
    this.confirmDelete.set(null);
    if (!item) return;
    this.api
      .deleteAgendaItem(item.id)
      .pipe(
        catchError(() => {
          this.toast.error('Η διαγραφή απέτυχε.');
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.toast.success('Το θέμα διαγράφηκε.');
        this.reload();
      });
  }

  protected togglePresence(row: AttendanceDto): void {
    if (this.busyUnitId()) return;
    this.busyUnitId.set(row.unitId);
    this.api
      .toggleAttendance(this.voteId(), {
        unitId: row.unitId,
        present: !row.present,
      })
      .pipe(
        catchError(() => {
          this.toast.error('Η αλλαγή παρουσίας απέτυχε.');
          this.busyUnitId.set(null);
          return EMPTY;
        }),
      )
      .subscribe((updated) => {
        this.attendance.update((rows) =>
          rows.map((r) =>
            r.unitId === updated.unitId
              ? { ...r, ...updated, ballotChoice: r.ballotChoice }
              : r,
          ),
        );
        this.busyUnitId.set(null);
      });
  }

  protected proxyLabel(proxyUnitId: string | null | undefined): string {
    if (!proxyUnitId) return '—';
    const proxy = this.attendance().find((row) => row.unitId === proxyUnitId);
    return proxy ? `Εκπροσωπείται από ${proxy.unitLabel}` : proxyUnitId;
  }
}
