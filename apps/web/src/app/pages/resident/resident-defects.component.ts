import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, catchError } from 'rxjs';
import { JobWithBids, JobsApiService, jobStatusBadge } from '../../core/api/jobs-api.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../ui/toast.service';

/** A job row flagged as a resident defect report (source comes from Job). */
export type DefectRow = JobWithBids;

/** Keeps only jobs reported by residents (pure). */
export function ownReports(jobs: readonly DefectRow[]): DefectRow[] {
  return jobs.filter((job) => job.source === 'RESIDENT_REPORT');
}

@Component({
  selector: 'app-resident-defects',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Βλάβες</h1>

    <div class="card mb-8 max-w-xl">
      <h2 class="card-title">Νέα αναφορά βλάβης</h2>
      <form [formGroup]="form" (ngSubmit)="submit()" class="grid gap-4">
        <div>
          <label class="label" for="title">Τίτλος</label>
          <input id="title" type="text" class="input" formControlName="title" />
          @if (submitted() && form.controls.title.invalid) {
            <p class="field-error">Ο τίτλος είναι υποχρεωτικός.</p>
          }
        </div>
        <div>
          <label class="label" for="description">Περιγραφή</label>
          <textarea id="description" rows="3" class="input" formControlName="description"></textarea>
          @if (submitted() && form.controls.description.invalid) {
            <p class="field-error">Η περιγραφή είναι υποχρεωτική.</p>
          }
        </div>
        <div>
          <button type="submit" class="btn btn-primary" [disabled]="saving()">
            Υποβολή αναφοράς
          </button>
        </div>
      </form>
    </div>

    <h2 class="card-title mb-3">Οι αναφορές μου</h2>

    @if (loading()) {
      <div class="card text-sm text-slate-500">Φόρτωση…</div>
    } @else if (error()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης αναφορών.
      </div>
    } @else {
      <div class="flex flex-col gap-4">
        @for (report of reports(); track report.id) {
          <div class="card">
            <div class="flex items-start justify-between gap-2">
              <div>
                <h3 class="font-semibold text-slate-900">{{ report.title }}</h3>
                <p class="mt-1 text-sm text-slate-600">{{ report.description }}</p>
              </div>
              <span class="badge shrink-0" [class]="jobStatusBadge(report.status).cls">
                {{ jobStatusBadge(report.status).label }}
              </span>
            </div>
          </div>
        } @empty {
          <div class="card text-sm text-slate-500">Δεν έχετε υποβάλει αναφορές ακόμη.</div>
        }
      </div>
    }
  `,
})
export class ResidentDefectsPage implements OnInit {
  private readonly jobsApi = inject(JobsApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly jobStatusBadge = jobStatusBadge;

  protected readonly reports = signal<DefectRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    title: ['', Validators.required],
    description: ['', Validators.required],
  });

  ngOnInit(): void {
    this.reload();
  }

  protected reload(): void {
    const buildingId = this.auth.currentUser()?.buildingId ?? null;
    if (!buildingId) {
      this.loading.set(false);
      this.error.set(true);
      return;
    }
    this.loading.set(true);
    this.error.set(false);
    this.jobsApi
      .listForBuilding(buildingId)
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((jobs) => {
        this.reports.set(ownReports(jobs));
        this.loading.set(false);
      });
  }

  protected submit(): void {
    const buildingId = this.auth.currentUser()?.buildingId ?? null;
    this.submitted.set(true);
    if (!buildingId || this.form.invalid || this.saving()) return;
    const { title, description } = this.form.getRawValue();
    this.saving.set(true);
    this.jobsApi
      .createDefect(buildingId, {
        title: title.trim(),
        description: description.trim(),
      })
      .pipe(
        catchError(() => {
          this.toast.error('Η υποβολή της αναφοράς απέτυχε.');
          this.saving.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.toast.success('Η αναφορά καταχωρήθηκε');
        this.saving.set(false);
        this.submitted.set(false);
        this.form.reset({ title: '', description: '' });
        this.reload();
      });
  }
}
