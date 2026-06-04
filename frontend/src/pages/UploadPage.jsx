import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import FileUploader from '../components/FileUploader.jsx';
import LoadingState from '../components/LoadingState.jsx';
import Stepper from '../components/Stepper.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { uploadFile, uploadSample } from '../api/uploadApi.js';

const REQUIRED_COLUMNS = [
  { name: '상품명', req: '필수', desc: '어떤 상품의 리뷰인지 구분합니다.' },
  { name: '리뷰 내용', req: '필수', desc: '고객이 작성한 실제 리뷰 본문입니다.' },
  { name: '별점', req: '권장', desc: '부정/긍정을 구분하는 데 사용합니다.' },
  { name: '작성일', req: '선택', desc: '월간 트렌드 분석에 사용합니다.' },
  { name: '옵션명', req: '선택', desc: '사이즈·색상 옵션별 이슈 분석에 사용합니다.' },
];

export default function UploadPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleUpload(file) {
    setError('');
    setLoading(true);
    try {
      const res = await uploadFile(file);
      navigate(`/mapping/${res.uploadId}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSample() {
    setError('');
    setLoading(true);
    try {
      const res = await uploadSample();
      navigate(`/mapping/${res.uploadId}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (params.get('sample') === '1') handleSample();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <PageHeader
        title="리뷰 파일 업로드"
        subtitle="CSV 또는 XLSX 파일을 올리면 다음 단계에서 컬럼을 자동으로 매핑해 드립니다."
      />

      {/* 베타 안내 — 데이터 초기화 가능성 자연스럽게 안내. 너무 무섭게 보이지 않도록 부드러운 톤. */}
      <div className="beta-notice" role="note">
        <span className="beta-notice__ico" aria-hidden="true">🧪</span>
        <div className="beta-notice__body">
          <b>무료 베타 서비스입니다.</b>{' '}
          분석 결과는 베타 점검 과정에서 초기화될 수 있어요. 필요한 리포트는
          상품 상세에서 CSV 로 저장하거나 화면을 캡처해 두시는 걸 권장합니다.
        </div>
      </div>

      <Stepper current={1} />

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <LoadingState title="파일을 읽고 있어요" desc="컬럼을 자동으로 인식하는 중입니다…" />
      ) : (
        <>

          {/* 안내 패널 */}
          <div className="upload-hint">
            <div className="upload-hint__title">어떤 파일을 올리면 되나요?</div>
            <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 14 }}>
              지원 형식: <b>CSV · XLSX</b> (최대 10MB). 아래 컬럼이 포함되어 있으면 자동으로 인식합니다.
            </p>
            <div className="upload-hint__grid">
              {REQUIRED_COLUMNS.map((c) => (
                <div className="upload-hint__item" key={c.name}>
                  <b>
                    {c.name} <span className="muted" style={{ fontSize: 11, fontWeight: 600 }}>· {c.req}</span>
                  </b>
                  {c.desc}
                </div>
              ))}
            </div>
            <div className="upload-hint__privacy">
              <span>🔒</span>
              <span>
                주문번호·전화번호·이메일 등은 분석 전에 자동 마스킹됩니다. 분석에는{' '}
                <b>상품명·별점·리뷰 내용</b>만 있으면 충분합니다.
              </span>
            </div>
          </div>

          {/* 업로더 */}
          <div className="mt-4">
            <FileUploader onFile={handleUpload} disabled={loading} />
          </div>

          {/* 보조: 샘플 데이터로 테스트 — 메인 흐름은 위 파일 업로더. */}
          <div className="sample-cta">
            <div className="sample-cta__hint">파일이 준비되지 않았다면 샘플 데이터로 먼저 결과를 살펴볼 수 있어요.</div>
            <button className="btn btn--ghost" onClick={handleSample}>
              샘플 데이터로 테스트하기
            </button>
          </div>

          {/* 실제 리뷰 파일 검증 안내 — 개인정보 보호 강조 */}
          <div className="real-file-hint">
            <div className="real-file-hint__title">실제 리뷰 파일로 테스트하려면</div>
            <p className="real-file-hint__lead">
              처음 테스트할 때는 <b>주문번호, 구매자명, 전화번호, 이메일</b> 등 개인정보 컬럼을
              삭제한 파일을 올려주세요.
            </p>
            <p className="real-file-hint__lead">
              리뷰핏은 분석 전 개인정보를 자동 마스킹하지만, <b>민감한 정보는 업로드 전에 제거하는 것</b>을 권장합니다.
            </p>
            <ul>
              <li>분석에는 <b>상품명 · 별점 · 리뷰 내용</b>만 있어도 충분합니다.</li>
              <li>주문번호 · 전화번호 · 이메일 · 주소는 업로드 직후 <b>자동으로 가려집니다</b>.</li>
              <li>업로드한 리뷰 파일은 <b>서버 디스크에 저장되지 않습니다</b> (메모리에서만 분석에 사용).</li>
              <li>파싱된 데이터도 분석 후 / 일정 시간 경과 후 <b>자동으로 비웁니다</b>.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
