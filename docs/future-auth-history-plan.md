# 로그인 기반 분석 히스토리 확장 계획

현재 리뷰핏 MVP 는 로그인이 없으며, 분석 결과는 서버 DB 에 사용자 구분 없이 저장됩니다.
이 문서는 추후 로그인과 사용자별 분석 히스토리를 도입할 때의 확장 계획입니다.

> 이번 작업에서는 실제 인증을 구현하지 않습니다. nullable `user_id` 컬럼과 히스토리 API 기반만 준비했습니다.

## 현재 준비된 기반

- `analysis_jobs`, `product_analyses`, `reviews`, `upload_files`, `column_mappings`,
  `user_corrections` 에 nullable `user_id TEXT` 컬럼 추가(항상 NULL).
- `GET /api/analyses` — 최근 분석 히스토리 목록(현재 전체 반환).
- `GET /api/analysis/:id` — summary + products + createdAt 재조회.
- `listAnalyses({ limit, userId })` — `userId` 인자를 이미 받도록 설계(현재 미사용, 전체 반환).

## 추가할 테이블

### users
| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| id | TEXT PK | 사용자 ID |
| email | TEXT UNIQUE | 로그인 이메일 |
| password_hash | TEXT | 해시된 비밀번호(또는 OAuth 식별자) |
| display_name | TEXT | 표시 이름 |
| created_at | TEXT | 가입 시각 |

### workspaces 또는 stores (선택)
- 팀/스토어 단위로 분석을 묶을 때 사용.
- `workspace_members(workspace_id, user_id, role)` 로 멤버십 관리.
- 초대/팀 기능은 후순위.

## user_id 연결 대상

- `upload_files.user_id`
- `column_mappings.user_id`
- `reviews.user_id`
- `analysis_jobs.user_id`
- `product_analyses.user_id`
- `user_corrections.user_id`

업로드/분석 생성 시 `req.user.id` 를 채워 저장하고, 조회 시 동일 `user_id` 로 필터링합니다.

## 기능

- **사용자별 분석 목록** — `GET /api/analyses` 를 `WHERE analysis_jobs.user_id = ?` 로 필터.
- **분석 결과 재조회** — `GET /api/analysis/:id` 에 소유자 확인 추가.
- **분석 삭제** — `DELETE /api/analysis/:id` (연결 데이터 cascade 삭제).
- **보관 기간 설정** — 사용자/플랜별 보관 기간(예: 30/90일) 후 자동 만료.
- **초대/팀 기능** — 후순위(워크스페이스 단위 공유).

## 인프라 한계와 전환

- **Render + SQLite MVP 한계**:
  - Free 인스턴스는 재배포/재시작 시 디스크가 초기화될 수 있음.
  - 단일 파일 DB 라 동시성/백업/스케일아웃에 제약.
- **운영 시 전환 필요**:
  - PostgreSQL / Supabase 등 관리형 DB 로 이전.
  - 마이그레이션 도구(예: Prisma/Drizzle/knex) 도입 검토.
  - 인증은 자체 구현 또는 Supabase Auth / Auth0 / Clerk 등 활용 검토.

## 마이그레이션 시 주의

- 기존 NULL `user_id` 데이터는 "소유자 없음(레거시)" 으로 두거나, 최초 관리자 계정에 귀속.
- SQLite → PostgreSQL 전환 시 타입/날짜 함수(`datetime('now')`) 차이를 보정.
