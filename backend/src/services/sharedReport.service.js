// 베타 샘플 분석 공유 코드 — DB I/O + 코드 생성 + 만료/회수 판정.
//
// 사용 흐름:
//   1) admin 이 분석을 만든 뒤 createShareForAnalysis() 호출 → unique code 발급
//   2) admin 이 code 또는 /share/:code 링크를 외부 셀러에게 DM 으로 전달
//   3) 외부 셀러가 /api/shared-reports/:code 로 조회 → resolveShareByCode()
//   4) 조회 성공 시 recordShareView() 로 view_count / last_viewed_at 갱신
//
// 보안 메모:
//   - 코드는 crypto.randomBytes 기반 — 추측 불가 길이/엔트로피 확보.
//   - 만료/회수/미존재 모두 외부 응답은 동일한 generic 에러로 통일 (라우터 책임).
//     이 서비스는 호출자가 내부 로깅/관리자 화면에서 reason 을 활용할 수 있도록
//     세분화된 reason 을 반환한다 — 절대 사용자에게 그대로 노출하지 말 것.

import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import db from '../db/database.js';

// 기본 만료 30일. 0/음수면 무기한(null) 처리.
export const DEFAULT_SHARE_EXPIRES_DAYS = 30;

// 코드 alphabet — 시각 혼동 글자(O/0, I/1, L) 제외해 손으로 옮겨 적어도 오류 적게.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SEGMENT_LEN = 4;
const SEGMENT_COUNT = 2; // RF-XXXX-XXXX (총 11자 + 'RF-' prefix)

// 한 세그먼트 4글자를 cryptographically random 으로 생성.
function randomSegment() {
  // 한 글자당 alphabet[idx % len] — modulo bias 를 줄이기 위해 8bit 중 alphabet.length 의
  // 배수까지만 사용한다.
  const bytes = crypto.randomBytes(SEGMENT_LEN * 2);
  let out = '';
  let i = 0;
  while (out.length < SEGMENT_LEN && i < bytes.length) {
    const b = bytes[i++];
    if (b < CODE_ALPHABET.length * Math.floor(256 / CODE_ALPHABET.length)) {
      out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  // 흔치 않은 경우(편향 제거로 byte 부족) — 다시 시도.
  if (out.length < SEGMENT_LEN) return randomSegment();
  return out;
}

export function buildShareCode() {
  const segs = [];
  for (let i = 0; i < SEGMENT_COUNT; i++) segs.push(randomSegment());
  return `RF-${segs.join('-')}`;
}

// 코드 형식 가벼운 검증 — 잘못된 입력에서 DB 조회 자체를 건너뛰기.
// (대소문자 무시 — 사용자 입력 편의)
export function normalizeShareCode(input) {
  if (!input) return null;
  const s = String(input).trim().toUpperCase();
  if (!/^RF-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(s)) return null;
  return s;
}

function isoNowPlusDays(days) {
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

// analysis_id 가 실제로 완료된 분석인지 확인 — 진행 중/실패한 분석에 공유 코드를
// 만들면 외부 셀러가 빈 화면을 보게 된다.
export function isAnalysisShareable(analysisId) {
  const job = db
    .prepare('SELECT status FROM analysis_jobs WHERE id = ?')
    .get(analysisId);
  if (!job) return { ok: false, reason: 'not_found' };
  if (job.status !== 'completed' && job.status !== 'done') {
    return { ok: false, reason: 'not_completed' };
  }
  return { ok: true };
}

// 새 공유 코드 생성. unique 충돌 시 최대 5회 재시도.
//   expiresInDays: number | null  — null/0 이면 무기한.
export function createShareForAnalysis({ analysisId, createdBy, expiresInDays = DEFAULT_SHARE_EXPIRES_DAYS }) {
  if (!analysisId) throw new Error('analysisId 가 필요합니다.');
  if (!createdBy) throw new Error('createdBy 가 필요합니다.');

  const expiresAt = isoNowPlusDays(expiresInDays);
  const stmt = db.prepare(
    `INSERT INTO shared_reports (id, analysis_id, code, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?)`,
  );

  // unique 충돌 회피 — 1/(31^8) ≈ 1.2e-12 라 사실상 한 번에 성공하지만 안전망.
  let lastErr = null;
  for (let i = 0; i < 5; i++) {
    const code = buildShareCode();
    const id = nanoid();
    try {
      stmt.run(id, analysisId, code, expiresAt, createdBy);
      return getShareById(id);
    } catch (e) {
      if (String(e?.message || '').includes('UNIQUE')) {
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('공유 코드 생성에 실패했습니다.');
}

export function getShareById(shareId) {
  return db.prepare('SELECT * FROM shared_reports WHERE id = ?').get(shareId) || null;
}

export function listSharesForAnalysis(analysisId) {
  return db
    .prepare('SELECT * FROM shared_reports WHERE analysis_id = ? ORDER BY created_at DESC')
    .all(analysisId);
}

// 관리자 화면 — 전체 공유 코드 목록 (분석 기본 정보 포함).
export function listAllShares({ limit = 100, offset = 0 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const safeOffset = Math.max(0, Number(offset) || 0);
  return db
    .prepare(
      `SELECT s.*,
              j.created_at AS analysis_created_at,
              j.status     AS analysis_status,
              u.original_name AS original_name,
              admin.email  AS created_by_email
         FROM shared_reports s
         LEFT JOIN analysis_jobs j ON j.id = s.analysis_id
         LEFT JOIN upload_files u  ON u.id = j.upload_id
         LEFT JOIN users admin     ON admin.id = s.created_by
         ORDER BY s.created_at DESC
         LIMIT ? OFFSET ?`,
    )
    .all(safeLimit, safeOffset);
}

export function revokeShare(shareId) {
  const info = db
    .prepare(
      `UPDATE shared_reports
       SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND revoked_at IS NULL`,
    )
    .run(shareId);
  return info.changes > 0;
}

// 만료일 변경. expiresInDays === null 이면 무기한, 0 이면 즉시 만료.
export function updateShareExpiry(shareId, expiresInDays) {
  let expiresAt;
  if (expiresInDays === null) {
    expiresAt = null;
  } else if (Number(expiresInDays) === 0) {
    // 즉시 만료 — 과거 시각으로 설정.
    expiresAt = new Date(Date.now() - 1000).toISOString();
  } else {
    expiresAt = isoNowPlusDays(Number(expiresInDays));
    if (!expiresAt) throw new Error('expiresInDays 값이 올바르지 않습니다.');
  }
  const info = db
    .prepare(
      `UPDATE shared_reports
       SET expires_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .run(expiresAt, shareId);
  return info.changes > 0;
}

// 외부 조회 — 코드 → share 행. 만료/회수 판정도 함께 수행한다.
// 반환:
//   { ok: true, share }                  유효
//   { ok: false, reason: 'invalid' }     형식 불일치 / 미존재
//   { ok: false, reason: 'expired' }     만료
//   { ok: false, reason: 'revoked' }     회수
// 라우터는 reason 을 절대 외부 응답에 노출하지 말고 단일 메시지로 통일할 것.
export function resolveShareByCode(rawCode) {
  const code = normalizeShareCode(rawCode);
  if (!code) return { ok: false, reason: 'invalid' };
  const share = db.prepare('SELECT * FROM shared_reports WHERE code = ?').get(code);
  if (!share) return { ok: false, reason: 'invalid' };
  if (share.revoked_at) return { ok: false, reason: 'revoked' };
  if (share.expires_at && new Date(share.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, share };
}

export function recordShareView(shareId) {
  db.prepare(
    `UPDATE shared_reports
     SET view_count = view_count + 1,
         last_viewed_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(shareId);
}

// 관리자/외부 API 응답에서 사용할 share 직렬화. 내부 admin user id 같은 값은 노출하지 않는다.
export function serializeShareForAdmin(row) {
  if (!row) return null;
  return {
    id: row.id,
    analysisId: row.analysis_id,
    code: row.code,
    expiresAt: row.expires_at || null,
    revokedAt: row.revoked_at || null,
    viewCount: row.view_count || 0,
    lastViewedAt: row.last_viewed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
    createdBy: row.created_by,
    createdByEmail: row.created_by_email || null,
    analysisCreatedAt: row.analysis_created_at || null,
    analysisStatus: row.analysis_status || null,
    originalName: row.original_name || null,
    isExpired: !!(row.expires_at && new Date(row.expires_at).getTime() <= Date.now()),
    isRevoked: !!row.revoked_at,
  };
}

// 외부(셀러) 응답용 — 만료일/조회수만 노출, 관리자/내부 id 는 절대 보내지 않는다.
export function serializeShareForPublic(row) {
  if (!row) return null;
  return {
    code: row.code,
    expiresAt: row.expires_at || null,
    viewCount: row.view_count || 0,
    createdAt: row.created_at,
  };
}
