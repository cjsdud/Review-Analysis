// 보호 자원 접근 실패 시 빈 화면 대신 보여줄 안내 컴포넌트.
// kind: 'AUTH_REQUIRED'(401) | 'FORBIDDEN'(403) | 'NOT_FOUND'(404) | 'GENERIC'
import { useNavigate } from 'react-router-dom';

const COPY = {
  AUTH_REQUIRED: {
    icon: '🔐',
    title: '로그인이 필요합니다.',
    desc: '계속하려면 Google 계정으로 로그인해 주세요.',
  },
  FORBIDDEN: {
    icon: '🚫',
    title: '이 분석 리포트에 접근할 권한이 없습니다.',
    desc: '다른 사용자가 만든 분석이거나, 본인의 분석이 아닐 수 있어요. 내 분석 히스토리에서 다시 선택해 주세요.',
  },
  NOT_FOUND: {
    icon: '🔎',
    title: '분석 리포트를 찾을 수 없습니다.',
    desc: '주소를 다시 확인하거나 내 분석 히스토리에서 다른 분석을 선택해 보세요.',
  },
  GENERIC: {
    icon: '⚠️',
    title: '리포트를 불러오지 못했어요.',
    desc: '잠시 후 다시 시도해 주세요.',
  },
};

export default function AccessError({ kind = 'GENERIC', detail = '' }) {
  const navigate = useNavigate();
  const copy = COPY[kind] || COPY.GENERIC;
  return (
    <div className="state-box">
      <div className="state-box__icon">{copy.icon}</div>
      <div className="state-box__title">{copy.title}</div>
      <div className="state-box__desc">{copy.desc}</div>
      {detail && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{detail}</div>}
      <div className="page-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
        {kind === 'AUTH_REQUIRED' ? (
          <button className="btn btn--primary" onClick={() => navigate('/login')}>
            Google로 로그인하기
          </button>
        ) : (
          <button className="btn btn--primary" onClick={() => navigate('/history')}>
            내 분석 히스토리로 이동
          </button>
        )}
      </div>
    </div>
  );
}

// HTTP status / error code → kind 매핑
export function errorKind(err) {
  const m = String(err?.message || err || '');
  if (m.includes('AUTH_REQUIRED') || m === '401') return 'AUTH_REQUIRED';
  if (m.includes('FORBIDDEN') || m === '403') return 'FORBIDDEN';
  if (m.includes('찾을 수 없') || m === '404') return 'NOT_FOUND';
  return 'GENERIC';
}
