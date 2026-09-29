import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, catchError, forkJoin } from 'rxjs';
import type {
  BuildingAssetDto,
  CalendarEventDto,
  CalendarResponseDto,
  GenerateJobsResultDto,
  MaintenanceScheduleDto,
  AssetCategory,
} from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { CategoriesApiService } from '../../core/api/categories-api.service';
import { MaintenanceApiService } from '../../core/api/maintenance-api.service';
import { ToastService } from '../../ui/toast.service';

type CategoryMeta = { label: string; badgeClass: string };
const CATEGORY_META: Record<AssetCategory, CategoryMeta> = {
  ELEVATOR: { label: 'Ανελκυστήρας', badgeClass: 'bg-sky-100 text-sky-800' },
  BOILER: { label: 'Λέβητας', badgeClass: 'bg-orange-100 text-orange-800' },
  FIRE_EXT: { label: 'Πυρασφάλεια', badgeClass: 'bg-red-100 text-red-700' },
  PUMP: { label: 'Αντλία', badgeClass: 'bg-cyan-100 text-cyan-800' },
  ROOF: { label: 'Ταράτσα', badgeClass: 'bg-slate-200 text-slate-700' },
  OTHER: { label: 'Λοιπά', badgeClass: 'bg-zinc-100 text-zinc-700' },
};

function statusChip(schedule: MaintenanceScheduleDto | CalendarEventDto): { label: string; badgeClass: string } {
  const days = (schedule as any).daysLeft as number;
  if (days < 0) return { label: `Εκπρόθεσμο (${Math.abs(days)} ${Math.abs(days) === 1 ? 'ημέρα' : 'ημέρες'})`, badgeClass: 'bg-red-100 text-red-700' };
  if (days === 0) return { label: 'Σήμερα', badgeClass: 'bg-red-100 text-red-700' };
  if (days <= 3) return { label: `Επείγον (${days} ${days === 1 ? 'ημέρα' : 'ημέρες'})`, badgeClass: 'bg-amber-100 text-amber-800' };
  if (days <= 7) return { label: `Προθεσμία σε ${days} ημέρες`, badgeClass: 'bg-amber-100 text-amber-800' };
  if (days <= 30) return { label: `Σε ${days} ημέρες`, badgeClass: 'bg-blue-100 text-blue-700' };
  return { label: `Σε ${days} ημέρες`, badgeClass: 'bg-green-100 text-green-700' };
}

@Component({
  selector: 'app-admin-maintenance',
  standalone: true,
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-2 text-xl font-bold text-slate-900">Πρόγραμμα προληπτικής συντήρησης</h1>
    <p class="mb-6 text-sm text-slate-500">Μητρώο παγίων, προγραμματισμένες συντηρήσεις & ημερολόγιο.</p>

    <!-- Top actions -->
    <div class="mb-6 flex flex-wrap items-center gap-2">
      <button type="button" class="btn btn-primary" (click)="openAssetModal()" >+ Νέο πάγιο</button>
      <button type="button" class="btn btn-primary" (click)="openScheduleModal()">+ Νέα συντήρηση</button>
      <span class="flex-1"></span>
      <button type="button" class="btn btn-secondary" (click)="generateJobs()" [disabled]="generating()">
        {{ generating() ? 'Δημιουργία...' : 'Δημιουργία εργασιών (30 ημ)' }}
      </button>
      @if (generateResult(); as r) {
        <span class="text-xs text-slate-600">Δημιουργήθηκαν {{r.created}} · παραλείφθηκαν {{r.skipped}}</span>
      }
    </div>

    <!-- Filters -->
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label class="label" for="assetCategoryFilter">Φίλτρο παγίων</label>
        <select id="assetCategoryFilter" class="input" [formControl]="assetCategoryFilter" (change)="reloadAssets()">
          <option value="">Όλες οι κατηγορίες</option>
          @for (c of assetCategories; track c.value) {
            <option [value]="c.value">{{c.label}}</option>
          }
        </select>
      </div>
      <div>
        <label class="label" for="scheduleCategoryFilter">Φίλτρο συντηρήσεων</label>
        <select id="scheduleCategoryFilter" class="input" [formControl]="scheduleCategoryFilter" (change)="reloadSchedules()">
          <option value="">Όλες οι κατηγορίες</option>
          @for (c of assetCategories; track c.value) {
            <option [value]="c.value">{{c.label}}</option>
          }
        </select>
      </div>
      <div>
        <label class="label" for="upcomingDays">Προθεσμία (ημέρες)</label>
        <select id="upcomingDays" class="input" [formControl]="upcomingDaysCtrl" (change)="reloadSchedules()">
          <option value="7">7 ημέρες</option>
          <option value="14">14 ημέρες</option>
          <option value="30">30 ημέρες</option>
          <option value="60">60 ημέρες</option>
          <option value="90">90 ημέρες</option>
          <option value="365">365 ημέρες</option>
        </select>
      </div>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <!-- Assets -->
      <div class="card overflow-x-auto p-0">
        <div class="flex items-center justify-between px-4 py-3">
          <h2 class="card-title !mb-0">Μητρώο παγίων ({{assets().length}})</h2>
          <button type="button" class="btn btn-secondary !px-2 !py-1 text-xs" (click)="reloadAssets()">Ανανέωση</button>
        </div>
        @if (loadErrorAssets()) {
          <div class="border-red-200 bg-red-50 p-3 text-sm text-red-700">Αποτυχία φόρτωσης παγίων.</div>
        }
        <table class="data-table">
          <thead>
            <tr><th>Όνομα</th><th>Κατηγορία</th><th>Τοποθεσία</th><th>Εγκατ/ση</th><th></th></tr>
          </thead>
          <tbody>
            @for (asset of assets(); track asset.id) {
              <tr>
                <td>
                  <span class="font-medium">{{asset.name}}</span>
                  @if (asset.notes) {
                    <span class="block text-xs text-slate-500 line-clamp-1">{{asset.notes}}</span>
                  }
                </td>
                <td><span class="badge" [class]="categoryBadge(asset.category).badgeClass">{{categoryBadge(asset.category).label}}</span></td>
                <td class="text-xs">{{asset.location || '—'}}</td>
                <td class="text-xs whitespace-nowrap">{{ asset.installedAt ? formatDate(asset.installedAt) : '—' }}</td>
                <td class="whitespace-nowrap">
                  <button type="button" class="btn btn-secondary !px-2 !py-1 text-xs" (click)="editAsset(asset)">Επεξ.</button>
                  <button type="button" class="btn btn-secondary ml-1 !px-2 !py-1 text-xs text-red-600" (click)="removeAsset(asset)">Διαγραφή</button>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="py-6 text-center text-sm text-slate-500">Δεν υπάρχουν πάγια ακόμη.</td></tr>
            }
          </tbody>
        </table>
      </div>

      <!-- Schedules -->
      <div class="card overflow-x-auto p-0">
        <div class="flex items-center justify-between px-4 py-3">
          <h2 class="card-title !mb-0">Προγραμματισμένες συντηρήσεις ({{schedules().length}})</h2>
          <button type="button" class="btn btn-secondary !px-2 !py-1 text-xs" (click)="reloadSchedules()">Ανανέωση</button>
        </div>
        @if (loadErrorSchedules()) {
          <div class="border-red-200 bg-red-50 p-3 text-sm text-red-700">Αποτυχία φόρτωσης συντηρήσεων.</div>
        }
        <table class="data-table">
          <thead>
            <tr><th>Τίτλος</th><th>Πάγιο</th><th>Λήξη</th><th>Κατάσταση</th><th></th></tr>
          </thead>
          <tbody>
            @for (sch of schedules(); track sch.id) {
              <tr>
                <td>
                  <span class="font-medium">{{sch.title}}</span>
                  <span class="block text-xs text-slate-500">ανά {{sch.intervalMonths}} {{sch.intervalMonths === 1 ? 'μήνα' : 'μήνες'}}
                    @if (sch.autoCreateJob) { · αυτόματη εργασία } </span>
                </td>
                <td>
                  <span class="text-xs">{{ sch.asset?.name || '—' }}</span>
                  @if (sch.asset?.category) {
                    <span class="badge ml-1 !px-1.5 !py-0 text-[10px]" [class]="categoryBadge(sch.asset?.category).badgeClass">{{categoryBadge(sch.asset?.category).label}}</span>
                  }
                </td>
                <td class="whitespace-nowrap text-xs">{{ formatDate(sch.nextDueAt) }}</td>
                <td><span class="badge" [class]="statusChip(sch).badgeClass">{{statusChip(sch).label}}</span></td>
                <td class="whitespace-nowrap">
                  <button type="button" class="btn btn-primary !px-2 !py-1 text-xs" (click)="markDone(sch)">Ολοκληρώθηκε</button>
                  <button type="button" class="btn btn-secondary ml-1 !px-2 !py-1 text-xs" (click)="editSchedule(sch)">Επεξ.</button>
                  <button type="button" class="btn btn-secondary ml-1 !px-2 !py-1 text-xs text-red-600" (click)="removeSchedule(sch)">🗑</button>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="py-6 text-center text-sm text-slate-500">Καμία προγραμματισμένη συντήρηση στην περίοδο.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>

    <!-- Calendar -->
    <div class="card mt-6 p-0">
      <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <h2 class="card-title !mb-0">Ημερολόγιο συντήρησης — {{ calendarTitle() }}</h2>
        <div class="flex items-center gap-2">
          <button type="button" class="btn btn-secondary !px-2 !py-1" (click)="shiftCalendar(-1)">‹</button>
          <button type="button" class="btn btn-secondary !px-2 !py-1" (click)="shiftCalendar(0)">Σήμερα</button>
          <button type="button" class="btn btn-secondary !px-2 !py-1" (click)="shiftCalendar(1)">›</button>
          <button type="button" class="btn btn-secondary !px-2 !py-1 text-xs" (click)="reloadCalendar()">Ανανέωση</button>
        </div>
      </div>
      @if (calendar(); as cal) {
        <!-- Grid header weekdays -->
        <div class="grid grid-cols-7 gap-px bg-slate-200">
          @for (wd of weekdays; track wd) {
            <div class="bg-slate-50 px-2 py-1 text-center text-xs font-semibold text-slate-600">{{wd}}</div>
          }
        </div>
        <!-- Days grid -->
        <div class="grid grid-cols-7 gap-px bg-slate-200">
          @for (cell of calendarCells(); track cell.key) {
            <div class="min-h-[84px] bg-white p-1" [class.bg-slate-50]="!cell.isCurrentMonth" [class.ring-1]="cell.isToday" [class.ring-slate-900]="cell.isToday">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium" [class.text-slate-400]="!cell.isCurrentMonth" [class.text-slate-900]="cell.isCurrentMonth">{{cell.day}}</span>
                @if (cell.events.length > 0) {
                  <span class="rounded-full bg-slate-900 px-1 text-[10px] leading-4 text-white">{{cell.events.length}}</span>
                }
              </div>
              <div class="mt-1 flex flex-col gap-0.5">
                @for (ev of cell.events.slice(0,2); track ev.id) {
                  <div class="truncate rounded px-1 py-0.5 text-[10px] leading-tight" [class]="eventBadge(ev).cls" [title]="ev.title + ' — ' + ev.assetName">
                    {{ ev.title }}
                  </div>
                }
                @if (cell.events.length > 2) {
                  <span class="text-[10px] text-slate-500">+{{cell.events.length - 2}} ακόμη</span>
                }
              </div>
            </div>
          }
        </div>
        <!-- Mini SVG timeline alternative (hand-rolled) -->
        <div class="border-t border-slate-200 p-3">
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Γραμμή χρόνου μηνός</h3>
          <svg viewBox="0 0 700 36" class="h-9 w-full">
            <line x1="10" y1="18" x2="690" y2="18" stroke="#e2e8f0" stroke-width="2" />
            @for (ev of cal.events; track ev.id) {
              <!-- position based on day of month (approx) -->
              <g>
                <circle [attr.cx]="10 + (dayOfMonth(ev.dueAt) / daysInMonth() * 680)" cy="18" r="5"
                  [attr.fill]="ev.status === 'overdue' ? '#ef4444' : ev.status === 'urgent' ? '#f59e0b' : '#10b981'"
                  [attr.stroke]="'white'" stroke-width="1.5" />
                <text [attr.x]="10 + (dayOfMonth(ev.dueAt) / daysInMonth() * 680)" y="10" text-anchor="middle" font-size="7" fill="#334155">{{ev.title.slice(0,12)}}</text>
              </g>
            }
          </svg>
        </div>
        <!-- Event list fallback -->
        <div class="border-t border-slate-200 px-4 py-3">
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Λίστα γεγονότων ({{cal.events.length}})</h3>
          @for (ev of cal.events; track ev.id) {
            <div class="flex items-center gap-2 py-1 text-sm">
              <span class="h-2 w-2 shrink-0 rounded-full" [class.bg-red-500]="ev.status==='overdue'" [class.bg-amber-500]="ev.status==='urgent'" [class.bg-emerald-500]="ev.status==='upcoming'"></span>
              <span class="font-medium">{{formatDate(ev.dueAt)}} — {{ev.title}}</span>
              <span class="text-xs text-slate-500">({{ev.assetName || '—'}} · {{ev.category || '—'}} · {{ev.daysLeft}} ημέρες)</span>
              <span class="badge !px-1.5 !py-0 text-[10px]" [class]="statusChip(ev).badgeClass">{{statusChip(ev).label}}</span>
            </div>
          } @empty {
            <p class="text-sm text-slate-500">Καμία συντήρηση στον επιλεγμένο μήνα.</p>
          }
        </div>
      } @else {
        <p class="p-6 text-center text-sm text-slate-500">Φόρτωση ημερολογίου...</p>
      }
    </div>

    <!-- Asset Modal -->
    @if (showAssetModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" (click)="closeAssetModal()">
        <div class="card w-full max-w-lg" (click)="$event.stopPropagation()">
          <h2 class="card-title">{{ editingAssetId() ? 'Επεξεργασία παγίου' : 'Νέο πάγιο' }}</h2>
          <form [formGroup]="assetForm" (ngSubmit)="saveAsset()" class="flex flex-col gap-4">
            <div>
              <label class="label" for="assetName">Όνομα *</label>
              <input id="assetName" type="text" class="input" formControlName="name" placeholder="π.χ. Ανελκυστήρας κεντρικός" />
              @if (assetSubmitted() && assetForm.controls.name.invalid) { <p class="field-error">Απαιτούνται τουλάχιστον 2 χαρακτήρες.</p> }
            </div>
            <div>
              <label class="label" for="assetCategory">Κατηγορία *</label>
              <select id="assetCategory" class="input" formControlName="category">
                @for (c of assetCategories; track c.value) { <option [value]="c.value">{{c.label}}</option> }
              </select>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label" for="assetLocation">Τοποθεσία</label>
                <input id="assetLocation" type="text" class="input" formControlName="location" placeholder="π.χ. Ταράτσα" />
              </div>
              <div>
                <label class="label" for="assetInstalledAt">Ημ/νία εγκατάστασης</label>
                <input id="assetInstalledAt" type="date" class="input" formControlName="installedAt" />
              </div>
            </div>
            <div>
              <label class="label" for="assetNotes">Σημειώσεις</label>
              <textarea id="assetNotes" rows="2" class="input" formControlName="notes"></textarea>
            </div>
            <div class="flex items-center gap-2">
              <button type="submit" class="btn btn-primary" [disabled]="savingAsset()"> {{ savingAsset() ? 'Αποθήκευση...' : (editingAssetId() ? 'Αποθήκευση' : 'Δημιουργία') }} </button>
              <button type="button" class="btn btn-secondary" (click)="closeAssetModal()">Άκυρο</button>
            </div>
          </form>
        </div>
      </div>
    }

    <!-- Schedule Modal -->
    @if (showScheduleModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" (click)="closeScheduleModal()">
        <div class="card w-full max-w-lg" (click)="$event.stopPropagation()">
          <h2 class="card-title">{{ editingScheduleId() ? 'Επεξεργασία συντήρησης' : 'Νέα προγραμματισμένη συντήρηση' }}</h2>
          <form [formGroup]="scheduleForm" (ngSubmit)="saveSchedule()" class="flex flex-col gap-4">
            <div>
              <label class="label" for="schedAsset">Πάγιο *</label>
              <select id="schedAsset" class="input" formControlName="assetId">
                <option value="">— Επιλέξτε πάγιο —</option>
                @for (a of assets(); track a.id) { <option [value]="a.id">{{a.name}} ({{categoryBadge(a.category).label}})</option> }
              </select>
              @if (scheduleSubmitted() && scheduleForm.controls.assetId.invalid) { <p class="field-error">Επιλογή παγίου υποχρεωτική.</p> }
            </div>
            <div>
              <label class="label" for="schedTitle">Τίτλος *</label>
              <input id="schedTitle" type="text" class="input" formControlName="title" placeholder="π.χ. Συντήρηση ανελκυστήρα 6μηνη" />
              @if (scheduleSubmitted() && scheduleForm.controls.title.invalid) { <p class="field-error">Τουλάχιστον 2 χαρακτήρες.</p> }
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label" for="schedInterval">Επανάληψη (μήνες) *</label>
                <input id="schedInterval" type="number" min="1" class="input" formControlName="intervalMonths" />
                @if (scheduleSubmitted() && scheduleForm.controls.intervalMonths.invalid) { <p class="field-error">≥ 1 μήνας.</p> }
              </div>
              <div>
                <label class="label" for="schedLastDone">Τελευταία εκτέλεση</label>
                <input id="schedLastDone" type="date" class="input" formControlName="lastDoneAt" />
              </div>
            </div>
            <div class="flex items-center gap-2">
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" formControlName="autoCreateJob" /> Αυτόματη δημιουργία εργασίας
              </label>
            </div>
            <div>
              <label class="label" for="schedCategory">Κατηγορία δαπάνης (προαιρετικό)</label>
              <select id="schedCategory" class="input" formControlName="expenseCategoryId">
                <option value="">— Χωρίς κατηγορία —</option>
                @for (cat of expenseCategories(); track cat.id) { <option [value]="cat.id">{{cat.name}}</option> }
              </select>
            </div>
            <p class="text-xs text-slate-500">Η επόμενη λήξη υπολογίζεται αυτόματα: τελευταία εκτέλεση + διάστημα, ή σήμερα + διάστημα.</p>
            <div class="flex items-center gap-2">
              <button type="submit" class="btn btn-primary" [disabled]="savingSchedule()"> {{ savingSchedule() ? 'Αποθήκευση...' : (editingScheduleId() ? 'Αποθήκευση' : 'Δημιουργία') }} </button>
              <button type="button" class="btn btn-secondary" (click)="closeScheduleModal()">Άκυρο</button>
            </div>
          </form>
        </div>
      </div>
    }
  `,
})
export class AdminMaintenancePage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly maintenanceApi = inject(MaintenanceApiService);
  private readonly categoriesApi = inject(CategoriesApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly assets = signal<BuildingAssetDto[]>([]);
  protected readonly schedules = signal<MaintenanceScheduleDto[]>([]);
  protected readonly calendar = signal<CalendarResponseDto | null>(null);
  protected readonly expenseCategories = signal<{ id: string; name: string }[]>([]);

  protected readonly loadErrorAssets = signal(false);
  protected readonly loadErrorSchedules = signal(false);
  protected readonly generating = signal(false);
  protected readonly generateResult = signal<GenerateJobsResultDto | null>(null);

  protected readonly showAssetModal = signal(false);
  protected readonly showScheduleModal = signal(false);
  protected readonly editingAssetId = signal<string | null>(null);
  protected readonly editingScheduleId = signal<string | null>(null);
  protected readonly assetSubmitted = signal(false);
  protected readonly scheduleSubmitted = signal(false);
  protected readonly savingAsset = signal(false);
  protected readonly savingSchedule = signal(false);

  protected readonly assetCategoryFilter = this.fb.nonNullable.control('');
  protected readonly scheduleCategoryFilter = this.fb.nonNullable.control('');
  protected readonly upcomingDaysCtrl = this.fb.nonNullable.control('30');

  protected readonly assetCategories = (Object.keys(CATEGORY_META) as AssetCategory[]).map((v) => ({
    value: v,
    label: CATEGORY_META[v].label,
  }));

  protected readonly weekdays = ['Δευ', 'Τρι', 'Τετ', 'Πεμ', 'Παρ', 'Σαβ', 'Κυρ'];

  // Calendar navigation state
  private calendarOffset = 0; // months from today
  protected readonly calendarTitle = computed(() => {
    const base = new Date();
    base.setUTCMonth(base.getUTCMonth() + this.calendarOffset);
    return base.toLocaleDateString('el-GR', { month: 'long', year: 'numeric' });
  });

  protected readonly calendarCells = computed(() => {
    const cal = this.calendar();
    if (!cal) return [];
    const from = new Date(cal.from);
    // Use first of month view: we need Monday-start grid
    const year = from.getUTCFullYear();
    const month = from.getUTCMonth();
    const firstOfMonth = new Date(Date.UTC(year, month, 1));
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const startWeekDay = (firstOfMonth.getUTCDay() + 6) % 7; // Monday 0
    const totalCells = 42; // 6 weeks
    const todayKey = new Date().toISOString().slice(0, 10);
    const eventsByDay = new Map<string, CalendarEventDto[]>();
    for (const ev of cal.events) {
      const key = ev.dueAt.slice(0, 10);
      const arr = eventsByDay.get(key) ?? [];
      arr.push(ev);
      eventsByDay.set(key, arr);
    }
    const cells: { key: string; day: number; isCurrentMonth: boolean; isToday: boolean; events: CalendarEventDto[] }[] = [];
    for (let i = 0; i < totalCells; i++) {
      const dayOffset = i - startWeekDay;
      const date = new Date(Date.UTC(year, month, 1 + dayOffset));
      const key = date.toISOString().slice(0, 10);
      const isCurrentMonth = date.getUTCMonth() === month;
      const isToday = key === todayKey;
      cells.push({
        key: `${key}-${i}`,
        day: date.getUTCDate(),
        isCurrentMonth,
        isToday,
        events: eventsByDay.get(key) ?? [],
      });
    }
    return cells;
  });

  protected readonly assetForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    category: this.fb.nonNullable.control<AssetCategory>('ELEVATOR', Validators.required),
    location: [''],
    installedAt: [''],
    notes: [''],
  });

  protected readonly scheduleForm = this.fb.nonNullable.group({
    assetId: ['', Validators.required],
    title: ['', [Validators.required, Validators.minLength(2)]],
    intervalMonths: this.fb.nonNullable.control<number | null>(6, [Validators.required, Validators.min(1)]),
    lastDoneAt: [''],
    autoCreateJob: this.fb.nonNullable.control(true),
    expenseCategoryId: [''],
  });

  private buildingId: string | null = null;

  // Helpers exposed to template
  protected readonly statusChip = statusChip;
  protected categoryBadge(cat: AssetCategory | string | null | undefined) {
    const key = cat as AssetCategory;
    return (
      CATEGORY_META[key] ?? { label: cat ?? '—', badgeClass: 'bg-slate-100 text-slate-700' }
    );
  }
  protected eventBadge(ev: CalendarEventDto) {
    if (ev.status === 'overdue') return { cls: 'bg-red-100 text-red-700' };
    if (ev.status === 'urgent') return { cls: 'bg-amber-100 text-amber-800' };
    return { cls: 'bg-emerald-100 text-emerald-700' };
  }
  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('el-GR');
  }
  protected dayOfMonth(iso: string): number {
    return new Date(iso).getUTCDate();
  }
  protected daysInMonth(): number {
    const base = new Date();
    base.setUTCMonth(base.getUTCMonth() + this.calendarOffset);
    return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  }

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(catchError(() => EMPTY))
      .subscribe((building) => {
        this.buildingId = building.id;
        this.categoriesApi
          .list(building.id)
          .pipe(catchError(() => EMPTY))
          .subscribe((cats) => this.expenseCategories.set(cats as any));
        this.reloadAll();
      });
  }

  // ── Loads
  protected reloadAssets(): void {
    if (!this.buildingId) return;
    this.loadErrorAssets.set(false);
    const category = this.assetCategoryFilter.value || undefined;
    this.maintenanceApi
      .listAssets(this.buildingId, category)
      .pipe(catchError(() => { this.loadErrorAssets.set(true); return EMPTY; }))
      .subscribe((assets) => this.assets.set(assets));
  }

  protected reloadSchedules(): void {
    if (!this.buildingId) return;
    this.loadErrorSchedules.set(false);
    const upcomingDays = Number(this.upcomingDaysCtrl.value) || 30;
    const category = this.scheduleCategoryFilter.value || undefined;
    this.maintenanceApi
      .listSchedules(this.buildingId, { upcomingDays, category })
      .pipe(catchError(() => { this.loadErrorSchedules.set(true); return EMPTY; }))
      .subscribe((schedules) => this.schedules.set(schedules));
  }

  protected reloadCalendar(): void {
    if (!this.buildingId) return;
    const base = new Date();
    base.setUTCMonth(base.getUTCMonth() + this.calendarOffset);
    const from = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1)).toISOString();
    const to = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0, 23, 59, 59, 999)).toISOString();
    this.maintenanceApi
      .getCalendar(this.buildingId, from, to)
      .pipe(catchError(() => EMPTY))
      .subscribe((cal) => this.calendar.set(cal));
  }

  private reloadAll(): void {
    this.reloadAssets();
    this.reloadSchedules();
    this.reloadCalendar();
  }

  protected shiftCalendar(delta: number): void {
    if (delta === 0) this.calendarOffset = 0;
    else this.calendarOffset += delta;
    this.reloadCalendar();
  }

  // ── Asset modal
  protected openAssetModal(): void {
    this.editingAssetId.set(null);
    this.assetSubmitted.set(false);
    this.assetForm.reset({ name: '', category: 'ELEVATOR', location: '', installedAt: '', notes: '' });
    this.showAssetModal.set(true);
  }

  protected closeAssetModal(): void {
    this.showAssetModal.set(false);
    this.editingAssetId.set(null);
  }

  protected editAsset(asset: BuildingAssetDto): void {
    this.editingAssetId.set(asset.id);
    this.assetSubmitted.set(false);
    this.assetForm.patchValue({
      name: asset.name,
      category: asset.category,
      location: asset.location ?? '',
      installedAt: asset.installedAt ? asset.installedAt.slice(0,10) : '',
      notes: asset.notes ?? '',
    });
    this.showAssetModal.set(true);
  }

  protected saveAsset(): void {
    this.assetSubmitted.set(true);
    if (!this.buildingId || this.assetForm.invalid || this.savingAsset()) return;
    const raw = this.assetForm.getRawValue();
    const payload: any = {
      name: raw.name.trim(),
      category: raw.category,
      ...(raw.location.trim() ? { location: raw.location.trim() } : {}),
      ...(raw.installedAt ? { installedAt: raw.installedAt } : {}),
      ...(raw.notes.trim() ? { notes: raw.notes.trim() } : {}),
    };
    this.savingAsset.set(true);
    const editing = this.editingAssetId();
    const req$ = editing
      ? this.maintenanceApi.updateAsset(this.buildingId, editing, payload)
      : this.maintenanceApi.createAsset(this.buildingId, payload);
    req$.subscribe({
      next: () => {
        this.toast.success(editing ? 'Το πάγιο ενημερώθηκε.' : 'Το πάγιο δημιουργήθηκε.');
        this.savingAsset.set(false);
        this.closeAssetModal();
        this.reloadAssets();
      },
      error: () => {
        this.toast.error('Η αποθήκευση παγίου απέτυχε.');
        this.savingAsset.set(false);
      },
    });
  }

  protected removeAsset(asset: BuildingAssetDto): void {
    if (!this.buildingId) return;
    if (!confirm(`Διαγραφή παγίου "${asset.name}";`)) return;
    this.maintenanceApi.deleteAsset(this.buildingId, asset.id).pipe(catchError(() => EMPTY)).subscribe(() => {
      this.toast.info(`Διαγράφηκε: ${asset.name}`);
      this.reloadAssets();
      this.reloadSchedules(); // schedules may be cascaded
      this.reloadCalendar();
    });
  }

  // ── Schedule modal
  protected openScheduleModal(): void {
    this.editingScheduleId.set(null);
    this.scheduleSubmitted.set(false);
    this.scheduleForm.reset({ assetId: '', title: '', intervalMonths: 6, lastDoneAt: '', autoCreateJob: true, expenseCategoryId: '' });
    this.showScheduleModal.set(true);
  }

  protected closeScheduleModal(): void {
    this.showScheduleModal.set(false);
    this.editingScheduleId.set(null);
  }

  protected editSchedule(sch: MaintenanceScheduleDto): void {
    this.editingScheduleId.set(sch.id);
    this.scheduleSubmitted.set(false);
    this.scheduleForm.patchValue({
      assetId: sch.assetId,
      title: sch.title,
      intervalMonths: sch.intervalMonths,
      lastDoneAt: sch.lastDoneAt ? sch.lastDoneAt.slice(0,10) : '',
      autoCreateJob: sch.autoCreateJob,
      expenseCategoryId: sch.expenseCategoryId ?? '',
    });
    this.showScheduleModal.set(true);
  }

  protected saveSchedule(): void {
    this.scheduleSubmitted.set(true);
    if (!this.buildingId || this.scheduleForm.invalid || this.savingSchedule()) return;
    const raw = this.scheduleForm.getRawValue();
    const payload: any = {
      assetId: raw.assetId,
      title: raw.title.trim(),
      intervalMonths: Number(raw.intervalMonths),
      ...(raw.lastDoneAt ? { lastDoneAt: raw.lastDoneAt } : {}),
      autoCreateJob: !!raw.autoCreateJob,
      ...(raw.expenseCategoryId ? { expenseCategoryId: raw.expenseCategoryId } : {}),
    };
    this.savingSchedule.set(true);
    const editing = this.editingScheduleId();
    const req$ = editing
      ? this.maintenanceApi.updateSchedule(this.buildingId, editing, payload)
      : this.maintenanceApi.createSchedule(this.buildingId, payload);
    req$.subscribe({
      next: () => {
        this.toast.success(editing ? 'Η συντήρηση ενημερώθηκε.' : 'Η συντήρηση προγραμματίστηκε.');
        this.savingSchedule.set(false);
        this.closeScheduleModal();
        this.reloadSchedules();
        this.reloadCalendar();
      },
      error: () => {
        this.toast.error('Η αποθήκευση συντήρησης απέτυχε.');
        this.savingSchedule.set(false);
      },
    });
  }

  protected removeSchedule(sch: MaintenanceScheduleDto): void {
    if (!this.buildingId) return;
    if (!confirm(`Διαγραφή "${sch.title}";`)) return;
    this.maintenanceApi.deleteSchedule(this.buildingId, sch.id).pipe(catchError(() => EMPTY)).subscribe(() => {
      this.toast.info(`Διαγράφηκε: ${sch.title}`);
      this.reloadSchedules();
      this.reloadCalendar();
    });
  }

  protected markDone(sch: MaintenanceScheduleDto): void {
    if (!this.buildingId) return;
    this.maintenanceApi.markDone(this.buildingId, sch.id).subscribe({
      next: () => {
        this.toast.success(`Ολοκληρώθηκε: ${sch.title} — επόμενη λήξη μεταφέρθηκε.`);
        this.reloadSchedules();
        this.reloadCalendar();
      },
      error: () => this.toast.error('Η ενημέρωση απέτυχε.'),
    });
  }

  protected generateJobs(): void {
    if (!this.buildingId || this.generating()) return;
    this.generating.set(true);
    this.maintenanceApi.generateJobs(this.buildingId).subscribe({
      next: (res) => {
        this.generating.set(false);
        this.generateResult.set(res);
        if (res.created > 0) this.toast.success(`Δημιουργήθηκαν ${res.created} εργασίες συντήρησης.`);
        else this.toast.info(res.skipped > 0 ? `Καμία νέα εργασία — ${res.skipped} ήδη υπάρχουν.` : 'Καμία οφειλόμενη συντήρηση.');
        this.reloadSchedules();
      },
      error: () => {
        this.generating.set(false);
        this.toast.error('Η δημιουργία εργασιών απέτυχε.');
      },
    });
  }
}
