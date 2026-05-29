# 리뷰핏 데이터 저장 및 보관 정책 초안

이 문서는 MVP 기준의 데이터 저장/보관 정책을 정리한 초안입니다. 실제 서비스 운영 전에는
로그인·권한·보관 기간·삭제 기능을 포함해 보강해야 합니다.

## 데이터 종류별 저장 여부

| 데이터 | 저장 여부 | 보관 목적 | 삭제 시점 |
| --- | --- | --- | --- |
| 원본 파일 바이너리 | 저장 안 함 | 없음 | 즉시 폐기 (메모리에서만 파싱) |
| 업로드 rows (`upload_files.rows`) | 임시 저장 | 컬럼 매핑/분석 전처리 | 분석 완료 직후 또는 60분 후 |
| sheet_parse_results (`upload_files.sheet_parse_results`) | 임시 저장 | XLSX 시트/헤더 선택 | 분석 완료 직후 또는 60분 후 |
| 정규화 리뷰 (`reviews`) | 저장 | 분석 결과 재조회 | 추후 사용자 삭제 기능 필요 |
| 리뷰별 분류 (`review_classifications`) | 저장 | 상품 상세/근거 리뷰 표시 | 추후 사용자 삭제 기능 필요 |
| 상품별 분석 결과 (`product_analyses`) | 저장 | 히스토리/리포트 재조회 | 추후 사용자 삭제 기능 필요 |
| 분석 작업/요약 (`analysis_jobs`) | 저장 | 히스토리 목록 | 추후 사용자 삭제 기능 필요 |
| 사용자 수정 내역 (`user_corrections`) | 저장 | 분류 개선/재조회 | 추후 사용자 삭제 기능 필요 |

> 임시 저장되는 rows / sheet_parse_results 는 **저장 전 개인정보 마스킹**(`maskRows` / `maskMatrix`)을
> 거칩니다. 정규화 리뷰의 본문도 마스킹된 값입니다.

## MVP 정책

- **원본 파일**: multer memoryStorage 로 메모리에서만 파싱하고 디스크에 쓰지 않습니다.
- **임시 데이터 삭제**:
  - 분석 완료 직후 `UPDATE upload_files SET rows = NULL, sheet_parse_results = NULL WHERE id = ?`.
  - 미완료 업로드는 `purgeStaleUploadRows(ttlMinutes)` 로 TTL 경과 시 삭제.
  - TTL 기본값 `UPLOAD_ROWS_TTL_MIN=60`(분), 최소 1분.
  - cleanup 주기 `UPLOAD_CLEANUP_INTERVAL_MIN=10`(분), 최소 1분. 서버 시작 시 1회 + 주기 실행.
  - 정리된 건수는 `console.info` 로 로깅(0건이면 로그 생략).
- **분석 결과 보관**: 히스토리/다시 보기를 위해 유지. 임시 데이터 삭제와 **별개 개념**입니다.
- **개인정보 최소화**: 작성자명은 첫 글자만 남기고 마스킹, 전화/이메일/주문번호/주소는 토큰 치환.

## 로그인 도입 후 정책

현재는 인증이 없으므로 `user_id` 컬럼은 nullable 로만 추가되어 있고 항상 NULL 입니다.
로그인 도입 후에는 다음을 적용합니다.

- 업로드/분석/리뷰/수정 내역을 `user_id` 로 귀속.
- `GET /api/analyses` 와 `GET /api/analysis/:id` 를 `req.user.id` 기준으로 필터링.
- 사용자는 본인 분석만 조회/삭제 가능.
- 보관 기간(예: 90일) 경과 시 분석 결과 자동 삭제 옵션.

## 삭제 기능 TODO

- [ ] 분석 단위 삭제 API (`DELETE /api/analysis/:id`) — 연결된 `product_analyses` /
      `review_classifications` / `reviews` / `user_corrections` 동시 삭제.
- [ ] 사용자 단위 전체 삭제(계정 탈퇴 시).
- [ ] 보관 기간 기반 자동 만료(분석 결과까지 포함).
- [ ] 프론트에서 분석 삭제 UI.

## 운영 전 보완할 점

- 로그인/회원가입/세션 또는 토큰 인증.
- 사용자별 권한 분리 및 접근 제어.
- SQLite → PostgreSQL/Supabase 등 외부 DB 전환(동시성/백업/영속성).
- Render Free 인스턴스는 재배포 시 디스크가 초기화되므로 영속 스토리지 필요.
- 개인정보 처리방침/이용약관 및 데이터 보관 기간 고지.
