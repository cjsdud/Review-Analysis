// SQLite DB 스냅샷 백업 스크립트.
// 사용:
//   npm run db:backup                    # 같은 디렉터리의 ./backups 로 저장
//   DB_BACKUP_DIR=/var/data/reviewfit/backups npm run db:backup
//
// 동작:
//   1) DB_PATH 확인 (database.js 와 동일한 해석 규칙)
//   2) 파일 존재 확인
//   3) BEGIN IMMEDIATE → VACUUM INTO  로 원자적 스냅샷
//      (실시간 쓰기 중에도 안전. WAL 모드와 호환)
//   4) backups/app-YYYYMMDD-HHMMSS.db 형식으로 저장
//
// 운영 환경 (Render):
//   Render Shell 또는 ssh 환경에서 실행하세요.
//   `DB_BACKUP_DIR` 을 Persistent Disk 안쪽으로 지정하면 안전합니다.
//   파일을 로컬로 가져오려면 Render CLI 또는 Shell 에서 별도 다운로드 절차가 필요합니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// database.js 와 동일한 경로 해석 규칙
const DEFAULT_DB_PATH = path.join(__dirname, '../data/app.db');
const dbPath = path.resolve(process.env.DB_PATH || DEFAULT_DB_PATH);

if (!fs.existsSync(dbPath)) {
  console.error(`[backup] DB 파일을 찾을 수 없습니다: ${dbPath}`);
  console.error('         DB_PATH 환경변수를 확인하세요.');
  process.exit(1);
}

const backupDir = path.resolve(
  process.env.DB_BACKUP_DIR || path.join(path.dirname(dbPath), 'backups'),
);
fs.mkdirSync(backupDir, { recursive: true });

// YYYYMMDD-HHMMSS (로컬 시간)
function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

const outPath = path.join(backupDir, `app-${timestamp()}.db`);

console.info(`[backup] source: ${dbPath}`);
console.info(`[backup] target: ${outPath}`);

try {
  const src = new Database(dbPath, { readonly: true });
  // VACUUM INTO 는 SQLite 3.27+ (better-sqlite3 의 기본 버전이 충족).
  // 트랜잭션 외부에서 실행해야 하며, 자동으로 일관된 스냅샷을 만든다.
  src.exec(`VACUUM INTO '${outPath.replace(/'/g, "''")}'`);
  src.close();
  const size = fs.statSync(outPath).size;
  console.info(`[backup] 완료: ${outPath} (${(size / 1024).toFixed(1)} KB)`);
} catch (e) {
  console.error(`[backup] 실패: ${e.message}`);
  process.exit(1);
}
