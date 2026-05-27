// 페이지 상단 제목 + 설명 + 우측 액션
export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-head">
      <div>
        <div className="page-head__title">{title}</div>
        {subtitle && <div className="page-head__sub">{subtitle}</div>}
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </div>
  );
}
