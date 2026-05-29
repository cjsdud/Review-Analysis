# Render 배포 가이드

## 목표

Render Web Service **하나로** backend Express API + frontend(Vite로 빌드한 정적 파일)
를 함께 서빙합니다. 별도 도메인 / CORS 설정 없이 같은 origin 에서 `/api/*` 가
호출되므로 셋업이 단순합니다.

> MVP 검증용 배포입니다. 장기 운영(영구 저장·고가용성)이 목적은 아닙니다.

---

## Render 서비스 설정값

| 항목 | 값 |
|---|---|
| Service Type | **Web Service** |
| Repository | `cjsdud/review-analysis` |
| Branch | `claude/laughing-mccarthy-2M9kC` (또는 기본 브랜치) |
| Root Directory | 비워둠 (= repository root) |
| Runtime | Node |
| Build Command | `npm run render:build` |
| Start Command | `npm run render:start` |
| Instance Type | Free / Starter (MVP는 Free로 충분) |

## Environment Variables

```env
NODE_ENV=production
PORT=10000
CLIENT_ORIGIN=https://your-app.onrender.com
LLM_PROVIDER=mock
MAX_UPLOAD_BYTES=10485760
DB_PATH=./data/app.db
UPLOAD_ROWS_TTL_MIN=60
```

### 주의 사항

- **PORT**: Render 는 `PORT` 환경변수를 컨테이너에 주입합니다. 코드가 이미
  `process.env.PORT` 를 사용하므로 그대로 두면 됩니다.
- **CLIENT_ORIGIN**: 같은 도메인에서 API 호출하므로 CORS 가 사실상 필요하지 않지만
  실제 배포된 URL 을 정확히 넣어 두는 것을 권장합니다.
- **LLM_PROVIDER=mock**: 실제 API 키 없이도 모든 기능 흐름이 동작합니다.
  실제 LLM 을 쓰고 싶으면 `openai` / `gemini` / `claude` 중 하나로 바꾸고
  해당 API 키를 추가하세요 (`OPENAI_API_KEY` / `GEMINI_API_KEY` / `ANTHROPIC_API_KEY`).
- **DB_PATH=./data/app.db**: SQLite 파일은 컨테이너 디스크에 저장됩니다.
  **Render Free 인스턴스는 재배포·재시작 시 디스크가 초기화됩니다.**
  분석 결과를 영구 보관해야 하면 Render Disk(유료) 또는 외부 DB(Postgres 등) 로
  이전을 고려하세요.

---

## SQLite 영속성 한계 (MVP 검증용)

이 배포는 **검증용**입니다.

- 인스턴스 슬립/재배포/스케일링 시 SQLite 파일이 사라질 수 있습니다.
- 업로드 파일 원본은 어차피 저장하지 않으며(메모리 파싱), 파싱된 `rows` 도
  TTL(`UPLOAD_ROWS_TTL_MIN`, 기본 60분) 경과 시 자동으로 비워집니다.
- 영구 저장이 필요한 경우 다음 중 하나를 도입하세요:
  - Render Disk (유료) + `DB_PATH` 가 그 Disk 마운트 경로를 가리키게
  - PostgreSQL/Postgres-호환 외부 DB (별도 마이그레이션 필요)

---

## 실제 셀러 파일 업로드 시 안내 (재확인)

처음 테스트할 때는 **개인정보 컬럼**(주문번호 / 구매자명 / 전화번호 / 이메일 등)을
업로드 전 미리 지운 파일을 올리는 것을 권장합니다. 리뷰핏은 분석 전 자동으로
마스킹하지만, 민감한 정보는 제거하고 올리는 편이 가장 안전합니다.

---

## 배포 후 확인 순서

1. 배포 URL 접속 (예: `https://review-fit.onrender.com`)
2. `/api/health` 가 `{"ok":true,"aiMode":"mock"}` 반환하는지 확인
3. 랜딩 페이지에서 **샘플 데이터로 체험하기** 클릭
4. 컬럼 매핑 화면이 정상 진입하는지 확인
5. “이대로 분석하기” 클릭 → 분석 완료
6. 대시보드에서 **샘플 데이터 분석 결과** 배지 + “이번에 먼저 고칠 상품 TOP 3” 노출
7. 상품 상세 진입 → 핵심 문제 / 체크리스트 / 답글 초안 표시
8. 답글 ‘복사하기’ 동작 (브라우저 권한 허용 필요)
9. 실제 리뷰 파일 업로드 테스트 (개인정보 제거된 파일 우선)
10. 모바일 화면 (390px) 에서도 확인

---

## 자주 발생하는 문제

| 증상 | 원인 / 해결 |
|---|---|
| 첫 접속이 30초 이상 느림 | Render Free 슬립 → 첫 요청에서 깨어남. Starter 이상으로 올리면 해결 |
| `/api/health` 는 OK 인데 페이지가 404 | 빌드가 안 됐을 가능성. `render:build` 가 `frontend/dist` 를 만드는지 로그 확인 |
| 404 발생 시 `API route not found` | 정상 동작 — `/api/*` 가 아닌 요청은 SPA fallback(index.html), 그 외 패턴은 404 |
| 분석 결과가 사라짐 | Free 인스턴스가 재시작되어 SQLite 가 초기화됨. 위 SQLite 영속성 한계 참조 |
| 파일 업로드 실패 | `MAX_UPLOAD_BYTES` 환경변수 확인. 기본 10MB |

---

## 로컬에서 production 흉내내기

배포 전에 같은 명령으로 한 번 돌려 보면 문제를 빨리 잡을 수 있습니다.

```bash
npm run render:build
NODE_ENV=production PORT=4000 npm run render:start
# 브라우저: http://localhost:4000
```
