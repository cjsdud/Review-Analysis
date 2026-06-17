import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./client.js', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: { summary: {}, products: [] } })),
    post: vi.fn(() => Promise.resolve({ data: { ok: true, code: 'RF-ABCD-1234' } })),
    patch: vi.fn(() => Promise.resolve({ data: { share: {} } })),
  },
}));

import client from './client.js';
import {
  getSharedReport,
  resolveSharedReportCode,
  sharedReportAdminApi,
} from './shareApi.js';

describe('shareApi — 외부 공유 결과 호출', () => {
  beforeEach(() => {
    client.get.mockClear();
    client.post.mockClear();
    client.patch.mockClear();
  });

  it('getSharedReport 는 코드를 encodeURIComponent 해서 경로에 넣는다', async () => {
    await getSharedReport('RF-ABCD-1234');
    expect(client.get.mock.calls[0][0]).toBe('/shared-reports/RF-ABCD-1234');
  });

  // 회귀 방지: 정상 코드는 한 세그먼트로 인코딩되어야 한다 (대문자/숫자/하이픈만 사용하므로
  // 인코딩 결과가 동일하지만, encodeURIComponent 누락 시 향후 alphabet 확장에서 깨질 수 있음).
  it('getSharedReport 가 잘못된 입력(슬래시)도 한 세그먼트로 안전하게 보낸다', async () => {
    await getSharedReport('RF/ABCD/1234');
    const url = client.get.mock.calls[0][0];
    expect(url).toBe('/shared-reports/' + encodeURIComponent('RF/ABCD/1234'));
    // 코드 세그먼트에는 raw '/' 가 남으면 안 된다 — %2F 로 인코딩되어야 한다.
    const segment = url.split('/shared-reports/')[1];
    expect(segment).not.toContain('/');
    expect(segment).toContain('%2F');
  });

  it('resolveSharedReportCode 는 POST 로 코드를 body 에 담아 보낸다', async () => {
    await resolveSharedReportCode('rf-abcd-1234');
    expect(client.post.mock.calls[0][0]).toBe('/shared-reports/resolve');
    expect(client.post.mock.calls[0][1]).toEqual({ code: 'rf-abcd-1234' });
  });

  it('admin API 가 올바른 경로를 호출한다', async () => {
    await sharedReportAdminApi.listAll();
    expect(client.get.mock.calls.at(-1)[0]).toBe('/admin/shared-reports');

    await sharedReportAdminApi.create('an1', { expiresInDays: 30 });
    expect(client.post.mock.calls.at(-1)[0]).toBe('/admin/analyses/an1/share');
    expect(client.post.mock.calls.at(-1)[1]).toEqual({ expiresInDays: 30 });

    await sharedReportAdminApi.patch('sh1', { expiresInDays: 7 });
    expect(client.patch.mock.calls.at(-1)[0]).toBe('/admin/shared-reports/sh1');

    await sharedReportAdminApi.revoke('sh1', { reason: 'x' });
    expect(client.post.mock.calls.at(-1)[0]).toBe('/admin/shared-reports/sh1/revoke');
  });
});
