# LLM 비용 / 지연 최적화 계획 (설계만, 구현 보류)

이 문서는 **실제 OpenAI/Gemini/Claude API 를 본격 사용할 때 비용·지연을 줄이기 위한 설계 노트**입니다. MVP 단계에서는 구현하지 않고 구조만 마련합니다.

---

## 1. 현재 LLM 호출 지점

`backend/src/services/aiClient.service.js`

| 함수 | 호출 빈도 | 입력 크기 |
|---|---|---|
| `classifyAmbiguousReviews(reviews, categories)` | 분석당 1회 (애매한 리뷰 ≥1건일 때) | 작음 ~ 중간 |
| `generateIssueLabel(category, reviews)` | 라벨 없는 cluster 마다 1회 | 작음 |
| `generateProductImprovementReport(productSummary)` | **상품 수만큼** | 중간 |
| `generateReplyTemplates(issueSummary)` | **상품당 상위 3 이슈** = 상품 수 × 3 | 작음 |
| `generateMonthlyReport(overallSummary)` | 분석당 1회 | 작음 |

> 상품이 N개면 `report N회 + reply 3N회 + label k회`로 호출이 **선형 증가**합니다. 셀러당 20~50 상품 분석 시 호출이 100건 단위로 늘 수 있습니다.

## 2. mock fallback 구조 (재확인)

- `LLM_PROVIDER=mock` 또는 키 없음 → 처음부터 `aiMode='mock'`
- 호출/JSON 파싱/형식 검증 실패 → 함수별 mock 기본값
- 401/403 한 번이라도 발생 → `authDisabled=true` → 이후 호출 즉시 mock (회로차단)
- **따라서 어떤 최적화 도입도 mock fallback 동작을 깨면 안 됨**

## 3. 비용 증가 지점 (큰 순)

1. **`generateReplyTemplates`** — 상품×3 회. 답글 자체는 짧지만 호출 수가 큼.
2. **`generateProductImprovementReport`** — 상품 수만큼. 입력에 topIssues + recommendedAction 포함되어 상대적으로 큼.
3. **`generateIssueLabel`** — 클러스터 수만큼. 한 분석에서 수십 회 발생 가능.
4. `classifyAmbiguousReviews` — 분석당 1회지만 ambiguous 리뷰가 많으면 입력이 큼.
5. `generateMonthlyReport` — 분석당 1회. 영향 적음.

## 4. 캐싱 후보 (적용 시 가장 효과적)

### 4-1. `generateReplyTemplates`
- 키: `replyTemplates :: ${category} :: ${issueLabel}`
- 같은 (category, issueLabel) 조합이면 셀러/상품 무관하게 답글 톤이 거의 동일.
- 일회성 분석에서도 같은 분석 내 상품 간 중복 이슈가 많아 즉시 효과.

### 4-2. `generateIssueLabel`
- 키: `issueLabel :: ${category} :: hash(top3evidence)`
- 같은 카테고리·유사 evidence 묶음이면 같은 라벨 재사용.
- evidence 정렬 후 SHA-1 short hash 등으로 키 생성.

### 4-3. `generateProductImprovementReport`
- 키: `productReport :: ${productName} :: hash(topIssues.labels+ratios)`
- 같은 상품·같은 topIssues 조합이면 결과 동일.

### 4-4. `classifyAmbiguousReviews`
- 키: `classify :: hash(reviewText) + categories.length`
- 같은 리뷰 텍스트는 동일 분류. 분석 간에도 캐시 효과.

### 4-5. `generateMonthlyReport`
- 입력이 매번 달라 캐시 효과 적음. 도입 보류.

## 5. 캐시 키 예시

```
replyTemplates::사이즈::허리가 작게 나옴
issueLabel::소재/두께::a1b2c3
productReport::린넨 와이드 팬츠::d4e5f6
classify::g7h8i9::10
```

## 6. 배치 호출 후보

- **여러 issueLabel 답글을 한 번에 생성**: 한 상품의 topIssues 3개를 단일 요청으로 묶기 → 호출 1회로 3 이슈 응답.
- **상품별 topIssues 한 번에 개선안 생성**: 작은 입력이면 상품 5개 묶어서 한 번에 (provider rate limit 고려).
- 단점: 응답 JSON 형식이 복잡해져 파싱 실패 시 mock fallback 비용이 커짐 → **반드시 부분 성공/실패 분리**(이슈 1개 실패해도 나머지 2개는 유지) 가능한 형태로 설계.

## 7. 저장소 제안 (구현 시)

```sql
CREATE TABLE IF NOT EXISTS llm_cache (
  key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT,
  result TEXT NOT NULL,         -- JSON
  hit_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  last_hit_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_llm_cache_created ON llm_cache(created_at);
```

- `key` 는 함수명+의미식별자(상품/카테고리/라벨) 조합.
- TTL: 답글/리포트 30일, 분류 90일 정도가 안전(모델·정책 갱신 대비).
- 캐시는 *결과의 정확성* 보다 *일관성·비용 절감*이 목적. 셀러가 매번 다른 결과를 받지 않게 하는 부수효과도 있음.

## 8. 도입 순서 (권장)

1. 캐시 미들웨어를 `aiClient` 내부에 두고 함수별 키 생성기를 분리(코드 변경 최소).
2. `generateReplyTemplates` → `generateIssueLabel` → `generateProductImprovementReport` 순으로 캐시 적용.
3. 배치 호출은 캐시가 안정된 다음에 도입(파싱 위험·복잡도 ↑).
4. 캐시 히트율을 메트릭으로 노출(분석 결과 summary 에 `cacheHitRate` 추가 가능).

## 9. MVP 결정

- **이번 단계에서는 문서화만**. 코드 변경 없음.
- `aiClient` 함수 시그니처는 그대로 유지하여 향후 캐시 도입 시 호출부 변경이 없도록 한다.
- 캐시는 `llm_cache` 테이블 하나만 추가하면 적용 가능한 구조이며, schema 추가도 추후로 미룬다.
