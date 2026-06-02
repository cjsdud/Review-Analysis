// 플랜 기능 플래그(canExportFullExcel / canPrintFullReport / printWatermark)를 한
// 군데에 모아 렌더하는 버튼 그룹. DashboardPage / ProductDetailPage 둘 다에서 사용.
//
// Free 정책:
//   - 엑셀 전체 다운로드 비활성 + Starter 안내 CTA
//   - 인쇄 시 워터마크 추가 (프린트 전용 .print-watermark)
// Starter+ : 제한 없음.
import { useAuth } from '../auth/AuthContext.jsx';

export default function PlanGatedExport({ xlsxUrl, onPrint }) {
  const { features, subscription, billingEnforced } = useAuth();
  // billing 미적용 환경(개발/익명)이면 기능 가시성을 그대로 허용 — 회귀 방지.
  const enforce = Boolean(billingEnforced);
  const canExport = !enforce || features?.canExportFullExcel !== false;
  const canPrint = !enforce || features?.canPrintFullReport !== false;
  const upgrade = subscription?.planLabel === 'Free' ? 'Starter' : '상위';

  return (
    <>
      {canExport ? (
        <a className="btn btn--ghost btn--sm" href={xlsxUrl}>⬇️ 엑셀 리포트 내보내기</a>
      ) : (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          title={`전체 엑셀 리포트는 ${upgrade} 플랜 이상에서 사용할 수 있습니다.`}
          onClick={() => window.alert(
            `무료 플랜에서는 요약만 다운로드할 수 있어요. 전체 엑셀 리포트는 ${upgrade} 플랜에서 사용할 수 있습니다.`,
          )}
        >
          ⬇️ 엑셀 리포트 내보내기 · {upgrade} 전용
        </button>
      )}
      {canPrint ? (
        <button className="btn btn--ghost btn--sm" onClick={onPrint || (() => window.print())}>
          🖨️ 인쇄 / PDF
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          title={`전체 인쇄 리포트는 ${upgrade} 플랜 이상에서 사용할 수 있습니다.`}
          onClick={() => window.alert(
            `전체 인쇄 리포트는 ${upgrade} 플랜에서 사용할 수 있습니다.`,
          )}
        >
          🖨️ 인쇄 / PDF · {upgrade} 전용
        </button>
      )}
    </>
  );
}

// 인쇄 시 우측 상단에 노출되는 Free 플랜 워터마크. 화면에선 숨김, @media print 에서만 노출.
export function PrintWatermark() {
  const { features, billingEnforced } = useAuth();
  if (!billingEnforced) return null;
  if (features?.printWatermark !== true) return null;
  return <div className="print-watermark">ReviewFit Free Report</div>;
}
