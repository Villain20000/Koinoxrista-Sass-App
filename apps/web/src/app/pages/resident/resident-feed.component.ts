import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, catchError, finalize } from 'rxjs';
import type {
  AnnouncementCommentDto,
  AnnouncementDto,
} from '@org/shared';
import { AuthService } from '../../core/auth.service';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import {
  AnnouncementsApiService,
} from '../../core/api/announcements-api.service';
import { ToastService } from '../../ui/toast.service';

/** Groups the feed into day buckets; pinned items stay first in their group. */
export function groupByDay(
  items: AnnouncementDto[],
): { day: string; items: AnnouncementDto[] }[] {
  const groups: { day: string; items: AnnouncementDto[] }[] = [];
  const indexByDay = new Map<string, number>();
  for (const item of items) {
    const day = new Date(item.createdAt).toLocaleDateString('el-GR', {
      dateStyle: 'full',
    });
    let index = indexByDay.get(day);
    if (index === undefined) {
      index = groups.length;
      indexByDay.set(day, index);
      groups.push({ day, items: [] });
    }
    groups[index].items.push(item);
  }
  return groups;
}

@Component({
  selector: 'app-resident-feed',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Ανακοινώσεις</h1>

    @if (loading()) {
      <div class="card text-sm text-slate-500">Φόρτωση…</div>
    } @else if (error()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης ανακοινώσεων.
      </div>
    } @else {
      <div class="flex flex-col gap-5">
        @for (group of feed(); track group.day) {
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {{ group.day }}
          </p>
          @for (item of group.items; track item.id) {
            <article class="card flex flex-col gap-3">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <h2 class="font-semibold text-slate-900">
                    @if (item.pinned) {
                      <span title="Καρφιτσωμένη" aria-label="Καρφιτσωμένη">📌 </span>
                    }
                    {{ item.title }}
                  </h2>
                  <p class="text-xs text-slate-500">
                    {{ formatDateTime(item.createdAt) }} ·
                    {{ item.authorName || 'Διαχειριστής' }}
                  </p>
                </div>
                @if (item.pinned) {
                  <span class="badge shrink-0 bg-amber-100 text-amber-800">Καρφιτσωμένη</span>
                }
              </div>
              <p class="whitespace-pre-line text-sm text-slate-600">{{ item.body }}</p>

              <div class="border-t border-slate-100 pt-3">
                <button
                  type="button"
                  class="btn btn-secondary !px-2 !py-1 text-xs"
                  (click)="toggleComments(item)"
                >
                  Σχόλια ({{ item.commentsCount }})
                </button>

                @if (openId() === item.id) {
                  <div class="mt-3 flex flex-col gap-3">
                    @for (entry of comments()[item.id]; track entry.id) {
                      <div class="rounded-lg border border-slate-100 bg-slate-50 p-3">
                        <div class="flex items-start justify-between gap-2">
                          <p class="text-xs font-medium text-slate-700">
                            {{ entry.authorName || 'Μέλος' }}
                            <span class="font-normal text-slate-400">·
                              {{ formatDateTime(entry.createdAt) }}
                            </span>
                          </p>
                          @if (canDelete(entry)) {
                            <button
                              type="button"
                              class="text-xs text-red-600 hover:underline"
                              [disabled]="deletingCommentId() === entry.id"
                              (click)="deleteComment(item, entry)"
                            >
                              Διαγραφή
                            </button>
                          }
                        </div>
                        <p class="mt-1 whitespace-pre-line text-sm text-slate-600">
                          {{ entry.body }}
                        </p>
                      </div>
                    } @empty {
                      <p class="text-xs text-slate-500">
                        Κανένα σχόλιο ακόμη — κάντε την πρώτη ερώτηση.
                      </p>
                    }

                    <form
                      [formGroup]="commentForm"
                      (ngSubmit)="postComment(item)"
                      class="flex flex-col gap-2"
                    >
                      <textarea
                        rows="2"
                        class="input"
                        formControlName="body"
                        placeholder="Γράψτε μια ερώτηση ή απάντηση…"
                      ></textarea>
                      @if (commentError()) {
                        <p class="field-error">{{ commentError() }}</p>
                      }
                      <button
                        type="submit"
                        class="btn btn-primary self-start"
                        [disabled]="postingComment()"
                      >
                        Αποστολή
                      </button>
                    </form>
                  </div>
                }
              </div>
            </article>
          }
        } @empty {
          <div class="card text-sm text-slate-500">
            Δεν υπάρχουν ανακοινώσεις ακόμη.
          </div>
        }
      </div>
    }
  `,
})
export class ResidentFeedPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly announcementsApi = inject(AnnouncementsApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly feed = computed(() => groupByDay(this.items()));
  protected readonly items = signal<AnnouncementDto[]>([]);
  protected readonly comments = signal<Record<string, AnnouncementCommentDto[]>>({});
  protected readonly openId = signal<string | null>(null);

  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly postingComment = signal(false);
  protected readonly deletingCommentId = signal<string | null>(null);
  protected readonly commentError = signal<string | null>(null);

  protected readonly commentForm = this.fb.nonNullable.group({
    body: ['', [Validators.required, Validators.maxLength(1000)]],
  });

  private buildingId: string | null = null;

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((building) => {
        this.buildingId = building.id;
        this.reload();
      });
  }

  protected canDelete(entry: AnnouncementCommentDto): boolean {
    const user = this.auth.currentUser();
    return user !== null && (user.role === 'ADMIN' || user.id === entry.authorId);
  }

  protected toggleComments(item: AnnouncementDto): void {
    if (this.openId() === item.id) {
      this.openId.set(null);
      return;
    }
    this.openId.set(item.id);
    if (this.comments()[item.id]) return;
    this.announcementsApi
      .comments(item.id)
      .pipe(catchError(() => EMPTY))
      .subscribe((entries) =>
        this.comments.update((current) => ({ ...current, [item.id]: entries })),
      );
  }

  protected postComment(item: AnnouncementDto): void {
    this.commentError.set(null);
    const body = this.commentForm.getRawValue().body.trim();
    if (!body) {
      this.commentError.set('Το σχόλιο δεν μπορεί να είναι κενό.');
      return;
    }
    if (body.length > 1000) {
      this.commentError.set('Το σχόλιο δεν μπορεί να ξεπερνά τους 1000 χαρακτήρες.');
      return;
    }
    if (this.postingComment()) return;
    this.postingComment.set(true);
    this.announcementsApi
      .addComment(item.id, { body })
      .pipe(finalize(() => this.postingComment.set(false)))
      .subscribe({
        next: (created) => {
          this.commentForm.reset({ body: '' });
          this.toast.success('Το σχόλιο δημοσιεύτηκε.');
          this.comments.update((current) => ({
            ...current,
            [item.id]: [...(current[item.id] ?? []), created],
          }));
          this.bumpCommentsCount(item.id, 1);
        },
        error: () => {
          this.commentError.set('Η αποστολή του σχολίου απέτυχε.');
        },
      });
  }

  protected deleteComment(
    item: AnnouncementDto,
    entry: AnnouncementCommentDto,
  ): void {
    this.deletingCommentId.set(entry.id);
    this.announcementsApi
      .deleteComment(item.id, entry.id)
      .pipe(catchError(() => EMPTY), finalize(() => this.deletingCommentId.set(null)))
      .subscribe(() => {
        this.comments.update((current) => ({
          ...current,
          [item.id]: (current[item.id] ?? []).filter((c) => c.id !== entry.id),
        }));
        this.bumpCommentsCount(item.id, -1);
      });
  }

  protected formatDateTime(iso: string): string {
    return new Date(iso).toLocaleString('el-GR', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  }

  private bumpCommentsCount(announcementId: string, delta: number): void {
    this.items.update((current) =>
      current.map((item) =>
        item.id === announcementId
          ? { ...item, commentsCount: Math.max(0, item.commentsCount + delta) }
          : item,
      ),
    );
  }

  private reload(): void {
    const buildingId = this.buildingId;
    if (!buildingId) return;
    this.loading.set(true);
    this.error.set(false);
    this.announcementsApi
      .feed(buildingId)
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((items) => {
        this.items.set(items);
        this.loading.set(false);
      });
  }
}
