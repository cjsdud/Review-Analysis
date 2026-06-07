// 사용자 데이터 삭제 / 분석 삭제 — 본인 데이터 삭제와 계정 탈퇴 흐름에서 사용.
//
// SQLite 기준 — schema.sql 에 ON DELETE CASCADE 가 정의된 외래키가 일관되게 없으므로
// 자식 테이블부터 명시적으로 삭제한 뒤 부모 테이블을 지운다. 모든 변경은 단일 트랜잭션
// 안에서 수행해 중간 실패 시 부분 삭제를 방지한다.
//
// 보존 정책:
//   - llm_usage_logs: user_id / analysis_id 는 NULL 허용 — 익명화 후 row 자체는 유지
//     (모델별 토큰 비용 집계가 깨지지 않도록).
//   - usage_events: user_id 가 NOT NULL 이라 NULL 익명화 불가 → 사용자 요청 삭제 시 hard delete.
//     (월 사용량 누적은 익명 통계로 복구할 수 없으므로 별도 운영 집계 테이블이 필요할 경우 향후 분리.)
//   - admin_action_logs: 감사 로그. 일반 사용자 탈퇴와 무관 — admin_user_id 는 행위 admin 식별자라
//     일반 user 탈퇴 시 영향 없음. 탈퇴 사용자가 admin 이면 last-admin 보호 후 진행, 로그는 그대로 둠.
//   - analytics_events: 익명 통계라 무관.
//   - 그 외 user_id / analysis_id 연결 row 는 hard delete.
//
// 호출처:
//   - DELETE /api/analysis/:id           → deleteAnalysisCascade(analysisId, expectedUserId)
//   - DELETE /api/me/account             → deleteUserAccountCascade(userId)

import db from '../db/database.js';

function exec(sql, params = []) {
  return db.prepare(sql).run(...params);
}
function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}
function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

// 한 분석(analysisId) 의 모든 종속 데이터를 cascade 삭제. expectedUserId 가 주어지면
// row 의 user_id 와 일치해야 동작 — 라우트 단의 ownership 체크와 이중 가드.
// 반환: { ok, jobDeleted, productAnalysesDeleted, classificationsDeleted, ... }
export function deleteAnalysisCascade(analysisId, expectedUserId = undefined) {
  if (!analysisId) return { ok: false, error: 'NO_ID' };
  const job = get('SELECT id, upload_id, user_id, status FROM analysis_jobs WHERE id = ?', [analysisId]);
  if (!job) return { ok: false, error: 'NOT_FOUND' };
  if (expectedUserId !== undefined && (job.user_id || null) !== (expectedUserId || null)) {
    return { ok: false, error: 'FORBIDDEN' };
  }
  // 진행 중 분석은 삭제 차단 — background job 이 row 를 다시 쓸 가능성.
  if (job.status === 'processing' || job.status === 'pending') {
    return { ok: false, error: 'IN_PROGRESS' };
  }

  const tx = db.transaction(() => {
    const counts = {};
    // 자식 → 부모 순으로 정리.
    counts.product_analyses     = exec('DELETE FROM product_analyses     WHERE analysis_id = ?', [analysisId]).changes || 0;
    counts.review_classifications = exec('DELETE FROM review_classifications WHERE analysis_id = ?', [analysisId]).changes || 0;
    counts.user_corrections     = exec('DELETE FROM user_corrections     WHERE analysis_id = ?', [analysisId]).changes || 0;
    // 분석에 연결된 LLM 사용 로그 — user_id 도 NULL 로 익명화한 뒤 analysis_id 끊기.
    counts.llm_usage_logs_anonymized = exec(
      'UPDATE llm_usage_logs SET user_id = NULL, analysis_id = NULL WHERE analysis_id = ?',
      [analysisId],
    ).changes || 0;
    // usage_events: 이 분석으로 인한 행은 analysis_id 만 NULL 로 끊고 row 는 유지 (월 사용량 누적).
    counts.usage_events_unlinked = exec(
      'UPDATE usage_events SET analysis_id = NULL WHERE analysis_id = ?',
      [analysisId],
    ).changes || 0;

    // 업로드 파일 — 동일 upload_id 에 연결된 reviews / column_mappings / upload_files 정리.
    // 단, 같은 업로드 파일이 다른 analysis 의 원본이 아니어야 한다 (재실행 케이스).
    const uploadStillLinked = job.upload_id
      ? get('SELECT id FROM analysis_jobs WHERE upload_id = ? AND id != ? LIMIT 1', [job.upload_id, analysisId])
      : null;
    if (job.upload_id && !uploadStillLinked) {
      counts.reviews          = exec('DELETE FROM reviews          WHERE upload_id = ?', [job.upload_id]).changes || 0;
      counts.column_mappings  = exec('DELETE FROM column_mappings  WHERE upload_id = ?', [job.upload_id]).changes || 0;
      counts.upload_files     = exec('DELETE FROM upload_files     WHERE id = ?',       [job.upload_id]).changes || 0;
    } else {
      counts.reviews = counts.column_mappings = counts.upload_files = 0;
    }

    counts.analysis_jobs = exec('DELETE FROM analysis_jobs WHERE id = ?', [analysisId]).changes || 0;
    return counts;
  });

  try {
    const counts = tx();
    return { ok: true, counts };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 계정 탈퇴 — 사용자의 모든 데이터를 일괄 삭제 (자식 → 부모 순).
// 진행 중 분석이 있어도 강제 삭제 — 사용자가 명시적으로 탈퇴를 선택했으므로
// in-progress job 은 다음 markCompleted 시점에 DB 에 row 가 없어 자연 실패한다.
export function deleteUserAccountCascade(userId) {
  if (!userId) return { ok: false, error: 'NO_USER' };
  const user = get('SELECT id, role FROM users WHERE id = ?', [userId]);
  if (!user) return { ok: false, error: 'NOT_FOUND' };

  // 사용자의 모든 analysis 를 먼저 찾아 각각의 cascade 를 적용한 뒤, 마지막에 user 자체를 삭제.
  const analyses = all('SELECT id FROM analysis_jobs WHERE user_id = ?', [userId]);
  const tx = db.transaction(() => {
    const counts = {
      analyses: 0,
      product_analyses: 0,
      review_classifications: 0,
      user_corrections: 0,
      llm_usage_logs_anonymized: 0,
      usage_events: 0,
      column_mappings: 0,
      reviews: 0,
      upload_files: 0,
      subscriptions: 0,
      payments: 0,
      user_discounts: 0,
      announcements_acks: 0,
      admin_action_logs_anonymized: 0,
      users: 0,
    };

    // 사용자의 모든 analysis 종속 row 정리.
    for (const a of analyses) {
      counts.product_analyses        += exec('DELETE FROM product_analyses        WHERE analysis_id = ?', [a.id]).changes || 0;
      counts.review_classifications  += exec('DELETE FROM review_classifications  WHERE analysis_id = ?', [a.id]).changes || 0;
      counts.user_corrections        += exec('DELETE FROM user_corrections        WHERE analysis_id = ?', [a.id]).changes || 0;
      counts.llm_usage_logs_anonymized += exec(
        'UPDATE llm_usage_logs SET user_id = NULL, analysis_id = NULL WHERE analysis_id = ?',
        [a.id],
      ).changes || 0;
    }
    counts.analyses = exec('DELETE FROM analysis_jobs WHERE user_id = ?', [userId]).changes || 0;

    // user_id 가 박힌 나머지 테이블 — uploads / reviews / mappings 도 정리.
    // (분석이 없는 단순 업로드만 있는 경우도 포함)
    const userUploads = all('SELECT id FROM upload_files WHERE user_id = ?', [userId]);
    for (const u of userUploads) {
      counts.reviews         += exec('DELETE FROM reviews         WHERE upload_id = ?', [u.id]).changes || 0;
      counts.column_mappings += exec('DELETE FROM column_mappings WHERE upload_id = ?', [u.id]).changes || 0;
    }
    counts.upload_files += exec('DELETE FROM upload_files WHERE user_id = ?', [userId]).changes || 0;

    // user_id 직접 hard delete.
    counts.subscriptions    = exec('DELETE FROM subscriptions   WHERE user_id = ?', [userId]).changes || 0;
    counts.payments         = exec('DELETE FROM payments        WHERE user_id = ?', [userId]).changes || 0;
    counts.user_discounts   = exec('DELETE FROM user_discounts  WHERE user_id = ?', [userId]).changes || 0;
    // usage_events: NOT NULL 제약으로 익명화 불가 → 본인 요청 삭제 시 hard delete (운영 통계는 별도 집계 테이블 분리 권장).
    counts.usage_events     = exec('DELETE FROM usage_events WHERE user_id = ?', [userId]).changes || 0;

    // 마지막 admin 보호 — 마지막 admin 의 탈퇴는 차단해서 콘솔 잠금 방지.
    if (user.role === 'admin') {
      const otherAdmin = get("SELECT id FROM users WHERE role = 'admin' AND id != ? LIMIT 1", [userId]);
      if (!otherAdmin) throw new Error('LAST_ADMIN_PROTECTED');
    }

    counts.users = exec('DELETE FROM users WHERE id = ?', [userId]).changes || 0;
    delete counts.announcements_acks; // 사용하지 않는 키 정리
    delete counts.admin_action_logs_anonymized;
    return counts;
  });

  try {
    const counts = tx();
    return { ok: true, counts };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
