import { describe, beforeEach, expect, it } from 'vitest';
import { TourService } from './tour.service';

describe('TourService', () => {
  let service: TourService;

  const key = (id: string) => `polykatoikia.tour.${id}`;

  beforeEach(() => {
    localStorage.clear();
    service = new TourService();
  });

  it('launches a tour that was never completed', () => {
    expect(service.launch('admin-overview')).toBe(true);
  });

  it('stops launching a tour after markDone', () => {
    service.markDone('balance-tour');
    expect(localStorage.getItem(key('balance-tour'))).toBe('done');
    expect(service.launch('balance-tour')).toBe(false);
  });

  it('keeps tours independent by id', () => {
    service.markDone('provider-portal');
    expect(service.launch('provider-portal')).toBe(false);
    expect(service.launch('admin-overview')).toBe(true);
  });

  it('treats corrupted storage as launchable', () => {
    localStorage.setItem(key('weird'), 'unexpected-value');
    expect(service.launch('weird')).toBe(true);
  });
});
