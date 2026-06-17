// 베타 테스트 편의용 계정 seed.
// SEED_ACCOUNTS_ENABLED=true 일 때만 동작.
//
// Google 로그인 only 전환 이후 정책:
//   - 비밀번호는 더 이상 인증에 사용되지 않는다. password_hash 컬럼이 NOT NULL 이라
//     dummy bcrypt hash 로만 채워넣어 row 생성을 가능하게 한다.
//   - SEED_ADMIN_PASSWORD / SEED_TESTER_PASSWORD 환경변수는 더 이상 필요하지 않다.
//     (설정해도 무시되며 dummy hash 가 들어간다. 운영 로그에는 노출되지 않는다.)
//   - 이 service 의 목적은 "운영자가 ADMIN_EMAILS 의 이메일로 Google 로그인 하기 전에도
//     해당 user row 가 admin role 로 미리 존재하게 하는 것". Google 로그인 시점에는
//     googleAuth.service.findOrCreateUserFromGooglePayload 가 같은 email 의 row 를
//     찾아 google_sub 만 연결하므로(role/plan 보존), 첫 로그인이 곧 admin 권한 부여로 이어진다.
//   - 같은 이메일 사용자가 있으면 새로 만들지 않는다.
//   - admin 이메일이 이미 있고 role 이 user 면 admin 으로 보정(SEED_ALLOW_PROMOTE_EXISTING).
//   - tester 이메일이 이미 admin 이면 강등하지 않는다 (마지막 admin 보호).
//
// 보안 원칙:
//   - dummy hash 도 로그/응답에 절대 노출하지 않는다.
//   - 운영자가 잘못된 이메일을 넣어도 외부에 admin/tester 구분이 흘러가지 않는다.
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import db from '../db/database.js';
import { getUserSubscription } from './billing.service.js';

function isEnabled() {
  return String(process.env.SEED_ACCOUNTS_ENABLED || 'false').toLowerCase() === 'true';
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// SEED_ALLOW_PROMOTE_EXISTING: 기본 true.
// 기존 user 계정을 admin 으로 보정하는 동작을 켤지 끌지.
// (false 인 경우, 이미 존재하는 사용자는 절대 admin 으로 올리지 않고 skip.)
function isAllowPromoteExisting() {
  const v = process.env.SEED_ALLOW_PROMOTE_EXISTING;
  if (v == null || String(v).trim() === '') return true;
  return String(v).toLowerCase() === 'true';
}

// Google 로그인 only 전환 후 — password 는 인증에 사용되지 않으므로 reset 토글도 의미 없음.
// 호환을 위해 함수만 남기고 항상 false 반환.
function isResetPasswords() {
  return false;
}

// Google 로그인 only 전환 후 dummy password_hash — 인증에 사용되지 않으며,
// 같은 hash 가 모든 seed user 에 들어가도 무관(login 경로 자체가 없음).
// 그래도 row 마다 randomness 를 더해 DB 덤프 분석을 어렵게 한다.
function dummyPasswordHash() {
  return bcrypt.hashSync(`!seed-google-only-${nanoid()}`, 10);
}

// 설정된 seed 계정 이메일 목록 (정규화된 lowercase / 빈 값 제외).
// SEED_ACCOUNTS_ENABLED 와 무관하게 환경변수에 값이 있으면 "예약된" 것으로 본다.
// 이유: 운영자가 SEED_ACCOUNTS_ENABLED=false 로 끄고 seed 기능을 잠시 비활성화해도,
// 그 사이에 일반 사용자가 해당 이메일로 가입해 버리면 다시 켰을 때 충돌이 생기기 때문.
export function getSeedAccountEmails() {
  return [process.env.SEED_ADMIN_EMAIL, process.env.SEED_TESTER_EMAIL]
    .map((e) => normalizeEmail(e))
    .filter((e) => e.length > 0);
}

// 해당 이메일이 SEED_ADMIN_EMAIL 또는 SEED_TESTER_EMAIL 로 예약된 이메일인가?
// 대소문자/공백 무시. 일반 회원가입 차단 검증용.
export function isSeedReservedEmail(email) {
  const target = normalizeEmail(email);
  if (!target) return false;
  return getSeedAccountEmails().includes(target);
}

// 보안: 외부(클라이언트/로그/응답)에는 admin/tester 구분을 절대 노출하지 않음.
// 내부 로직에서만 사용.
export function isSeedAdminEmail(email) {
  const target = normalizeEmail(email);
  if (!target) return false;
  return normalizeEmail(process.env.SEED_ADMIN_EMAIL) === target;
}

export function isSeedTesterEmail(email) {
  const target = normalizeEmail(email);
  if (!target) return false;
  return normalizeEmail(process.env.SEED_TESTER_EMAIL) === target;
}

// 단일 계정 생성/보정. password 인자는 더 이상 사용되지 않으며 항상 dummy hash 가 저장된다.
// 입력: { email, role, name }
// 출력: { skipped: bool, reason?: string, created?: bool, promoted?: bool, userId? }
export function createOrEnsureSeedUser({ email, role = 'user', name = null }) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail) return { skipped: true, reason: 'email_missing' };
  if (role !== 'admin' && role !== 'user') {
    return { skipped: true, reason: 'invalid_role' };
  }

  const findByEmail = db.prepare('SELECT id, email, role FROM users WHERE LOWER(email) = ?');
  const existing = findByEmail.get(cleanEmail);

  if (existing) {
    // admin 보정: 의도가 admin 인데 현재 user 이면 admin 으로 끌어올림.
    // SEED_ALLOW_PROMOTE_EXISTING=false 면 보정 자체를 막아 기존 사용자를 보호한다.
    if (role === 'admin' && existing.role !== 'admin') {
      if (!isAllowPromoteExisting()) {
        return { skipped: true, reason: 'promote_disabled', userId: existing.id };
      }
      db.prepare(`UPDATE users SET role='admin', updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(existing.id);
      getUserSubscription(existing.id); // 구독이 없으면 free 자동 생성
      return { skipped: false, created: false, promoted: true, userId: existing.id };
    }
    // tester 이메일이 admin 인 경우: 강등하지 않음 (마지막 admin 보호).
    if (role === 'user' && existing.role === 'admin') {
      return { skipped: true, reason: 'tester_is_admin_skip_demote', userId: existing.id };
    }
    // 이미 적절한 role + 존재 → 구독만 확인.
    getUserSubscription(existing.id);
    return { skipped: false, created: false, promoted: false, userId: existing.id };
  }

  // 신규 생성 — Google 로그인 only 환경. dummy password_hash 는 인증에 사용되지 않으며
  // 로그에 노출되지 않는다. auth_provider 는 'local' 그대로 두고, 실제 첫 Google 로그인 시
  // googleAuth.service 가 같은 이메일을 찾아 google_sub 를 연결한다 (role 보존).
  const id = nanoid();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  ).run(id, cleanEmail, dummyPasswordHash(), name, role);
  getUserSubscription(id); // 기본 free 구독 자동 생성
  return { skipped: false, created: true, promoted: false, userId: id };
}

// 서버 시작 시 호출. SEED_ACCOUNTS_ENABLED=true 일 때만 동작.
// 출력: { enabled, results: [...] }
export function seedConfiguredAccounts() {
  if (!isEnabled()) {
    console.info('[seed] Seed accounts disabled.');
    return { enabled: false, results: [] };
  }

  console.info('[seed] Seed accounts enabled. Ensuring configured accounts...');
  // 위험 동작 운영자 확인용 boot warning.
  if (isAllowPromoteExisting()) {
    console.warn('[seed][warning] SEED_ALLOW_PROMOTE_EXISTING=true — 기존 사용자 계정도 seed admin 으로 보정될 수 있습니다. 운영 전환 시 false 로 두는 것을 권장합니다.');
  }
  const results = [];

  // ── 관리자 ──
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  if (adminEmail) {
    console.info(`[seed] Admin seed email configured: ${adminEmail}`);
    const r = createOrEnsureSeedUser({
      email: adminEmail,
      role: 'admin',
      name: 'Seed Admin',
    });
    results.push({ kind: 'admin', email: adminEmail, ...r });
    if (r.skipped) {
      if (r.reason === 'promote_disabled') {
        console.warn(`[seed][warning] Existing user found but SEED_ALLOW_PROMOTE_EXISTING=false — admin role not granted: ${adminEmail}`);
      } else {
        console.warn(`[seed][warning] Skipped admin seed (${r.reason}): ${adminEmail}`);
      }
    } else if (r.created) {
      console.info(`[seed] Created seed admin row: ${adminEmail} (Google 로그인 시 자동 연결)`);
    } else if (r.promoted) {
      console.info(`[seed] Promoted seed admin account to admin: ${adminEmail}`);
    } else {
      console.info(`[seed] Seed admin already exists: ${adminEmail}`);
    }
  } else {
    console.info('[seed] SEED_ADMIN_EMAIL not set — admin seed skipped.');
  }

  // ── 베타 테스터 ──
  const testerEmail = process.env.SEED_TESTER_EMAIL;
  if (testerEmail) {
    console.info(`[seed] Beta tester seed email configured: ${testerEmail}`);
    const r = createOrEnsureSeedUser({
      email: testerEmail,
      role: 'user',
      name: 'Seed Beta Tester',
    });
    results.push({ kind: 'tester', email: testerEmail, ...r });
    if (r.skipped) {
      if (r.reason === 'tester_is_admin_skip_demote') {
        console.warn(`[seed][warning] Tester email is currently admin — not demoting to user (last-admin protection): ${testerEmail}`);
      } else {
        console.warn(`[seed][warning] Skipped tester seed (${r.reason}): ${testerEmail}`);
      }
    } else if (r.created) {
      console.info(`[seed] Created seed beta tester row: ${testerEmail} (Google 로그인 시 자동 연결)`);
    } else {
      console.info(`[seed] Seed beta tester already exists: ${testerEmail}`);
    }
  } else {
    console.info('[seed] SEED_TESTER_EMAIL not set — tester seed skipped.');
  }

  return { enabled: true, results };
}
