// review_analysis_cache 헬퍼 — 같은 리뷰 + 같은 prompt/analysis/model 이면
// LLM 호출 없이 저장된 result_json 을 재사용한다.
//
// unique key: (reviewHash, promptVersion, analysisVersion, model)
//   - promptVersion 이 바뀌면 cache miss → 새 LLM 호출 발생
//   - model 까지 unique key 에 포함 — 모델 결과를 섞지 않는다
import db from '../../db/database.js';

export function getCachedReviewAnalysis({ reviewHash, promptVersion, analysisVersion, model }) {
  if (!reviewHash || !promptVersion || !analysisVersion || !model) return null;
  const row = db
    .prepare(
      `SELECT id, result_json, hit_count FROM review_analysis_cache
       WHERE review_hash = ? AND prompt_version = ? AND analysis_version = ? AND model = ?
       LIMIT 1`,
    )
    .get(reviewHash, promptVersion, analysisVersion, model);
  if (!row) return null;
  // hit_count 증가 (관측용). 실패해도 캐시 hit 자체는 반환.
  try {
    db.prepare(
      `UPDATE review_analysis_cache SET hit_count = hit_count + 1,
         updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(row.id);
  } catch { /* ignore */ }
  try {
    return JSON.parse(row.result_json);
  } catch {
    return null;
  }
}

export function saveReviewAnalysisCache(
  { reviewHash, promptVersion, analysisVersion, provider, model, result, userId, analysisId },
) {
  if (!reviewHash || !promptVersion || !analysisVersion || !provider || !model) return;
  const json = JSON.stringify(result ?? null);
  // INSERT or UPDATE — unique key 충돌 시 result_json/updated_at 갱신.
  db.prepare(
    `INSERT INTO review_analysis_cache (review_hash, prompt_version, analysis_version, provider, model, result_json, user_id, analysis_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(review_hash, prompt_version, analysis_version, model) DO UPDATE SET
       result_json = excluded.result_json,
       provider = excluded.provider,
       updated_at = CURRENT_TIMESTAMP`,
  ).run(reviewHash, promptVersion, analysisVersion, provider, model, json, userId || null, analysisId || null);
}

// 관측용 — 최근 N 일 캐시 hit / miss 통계 (관리자 콘솔/디버깅).
export function getCacheStats(days = 7) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(hit_count) AS hits FROM review_analysis_cache
       WHERE updated_at >= datetime('now', ?)`,
    )
    .get(`-${days} days`);
  return { entries: row?.total || 0, hits: row?.hits || 0 };
}
