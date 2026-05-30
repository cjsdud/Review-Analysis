// 베타 테스트 편의용 계정 seed.
// SEED_ACCOUNTS_ENABLED=true 일 때만 동작.
//
// 동작:
//   - 서버 시작 시 SEED_ADMIN_EMAIL 과 SEED_TESTER_EMAIL 을 확인.
//   - 비밀번호는 bcrypt 해시로만 저장 (평문 / hash 모두 로그에 출력 금지).
//   - 같은 이메일 사용자가 있으면 새로 만들지 않음.
//   - admin 이메일이 이미 있고 role 이 user 면 admin 으로 보정.
//   - tester 이메일이 이미 admin 이면 강등하지 않음 (마지막 admin 강등 위험 회피),
//     대신 warning 만 출력.
//
// 보안 원칙:
//   - .env.example 에는 placeholder 만, 실제 비밀번호는 Render Environment Variables 로만.
//   - 비밀번호 / 해시는 console.* 에 절대 출력하지 않음.
//   - 비밀번호 < 8자 면 해당 계정만 skip + warning.
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import db from '../db/database.js';
import { getUserSubscription } from './billing.service.js';

const MIN_PASSWORD_LEN = 8;

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

// SEED_RESET_PASSWORDS: 기본 false.
// true 일 때만, 이미 존재하는 seed 계정의 password_hash 를 환경변수 비밀번호로 재설정.
// 평소에는 false 가 안전 (운영자가 비밀번호를 바꿔도 부팅 때마다 덮어쓰지 않도록).
function isResetPasswords() {
  return String(process.env.SEED_RESET_PASSWORDS || 'false').toLowerCase() === 'true';
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

// 단일 계정 생성/보정. password 는 절대 어디에도 출력하지 않음.
// 입력: { email, password, role, name }
// 출력: { skipped: bool, reason?: string, created?: bool, promoted?: bool, userId? }
export function createOrEnsureSeedUser({ email, password, role = 'user', name = null }) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail) return { skipped: true, reason: 'email_missing' };
  if (!password || password.length < MIN_PASSWORD_LEN) {
    return { skipped: true, reason: 'password_too_short' };
  }
  if (role !== 'admin' && role !== 'user') {
    return { skipped: true, reason: 'invalid_role' };
  }

  const findByEmail = db.prepare('SELECT id, email, role FROM users WHERE LOWER(email) = ?');
  const existing = findByEmail.get(cleanEmail);

  if (existing) {
    let passwordReset = false;
    // SEED_RESET_PASSWORDS=true 일 때만, 기존 seed 계정 비밀번호를 재설정.
    // 평문/해시는 절대 로그에 출력하지 않는다.
    if (isResetPasswords()) {
      const passwordHash = bcrypt.hashSync(password, 10);
      db.prepare(`UPDATE users SET password_hash=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(passwordHash, existing.id);
      passwordReset = true;
    }
    // admin 보정: 의도가 admin 인데 현재 user 이면 admin 으로 끌어올림.
    // SEED_ALLOW_PROMOTE_EXISTING=false 면 보정 자체를 막아 기존 사용자를 보호한다.
    if (role === 'admin' && existing.role !== 'admin') {
      if (!isAllowPromoteExisting()) {
        return { skipped: true, reason: 'promote_disabled', userId: existing.id, passwordReset };
      }
      db.prepare(`UPDATE users SET role='admin', updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(existing.id);
      getUserSubscription(existing.id); // 구독이 없으면 free 자동 생성
      return { skipped: false, created: false, promoted: true, userId: existing.id, passwordReset };
    }
    // tester 이메일이 admin 인 경우: 강등하지 않음 (마지막 admin 보호).
    if (role === 'user' && existing.role === 'admin') {
      return { skipped: true, reason: 'tester_is_admin_skip_demote', userId: existing.id, passwordReset };
    }
    // 이미 적절한 role + 존재 → 구독만 확인.
    getUserSubscription(existing.id);
    return { skipped: false, created: false, promoted: false, userId: existing.id, passwordReset };
  }

  // 신규 생성. bcrypt 해시는 절대 출력하지 않는다.
  const passwordHash = bcrypt.hashSync(password, 10);
  const id = nanoid();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  ).run(id, cleanEmail, passwordHash, name, role);
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
  if (isResetPasswords()) {
    console.warn('[seed][warning] SEED_RESET_PASSWORDS=true — seed 계정의 기존 비밀번호를 env 값으로 덮어씁니다. 운영 전환 시 false 로 두십시오.');
  }
  const results = [];

  // ── 관리자 ──
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (adminEmail) {
    console.info(`[seed] Admin seed email configured: ${adminEmail}`);
    const r = createOrEnsureSeedUser({
      email: adminEmail,
      password: adminPassword,
      role: 'admin',
      name: 'Seed Admin',
    });
    results.push({ kind: 'admin', email: adminEmail, ...r });
    if (r.skipped) {
      if (r.reason === 'password_too_short') {
        console.warn(`[seed][warning] Skipped admin seed (password missing or shorter than ${MIN_PASSWORD_LEN} chars): ${adminEmail}`);
      } else if (r.reason === 'promote_disabled') {
        console.warn(`[seed][warning] Existing user found but SEED_ALLOW_PROMOTE_EXISTING=false — admin role not granted: ${adminEmail}`);
      } else {
        console.warn(`[seed][warning] Skipped admin seed (${r.reason}): ${adminEmail}`);
      }
    } else if (r.created) {
      console.info(`[seed] Created seed admin account: ${adminEmail}`);
    } else if (r.promoted) {
      console.info(`[seed] Promoted seed admin account to admin: ${adminEmail}`);
    } else {
      console.info(`[seed] Seed admin already exists: ${adminEmail}`);
    }
    if (r.passwordReset) {
      console.info(`[seed] Reset seed admin password (SEED_RESET_PASSWORDS=true): ${adminEmail}`);
    }
  } else {
    console.info('[seed] SEED_ADMIN_EMAIL not set — admin seed skipped.');
  }

  // ── 베타 테스터 ──
  const testerEmail = process.env.SEED_TESTER_EMAIL;
  const testerPassword = process.env.SEED_TESTER_PASSWORD;
  if (testerEmail) {
    console.info(`[seed] Beta tester seed email configured: ${testerEmail}`);
    const r = createOrEnsureSeedUser({
      email: testerEmail,
      password: testerPassword,
      role: 'user',
      name: 'Seed Beta Tester',
    });
    results.push({ kind: 'tester', email: testerEmail, ...r });
    if (r.skipped) {
      if (r.reason === 'password_too_short') {
        console.warn(`[seed][warning] Skipped tester seed (password missing or shorter than ${MIN_PASSWORD_LEN} chars): ${testerEmail}`);
      } else if (r.reason === 'tester_is_admin_skip_demote') {
        console.warn(`[seed][warning] Tester email is currently admin — not demoting to user (last-admin protection): ${testerEmail}`);
      } else {
        console.warn(`[seed][warning] Skipped tester seed (${r.reason}): ${testerEmail}`);
      }
    } else if (r.created) {
      console.info(`[seed] Created seed beta tester account: ${testerEmail}`);
    } else {
      console.info(`[seed] Seed beta tester already exists: ${testerEmail}`);
    }
    if (r.passwordReset) {
      console.info(`[seed] Reset seed beta tester password (SEED_RESET_PASSWORDS=true): ${testerEmail}`);
    }
  } else {
    console.info('[seed] SEED_TESTER_EMAIL not set — tester seed skipped.');
  }

  return { enabled: true, results };
}
