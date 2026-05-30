// 특정 이메일 사용자를 admin role 로 승격.
// 사용:
//   npm run admin:promote -- admin@example.com
// 또는 (해제):
//   npm run admin:promote -- admin@example.com --demote
//
// 주의:
//   - 기존 admin 이 1명뿐일 때 --demote 는 거부된다(마지막 admin 보호).
//   - 환경변수 ADMIN_EMAILS 도 부팅 시 자동 승격 기능을 제공한다(둘 다 안전).
import db from '../src/db/database.js';

const args = process.argv.slice(2);
const demote = args.includes('--demote');
const email = (args.find((a) => !a.startsWith('--')) || '').trim().toLowerCase();

if (!email) {
  console.error('사용법: npm run admin:promote -- <email> [--demote]');
  process.exit(1);
}

const user = db.prepare('SELECT id, email, role FROM users WHERE LOWER(email) = ?').get(email);
if (!user) {
  console.error(`사용자를 찾을 수 없습니다: ${email}`);
  process.exit(1);
}

const adminCount = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`).get().c;

if (demote) {
  if (user.role !== 'admin') {
    console.log(`이미 admin 이 아닙니다: ${email} (role=${user.role})`);
    process.exit(0);
  }
  if (adminCount <= 1) {
    console.error('마지막 관리자 계정은 강등할 수 없습니다.');
    process.exit(1);
  }
  db.prepare(`UPDATE users SET role = 'user', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(user.id);
  console.log(`${email} 의 role 을 user 로 변경했습니다.`);
} else {
  if (user.role === 'admin') {
    console.log(`이미 admin 입니다: ${email}`);
    process.exit(0);
  }
  db.prepare(`UPDATE users SET role = 'admin', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(user.id);
  console.log(`${email} 을 admin 으로 승격했습니다.`);
}
