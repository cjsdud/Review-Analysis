export default function LoadingState({ title = '불러오는 중...', desc }) {
  return (
    <div className="state-box">
      <div className="spinner" />
      <div className="state-box__title">{title}</div>
      {desc && <div className="state-box__desc">{desc}</div>}
    </div>
  );
}
