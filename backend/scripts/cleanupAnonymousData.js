// 익명/테스트 분석 데이터 정리 스크립트.
// 운영 전환 직전에 user_id IS NULL 인 분석/업로드/리뷰 데이터를 정리한다.
//
// 사용:
//   node scripts/cleanupAnonymousData.js            # dry-run (개수만 출력)
//   node scripts/cleanupAnonymousData.js --confirm  # 실제 삭제
//
// 절대 삭제하지 않는 테이블: users, plans, subscriptions, payments
// usage_events 는 스키마상 user_id NOT NULL 이므로 정리 대상 아님(스킵).
//
// 외래키 관계는 SQLite 기본 모드(pragma 미설정)에서 enforce 되지 않지만,
// 안전하게 자식 테이블 → 부모 테이블 순서로 삭제한다.

import db from '../src/db/database.js';

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');

// 정리 대상 — (label, table, where) 튜플. 삭제 순서는 자식→부모.
const TARGETS = [
  ['user_corrections',         'user_corrections',         'user_id IS NULL'],
  ['review_classifications',   'review_classifications',   'user_id IS NULL'],
  ['product_analyses',         'product_analyses',         'user_id IS NULL'],
  ['analysis_jobs',            'analysis_jobs',            'user_id IS NULL'],
  ['reviews',                  'reviews',                  'user_id IS NULL'],
  ['column_mappings',          'column_mappings',          'user_id IS NULL'],
  ['upload_files',             'upload_files',             'user_id IS NULL'],
];

function tableExists(name) {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(name);
  return !!row;
}

function columnExists(table, column) {
  if (!tableExists(table)) return false;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function countRows(table, where) {
  if (!tableExists(table)) return 0;
  if (!columnExists(table, 'user_id')) return 0;
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get();
  return Number(row?.n || 0);
}

console.log('[cleanup:anonymous] 익명 분석 데이터 정리 도구');
console.log(`  모드: ${CONFIRM ? '실제 삭제 (--confirm)' : 'dry-run (개수만 출력)'}`);
console.log('  대상: user_id IS NULL 인 분석/업로드/리뷰 데이터');
console.log('  보존: users, plans, subscriptions, payments, usage_events');
console.log('');

let total = 0;
const counts = [];
for (const [label, table, where] of TARGETS) {
  const n = countRows(table, where);
  counts.push([label, table, where, n]);
  total += n;
  console.log(`  - ${label.padEnd(28)} 대상 ${String(n).padStart(6)}건`);
}

console.log('');
console.log(`  합계: ${total}건`);

if (total === 0) {
  console.log('\n[cleanup:anonymous] 삭제할 익명 데이터가 없습니다.');
  process.exit(0);
}

if (!CONFIRM) {
  console.log('\n[cleanup:anonymous] dry-run 모드 — 실제 삭제는 수행하지 않았습니다.');
  console.log('  실행하려면 --confirm 을 붙이세요:');
  console.log('  npm run cleanup:anonymous:confirm');
  console.log('  주의: DB 백업 후 실행하는 것을 권장합니다.');
  process.exit(0);
}

// 실제 삭제 — 트랜잭션으로 묶어 부분 실패 시 롤백.
const deleted = {};
const tx = db.transaction(() => {
  for (const [label, table, where] of counts.map((c) => [c[0], c[1], c[2]])) {
    if (!tableExists(table) || !columnExists(table, 'user_id')) {
      deleted[label] = 0;
      continue;
    }
    const info = db.prepare(`DELETE FROM ${table} WHERE ${where}`).run();
    deleted[label] = info.changes;
  }
});

try {
  tx();
  console.log('\n[cleanup:anonymous] 삭제 완료:');
  let removedTotal = 0;
  for (const [label, n] of Object.entries(deleted)) {
    console.log(`  - ${label.padEnd(28)} 삭제 ${String(n).padStart(6)}건`);
    removedTotal += n;
  }
  console.log(`\n  합계: ${removedTotal}건 삭제`);
} catch (e) {
  console.error(`\n[cleanup:anonymous] 삭제 중 오류 발생 — 트랜잭션 롤백됨: ${e.message}`);
  process.exit(1);
}
