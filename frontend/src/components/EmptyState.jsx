import { useNavigate } from 'react-router-dom';

export default function EmptyState({
  icon = '📭',
  title = '데이터가 없습니다',
  desc = '리뷰 파일을 업로드하면 분석 결과가 여기에 표시됩니다.',
  actionLabel,
  actionTo,
  secondaryActionLabel,
  secondaryActionTo,
}) {
  const navigate = useNavigate();
  return (
    <div className="state-box">
      <div className="state-box__icon">{icon}</div>
      <div className="state-box__title">{title}</div>
      <div className="state-box__desc">{desc}</div>
      {(actionLabel || secondaryActionLabel) && (
        <div className="state-box__actions">
          {actionLabel && actionTo && (
            <button className="btn btn--primary" onClick={() => navigate(actionTo)}>
              {actionLabel}
            </button>
          )}
          {secondaryActionLabel && secondaryActionTo && (
            <button className="btn btn--ghost" onClick={() => navigate(secondaryActionTo)}>
              {secondaryActionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
