import { describe, it, expect, vi, beforeEach } from 'vitest';

// axios client 를 목으로 대체 — 실제 네트워크 없이 호출된 경로만 검증.
vi.mock('./client.js', () => ({
  default: { get: vi.fn(() => Promise.resolve({ data: {} })) },
}));

import client from './client.js';
import { getProductDetail } from './analysisApi.js';

describe('getProductDetail — 상품명 경로 인코딩', () => {
  beforeEach(() => {
    client.get.mockClear();
  });

  it('일반 상품명(한글+공백)을 인코딩해 요청한다', async () => {
    await getProductDetail('an1', '하이웨스트 데님 팬츠');
    const url = client.get.mock.calls[0][0];
    expect(url).toBe('/analysis/an1/products/' + encodeURIComponent('하이웨스트 데님 팬츠'));
  });

  // 회귀 방지: '#', '/', '%' 가 포함된 상품명이 경로를 깨뜨리지 않아야 한다.
  // (인코딩 안 하면 '#' 뒤가 프래그먼트로 잘리고, '/' 가 경로 구분자로 오인되어 404)
  it.each([
    ['셔츠#1'],
    ['원피스/블랙'],
    ['니트 50%'],
    ['컬러: 블루 & 그레이'],
  ])('특수문자 상품명 %s 도 한 세그먼트로 인코딩한다', async (name) => {
    await getProductDetail('an1', name);
    const url = client.get.mock.calls[0][0];
    expect(url).toBe(`/analysis/an1/products/${encodeURIComponent(name)}`);
    // 인코딩된 경로에는 원본 특수문자가 경로 구분/프래그먼트로 남아 있으면 안 된다.
    const segment = url.split('/products/')[1];
    expect(segment).not.toContain('#');
    expect(segment).not.toContain(' ');
    // '/' 는 %2F 로 인코딩되어 추가 세그먼트를 만들지 않아야 한다.
    expect(segment.split('/').length).toBe(1);
  });
});
