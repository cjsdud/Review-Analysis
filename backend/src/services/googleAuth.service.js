// Google ID Token 검증 + 계정 연결/생성 정책.
//
// 흐름 (POST /api/auth/google):
//   1) 프론트가 Google Identity Services 로 받은 credential(ID Token) 을 본 서비스로 전달.
//   2) verifyGoogleIdToken(credential) 이 google-auth-library 로 payload 를 검증.
//      - audience 가 GOOGLE_CLIENT_ID 와 일치하지 않으면 throw.
//      - exp 만료 / 서명 불일치 시 throw.
//   3) findOrCreateUserFromGooglePayload(payload) 가 다음 정책으로 user row 결정:
//      a. google_sub 가 이미 존재하는 user → 그대로 로그인 처리. role/plan/auth_provider 보존.
//      b. google_sub 는 없지만 같은 email 의 local user 가 있고 payload.email_verified 가 true →
//         해당 user 에 google_sub/avatar/email_verified 만 연결. role/plan 절대 덮어쓰지 않음.
//      c. 어떤 user 도 없으면 신규 user 생성 (auth_provider='google', password_hash=무의미 랜덤).
//         ADMIN_EMAILS 매칭이면 role='admin' 으로 생성 (기존 register 와 동일 정책).
//   4) signToken + setAuthCookie 는 라우트가 담당.
//
// 보안 원칙:
//   - 프론트가 보낸 email/sub 를 절대 신뢰하지 않음. payload 에서만 읽는다.
//   - email_verified 가 true 일 때만 기존 local 계정 연결 (가짜 검증 우회 방지).
//   - credential 원문 / access_token / refresh_token 등 비밀 값을 로그에 남기지 않는다.
//   - access_token / refresh_token 은 저장하지 않는다 (ReviewFit 은 Google API 호출 안 함).

import { OAuth2Client } from 'google-auth-library';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import db from '../db/database.js';
import { isAdminEmail } from './adminEmails.service.js';
import { getUserSubscription } from './billing.service.js';

const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
let cachedClient = null;
let cachedClientId = null;

function getGoogleClient() {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  if (!clientId) {
    // 운영자 미설정 — 라우트는 명확한 에러를 반환해야 한다.
    const err = new Error('GOOGLE_CLIENT_ID 가 설정되어 있지 않습니다.');
    err.code = 'GOOGLE_NOT_CONFIGURED';
    throw err;
  }
  if (cachedClient && cachedClientId === clientId) return cachedClient;
  cachedClient = new OAuth2Client(clientId);
  cachedClientId = clientId;
  return cachedClient;
}

// Google 로그인이 운영자에 의해 사용 가능 상태인지 — /api/auth/google 진입 직전 빠른 확인용.
export function isGoogleLoginConfigured() {
  return Boolean((process.env.GOOGLE_CLIENT_ID || '').trim());
}

// credential(ID Token, string) → Google payload 또는 throw.
// 성공 payload 예: { sub, email, email_verified, name, picture, iss, aud, exp, ... }
export async function verifyGoogleIdToken(credential) {
  if (!credential || typeof credential !== 'string' || credential.length < 20) {
    const err = new Error('credential 이 비어 있거나 형식이 올바르지 않습니다.');
    err.code = 'INVALID_CREDENTIAL';
    throw err;
  }
  const client = getGoogleClient();
  const audience = (process.env.GOOGLE_CLIENT_ID || '').trim();
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience });
    payload = ticket.getPayload();
  } catch (e) {
    // credential 원문 / e.message 안에 포함된 토큰을 그대로 logging 하지 않도록 reason 만.
    const err = new Error('Google ID Token 검증에 실패했습니다.');
    err.code = 'INVALID_GOOGLE_TOKEN';
    err.reason = String(e?.message || '').slice(0, 120);
    throw err;
  }
  if (!payload) {
    const err = new Error('Google 응답에서 사용자 정보를 읽을 수 없습니다.');
    err.code = 'INVALID_GOOGLE_TOKEN';
    throw err;
  }
  if (!ISSUERS.includes(payload.iss)) {
    const err = new Error('Google 응답의 발급자(iss) 가 올바르지 않습니다.');
    err.code = 'INVALID_GOOGLE_TOKEN';
    throw err;
  }
  if (payload.aud !== audience) {
    const err = new Error('Google 응답의 audience 가 ReviewFit 의 Client ID 와 일치하지 않습니다.');
    err.code = 'INVALID_GOOGLE_TOKEN';
    throw err;
  }
  if (!payload.sub) {
    const err = new Error('Google 응답에 sub 가 없습니다.');
    err.code = 'INVALID_GOOGLE_TOKEN';
    throw err;
  }
  if (!payload.email) {
    const err = new Error('Google 계정에서 이메일을 받을 수 없었어요.');
    err.code = 'INVALID_GOOGLE_TOKEN';
    throw err;
  }
  return payload;
}

// 안전한 user 직렬화 — password_hash 노출 금지.
function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    avatarUrl: row.avatar_url || null,
    authProvider: row.auth_provider || 'local',
  };
}

// payload → (kind, user) 결정 + DB 반영.
// kind: 'linked' | 'created' | 'returning'
//   returning : google_sub 기반 재로그인
//   linked    : 같은 email local 계정에 google_sub 연결
//   created   : 신규 user
//
// 반환 user 는 toPublicUser 형태. row 의 role/plan 은 절대 덮어쓰지 않는다.
export function findOrCreateUserFromGooglePayload(payload) {
  const sub = String(payload.sub);
  const email = String(payload.email).trim().toLowerCase();
  const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
  const name = payload.name || null;
  const avatar = payload.picture || null;

  // 1) google_sub 매칭 — 가장 안전한 returning 케이스.
  const bySub = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(sub);
  if (bySub) {
    // last_login_at + name/avatar 최신화. role / plan / auth_provider 절대 건드리지 않음.
    db.prepare(
      `UPDATE users
         SET name           = COALESCE(?, name),
             avatar_url     = COALESCE(?, avatar_url),
             email_verified = CASE WHEN ?=1 THEN 1 ELSE email_verified END,
             last_login_at  = CURRENT_TIMESTAMP,
             updated_at     = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(name, avatar, emailVerified ? 1 : 0, bySub.id);
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(bySub.id);
    return { kind: 'returning', user: toPublicUser(fresh) };
  }

  // 2) 같은 email 의 local user 가 있으면 → email_verified=true 일 때만 연결.
  const byEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (byEmail) {
    if (!emailVerified) {
      const err = new Error('이 Google 계정의 이메일이 아직 확인되지 않았습니다.');
      err.code = 'GOOGLE_EMAIL_UNVERIFIED';
      throw err;
    }
    // role / plan / auth_provider 보존. google_sub / avatar / email_verified 만 갱신.
    // (auth_provider 는 'local' 그대로 둔다 — local 비밀번호로도 계속 로그인 가능.)
    db.prepare(
      `UPDATE users
         SET google_sub     = ?,
             avatar_url     = COALESCE(?, avatar_url),
             name           = COALESCE(?, name),
             email_verified = 1,
             last_login_at  = CURRENT_TIMESTAMP,
             updated_at     = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(sub, avatar, name, byEmail.id);
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(byEmail.id);
    return { kind: 'linked', user: toPublicUser(fresh) };
  }

  // 3) 신규 user. password_hash 는 의미 없는 강한 hash — local 로그인 경로로는 절대 통과 불가.
  // 동시 가입 race 방지를 위해 INSERT 후 google_sub UNIQUE 충돌이 나면 재조회로 fallback.
  if (!emailVerified) {
    const err = new Error('Google 계정의 이메일이 확인되어야 가입할 수 있어요.');
    err.code = 'GOOGLE_EMAIL_UNVERIFIED';
    throw err;
  }
  const id = nanoid();
  const role = isAdminEmail(email) ? 'admin' : 'user';
  const dummyHash = bcrypt.hashSync(`!google-${id}-${nanoid()}`, 10);
  try {
    db.prepare(
      `INSERT INTO users
         (id, email, password_hash, name, role, auth_provider, google_sub, avatar_url, email_verified, last_login_at)
       VALUES (?, ?, ?, ?, ?, 'google', ?, ?, 1, CURRENT_TIMESTAMP)`,
    ).run(id, email, dummyHash, name, role, sub, avatar);
    if (role === 'admin') {
      console.info(`[admin] New Google user registered as admin (matches ADMIN_EMAILS): ${email}`);
    }
  } catch (e) {
    // 동시 가입 race — 다른 요청이 먼저 같은 sub 를 만들었으면 재조회.
    const conflict = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(sub);
    if (conflict) return { kind: 'returning', user: toPublicUser(conflict) };
    throw e;
  }
  // 기본 free 구독 자동 생성 — 기존 register 와 동일 정책.
  getUserSubscription(id);
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return { kind: 'created', user: toPublicUser(fresh) };
}

// 라우트에서 사용 — DB row 로부터 JWT signToken 에 넣을 sub/email 만 추출.
// signToken 자체는 auth.middleware 가 export.
export function tokenPayloadFromUser(publicUser) {
  return { sub: publicUser.id, email: publicUser.email };
}
