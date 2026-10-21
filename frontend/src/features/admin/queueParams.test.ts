import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminApi } from '@/api/endpoints';
import { formatTicketNumber } from '@/lib/format';
import { needsManualTriage } from '@/lib/aiState';
import { parseFilters, serializeFilters, toApiQuery } from './queueParams';

describe('queue filters', () => {
  it('parses comma-separated multi-value params, dropping unknown values', () => {
    const f = parseFilters(new URLSearchParams('status=OPEN,IN_PROGRESS,BOGUS&priority=CRITICAL&assignee=unassigned&to=2026-10-21'));
    expect(f.status).toEqual(['OPEN', 'IN_PROGRESS']);
    expect(f.priority).toEqual(['CRITICAL']);
    expect(f.assignee).toBe('unassigned');
    expect(f.to).toBe('2026-10-21');
  });

  it('round-trips through the URL', () => {
    const f = parseFilters(new URLSearchParams('category=ISBN_METADATA,PRINTING_QUALITY&assignee=me&q=%2342&page=2'));
    expect(parseFilters(serializeFilters(f))).toEqual(f);
  });

  it('builds the API query: assigneeId me/unassigned and bare dates', () => {
    const q = toApiQuery(parseFilters(new URLSearchParams('assignee=me&from=2026-10-01&to=2026-10-21')));
    expect(q).toMatchObject({ assigneeId: 'me', from: '2026-10-01', to: '2026-10-21', sort: 'urgency', page: 1 });
    expect(q.status).toBeUndefined();
  });
});

describe('adminApi.tickets', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends multi-value filters comma-separated', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 20 }), { status: 200 }));
    await adminApi.tickets({ status: ['OPEN', 'IN_PROGRESS'], priority: ['CRITICAL', 'HIGH'], assigneeId: 'unassigned', q: '#42', to: '2026-10-21' });
    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.searchParams.get('status')).toBe('OPEN,IN_PROGRESS');
    expect(url.searchParams.get('priority')).toBe('CRITICAL,HIGH');
    expect(url.searchParams.get('assigneeId')).toBe('unassigned');
    expect(url.searchParams.get('q')).toBe('#42');
    expect(url.searchParams.get('to')).toBe('2026-10-21');
    expect(url.searchParams.has('category')).toBe(false);
  });
});

describe('derived client rules', () => {
  it('formats ticket numbers as #n', () => {
    expect(formatTicketNumber(42)).toBe('#42');
  });

  it.each([
    ['FAILED', false, false, true],
    ['FAILED', true, false, true],
    ['FAILED', true, true, false],
    ['DONE', false, false, false],
    ['PENDING', false, false, false],
  ] as const)('needsManualTriage(%s, cat=%s, pri=%s) = %s', (aiStatus, categoryOverridden, priorityOverridden, expected) => {
    expect(needsManualTriage({ aiStatus, categoryOverridden, priorityOverridden })).toBe(expected);
  });
});
