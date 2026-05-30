// ADMIN_EMAILS 환경변수 파싱 + 부팅/로그인 시 보정 헬퍼.
//
// 사용:
//   const admins = getAdminEmails();              // ['a@x.com', 'b@x.com']
//   if (isAdminEmail('A@X.com')) { ... }          // 대소문자 무시
//   promoteConfiguredAdminEmails();               // 서버 부팅 시 1회
//
// 정책:
//   - 쉼표 구분, trim, lowercase
//   - 빈 문자열 제거
//   - ADMIN_EMAILS 가 없으면 빈 목록 (아무도 자동 admin 안 됨)
//   - 마지막 admin 강등 방지는 admin.routes.js / adminAudit.service 측에서 유지
import db from '../db/database.js';

// 파싱은 매 호출마다 (테스트에서 process.env 를 바꿀 수 있도록 캐싱 안 함)
export function getAdminEmails() {
  const raw = process.env.ADMIN_EMAILS || '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email) {
  if (!email) return false;
  const normalized = String(email).trim().toLowerCase();
  if (!normalized) return false;
  return getAdminEmails().includes(normalized);
}

// 서버 부팅 시 호출 — ADMIN_EMAILS 목록과 일치하는 기존 사용자 role 을 admin 으로 보정.
// 가입 전인 이메일은 로그만 남긴다 (서버 죽이지 않음). 이미 admin 이면 건너뜀.
export function promoteConfiguredAdminEmails() {
  const emails = getAdminEmails();
  if (emails.length === 0) return { configured: 0, promoted: 0, missing: [] };
  console.info(`[admin] ADMIN_EMAILS configured: ${emails.length}`);

  const findUser = db.prepare('SELECT id, email, role FROM users WHERE LOWER(email) = ?');
  const promote = db.prepare(
    `UPDATE users SET role = 'admin', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  );

  let promoted = 0;
  const missing = [];
  for (const email of emails) {
    const u = findUser.get(email);
    if (!u) {
      console.info(`[admin] Configured admin email not found yet: ${email}`);
      missing.push(email);
      continue;
    }
    if (u.role === 'admin') continue;
    promote.run(u.id);
    promoted++;
    console.info(`[admin] Promoted configured admin email: ${email}`);
  }
  console.info(`[admin] Configured admin promotion complete. promoted=${promoted}`);
  return { configured: emails.length, promoted, missing };
}

// 로그인 시 호출 — 비밀번호 검증 성공 후, 본인 이메일이 ADMIN_EMAILS 에 포함되고
// 현재 role 이 admin 이 아니면 admin 으로 보정. 본인 계정에만 작용.
// 입력: user row (id, email, role).
// 반환: 보정 후 role 문자열.
export function maybePromoteOnLogin(user) {
  if (!user) return user?.role || 'user';
  if (user.role === 'admin') return 'admin';
  if (!isAdminEmail(user.email)) return user.role || 'user';
  db.prepare(
    `UPDATE users SET role = 'admin', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).run(user.id);
  console.info(`[admin] Promoted user from ADMIN_EMAILS during login: ${user.email}`);
  return 'admin';
}
