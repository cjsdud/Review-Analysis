// 헤더(제목/설명/액션) + 본문을 가진 카드. 차트·표·리스트를 감싸 일관된 SaaS 카드 레이아웃 제공.
// id 가 주어지면 SectionNavigator 의 스크롤 대상이 된다 (scroll-margin-top 은 .report-section 에서 적용).
export default function SectionCard({ id, title, subtitle, action, flush = false, children, className = '' }) {
  const cls = `section-card${flush ? ' section-card--flush' : ''}${id ? ' report-section' : ''} ${className}`.trim();
  return (
    <section id={id} className={cls}>
      {(title || action) && (
        <div className="section-card__head">
          <div>
            {title && <div className="section-card__title">{title}</div>}
            {subtitle && <div className="section-card__sub">{subtitle}</div>}
          </div>
          {action && <div className="section-card__actions">{action}</div>}
        </div>
      )}
      <div className="section-card__body">{children}</div>
    </section>
  );
}
