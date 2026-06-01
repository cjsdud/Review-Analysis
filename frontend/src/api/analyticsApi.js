import client from './client.js';

// 공개 샘플 리포트 페이지뷰 추적. 실패해도 사용자 경험에 영향 없도록 조용히 무시.
// 개인정보는 보내지 않는다 — path/referrer host 정도만.
export function trackDemoView() {
  try {
    client.post('/analytics/demo-view', {
      path: '/demo/sample-report',
      referrer: typeof document !== 'undefined' ? document.referrer || null : null,
    }).catch(() => {});
  } catch {
    /* noop */
  }
}
