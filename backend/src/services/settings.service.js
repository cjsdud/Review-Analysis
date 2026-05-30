// app_settings (DB) 접근 + 타입 변환 + 작은 캐시 + 변경 시 admin_action_logs 자동 기록.
//
// 사용 예:
//   getBooleanSetting('signup_enabled', true)
//   getNumberSetting('free_monthly_analysis_limit', 1)
//   setSetting('signup_enabled', false, adminUserId, '이벤트 종료')
//
// 보안:
//   - SECRET_BLOCKED_KEYS 에 등록된 키는 setSetting 으로 변경할 수 없다(throw).
//   - 캐시는 setSetting 시 자동 invalidate.
import { nanoid } from 'nanoid';
import db from '../db/database.js';

// 관리자 페이지/API 에서 값을 변경할 수 없는 키 (secret 류).
// API KEY, JWT secret 같은 값은 환경변수로만 관리.
const SECRET_BLOCKED_KEYS = new Set([
  'AUTH_JWT_SECRET',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'ANTHROPIC_API_KEY',
  'LLM_API_KEY',
  'DB_PATH',
  // 소문자 변형도 차단
  'auth_jwt_secret', 'openai_api_key', 'gemini_api_key', 'anthropic_api_key', 'llm_api_key', 'db_path',
]);

// 매우 단순한 메모리 캐시 — process 단위 (테스트 시 reset 가능).
const cache = new Map();
export function clearSettingsCache() {
  cache.clear();
}

function readSettingRow(key) {
  return db.prepare('SELECT * FROM app_settings WHERE key = ?').get(key);
}

function parseValue(row) {
  if (!row) return undefined;
  const v = row.value;
  switch (row.value_type) {
    case 'boolean':
      return v === 'true' || v === '1';
    case 'number': {
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'json':
      try { return JSON.parse(v); } catch { return undefined; }
    case 'string':
    default:
      return v;
  }
}

// 일반 조회 — 타입은 행의 value_type 에 따라 자동 변환.
export function getSetting(key, fallback) {
  if (cache.has(key)) return cache.get(key);
  const row = readSettingRow(key);
  const parsed = parseValue(row);
  const value = parsed === undefined ? fallback : parsed;
  cache.set(key, value);
  return value;
}

export function getBooleanSetting(key, fallback = false) {
  const v = getSetting(key, undefined);
  if (v === undefined) return fallback;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 'true' || v === '1';
  return Boolean(v);
}

export function getNumberSetting(key, fallback = 0) {
  const v = getSetting(key, undefined);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function getJsonSetting(key, fallback = null) {
  const v = getSetting(key, undefined);
  if (v && typeof v === 'object') return v;
  return fallback;
}

// 카테고리 별 목록 (관리자 페이지용).
export function listSettings(category) {
  if (category) {
    return db.prepare('SELECT * FROM app_settings WHERE category = ? ORDER BY key ASC').all(category);
  }
  return db.prepare('SELECT * FROM app_settings ORDER BY category, key ASC').all();
}

// value_type 에 맞춰 입력값 검증. throw 또는 정규화된 문자열 반환.
function coerceForType(valueType, value) {
  if (valueType === 'boolean') {
    if (typeof value === 'boolean') return String(value);
    if (value === 'true' || value === 'false' || value === '1' || value === '0') return String(value === 'true' || value === '1');
    throw new Error('boolean 값이 아닙니다.');
  }
  if (valueType === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error('number 값이 아닙니다.');
    return String(n);
  }
  if (valueType === 'json') {
    if (typeof value === 'string') {
      try { JSON.parse(value); return value; } catch { throw new Error('JSON 형식이 올바르지 않습니다.'); }
    }
    return JSON.stringify(value);
  }
  // string
  if (value == null) return '';
  return String(value);
}

// 설정 변경 + admin_action_logs 자동 기록. 캐시 무효화.
// 입력: key, value, adminUserId, reason?
// 출력: { key, before, after }
// throw 케이스: SECRET_KEY, key 없음, 타입 불일치
export function setSetting(key, value, adminUserId, reason) {
  if (SECRET_BLOCKED_KEYS.has(key)) {
    const e = new Error('SECRET_KEY_BLOCKED');
    e.code = 'SECRET_KEY_BLOCKED';
    throw e;
  }
  const row = readSettingRow(key);
  if (!row) {
    const e = new Error('SETTING_NOT_FOUND');
    e.code = 'SETTING_NOT_FOUND';
    throw e;
  }
  const before = row.value;
  const next = coerceForType(row.value_type, value);
  if (before === next) {
    return { key, before, after: next, changed: false };
  }
  db.prepare(
    `UPDATE app_settings SET value = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?`,
  ).run(next, adminUserId || null, key);
  cache.delete(key);
  // 관리자 변경 로그
  db.prepare(
    `INSERT INTO admin_action_logs (id, admin_user_id, action_type, target_type, target_id, before_value, after_value, reason)
     VALUES (?, ?, 'SETTING_UPDATED', 'setting', ?, ?, ?, ?)`,
  ).run(nanoid(), adminUserId, key, before, next, reason || null);
  return { key, before, after: next, changed: true };
}
