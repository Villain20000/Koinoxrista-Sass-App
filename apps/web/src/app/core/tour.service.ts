import { Injectable } from '@angular/core';

const STORAGE_PREFIX = 'polykatoikia.tour.';
const DONE_FLAG = 'done';

/**
 * Gates one-shot spotlight help tours via localStorage. Storage failures
 * (private mode, quota) degrade to "tour available every visit".
 */
@Injectable({ providedIn: 'root' })
export class TourService {
  /** True when the tour has not been completed yet and may be launched. */
  launch(id: string): boolean {
    try {
      return localStorage.getItem(STORAGE_PREFIX + id) !== DONE_FLAG;
    } catch {
      return true;
    }
  }

  markDone(id: string): void {
    try {
      localStorage.setItem(STORAGE_PREFIX + id, DONE_FLAG);
    } catch {
      // Non-persistent storage: the tour simply replays next visit.
    }
  }
}
