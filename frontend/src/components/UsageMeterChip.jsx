// 상단 topbar 사용량 chip + 팝오버.
//
// 로그인 사용자에게만 표시. /api/me 의 plan + monthlyAnalysis/File/CsReply 사용량을
// AuthContext.usage 에서 읽어 표시한다. limit 이 0/null 이면 "제한 없음" 처리.
// 데스크톱에선 plan + 한도 임박/도달 라벨이 있는 작은 chip. 클릭하면 3 항목 게이지 팝오버.
// 모바일에선 같은 chip 이지만 plan 라벨만 노출하고 탭 시 동일 팝오버.

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { normalizeUsageSummary, formatUsageLine, usageStatusLabel } from '../utils/usage.js';

export default function UsageMeterChip() {
  const { user, subscription, usage } = useAuth();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;
  const summary = normalizeUsageSummary({ subscription, usage });
  if (!summary) return null;

  const statusLabel = usageStatusLabel(summary.overallStatus);

  return (
    <div className="usage-chip" ref={ref}>
      <button
        type="button"
        className={`usage-chip__btn usage-chip__btn--${summary.overallStatus}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`사용량 보기 — ${summary.plan} 플랜`}
        onClick={() => setOpen((v) => !v)}
        title={statusLabel ? `${summary.plan} 플랜 · ${statusLabel}` : `${summary.plan} 플랜`}
      >
        <span className="usage-chip__plan">{summary.plan}</span>
        {statusLabel && <span className="usage-chip__status">· {statusLabel}</span>}
      </button>

      {open && (
        <div className="usage-chip__pop" role="dialog" aria-label="이번 달 사용량">
          <div className="usage-chip__pop-head">
            <div className="usage-chip__pop-plan">{summary.plan} 플랜</div>
            {summary.planTagline && (
              <div className="muted" style={{ fontSize: 12 }}>{summary.planTagline}</div>
            )}
          </div>
          <ul className="usage-chip__list">
            {summary.items.map((item) => (
              <li key={item.key} className={`usage-chip__row usage-chip__row--${item.status}`}>
                <div className="usage-chip__row-head">
                  <span className="usage-chip__row-label">{item.label}</span>
                  <span className="usage-chip__row-value">{formatUsageLine(item)}</span>
                </div>
                {item.hasLimit && (
                  <div className="usage-chip__bar-track" aria-hidden="true">
                    <div
                      className="usage-chip__bar-fill"
                      style={{ width: `${Math.round(item.ratio * 100)}%` }}
                    />
                  </div>
                )}
                {item.hasLimit && item.status !== 'normal' && (
                  <div className="usage-chip__row-status">
                    {usageStatusLabel(item.status)}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="usage-chip__footnote muted">
            매월 1일에 사용량이 초기화됩니다.
          </div>
        </div>
      )}
    </div>
  );
}
