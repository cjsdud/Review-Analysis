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
    // admin 보정: 의도가 admin 인데 현재 user 이면 admin 으로 끌어올림.
    if (role === 'admin' && existing.role !== 'admin') {
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
  } else {
    console.info('[seed] SEED_TESTER_EMAIL not set — tester seed skipped.');
  }

  return { enabled: true, results };
}
