// SEO 라우트 — /robots.txt, /sitemap.xml.
//
// 동적 라우트로 만든 이유:
//   - 정적 파일(frontend/public/*) 방식은 빌드 + 정적 미들웨어 순서에 의존하고, 도메인
//     하드코딩 문제가 있다.
//   - Express 라우트로 만들면 (a) SPA fallback 보다 명시적으로 먼저 등록 가능하고
//     (b) 사이트 URL 을 env (PUBLIC_SITE_URL / SITE_URL / CLIENT_ORIGIN) 로 주입할 수 있어
//     커스텀 도메인 전환 시 코드 변경 없이 자동 반영된다.
//
// 노출 정책:
//   - 비로그인 접근 가능한 공개 페이지만 sitemap 에 포함.
//   - /dashboard, /history, /upload, /admin/* 등 인증 필요 라우트와 /share/:code 같은
//     동적/비밀 라우트는 외부 노출 부적절 → sitemap 에서 제외.
//
// content-type 은 명시적으로 charset=utf-8 — Search Console 의 가져오기 안정성 ↑.

import { Router } from 'express';

const DEFAULT_SITE_URL = 'https://reviewfit-ribyupis.onrender.com';

// 1) PUBLIC_SITE_URL  — 가장 명시적 (커스텀 도메인 전환 시 사용)
// 2) SITE_URL         — 약식 alias
// 3) CLIENT_ORIGIN    — 기존 CORS origin 재사용 (보통 같은 값)
// 4) 기본값           — 현재 Render 운영 도메인
//
// 입력값에서 trailing slash 와 path 는 제거해 origin 만 사용.
export function resolveSiteUrl() {
  const raw = (
    process.env.PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    process.env.CLIENT_ORIGIN ||
    DEFAULT_SITE_URL
  ).trim();
  try {
    const u = new URL(raw);
    // protocol + host 만 사용 — 사용자가 실수로 https://...com/path 를 넣어도 안전.
    return `${u.protocol}//${u.host}`;
  } catch {
    // URL 파싱 실패 시 default — 잘못된 env 가 들어와도 빈 sitemap 을 만들지 않게.
    return DEFAULT_SITE_URL;
  }
}

// sitemap 에 포함할 공개 페이지.
// path 만 정의하고 origin 은 resolveSiteUrl() 로 동적 결합.
// 우선순위/주기는 일반적 SEO 관례에 맞춤 (랜딩 1.0 → 법적 페이지 0.3).
const PUBLIC_PAGES = [
  { path: '/',                   priority: '1.0', changefreq: 'weekly' },
  { path: '/demo/sample-report', priority: '0.8', changefreq: 'monthly' },
  { path: '/pricing',            priority: '0.7', changefreq: 'monthly' },
  { path: '/share',              priority: '0.5', changefreq: 'yearly' },
  { path: '/login',              priority: '0.4', changefreq: 'yearly' },
  { path: '/terms',              priority: '0.3', changefreq: 'yearly' },
  { path: '/privacy',            priority: '0.3', changefreq: 'yearly' },
];

function buildRobotsTxt(siteUrl) {
  return [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${siteUrl}/sitemap.xml`,
    '',
  ].join('\n');
}

function xmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[c]));
}

function buildSitemapXml(siteUrl) {
  const urls = PUBLIC_PAGES.map((p) => {
    // path 가 '/' 일 때 loc 가 '...com//' 가 되지 않게.
    const loc = p.path === '/' ? `${siteUrl}/` : `${siteUrl}${p.path}`;
    return [
      '  <url>',
      `    <loc>${xmlEscape(loc)}</loc>`,
      `    <changefreq>${p.changefreq}</changefreq>`,
      `    <priority>${p.priority}</priority>`,
      '  </url>',
    ].join('\n');
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

const router = Router();

router.get('/robots.txt', (_req, res) => {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600');
  res.status(200).send(buildRobotsTxt(resolveSiteUrl()));
});

router.get('/sitemap.xml', (_req, res) => {
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600');
  res.status(200).send(buildSitemapXml(resolveSiteUrl()));
});

export default router;
// 테스트 / 진단용 — 내부 헬퍼 노출.
export { buildRobotsTxt, buildSitemapXml, PUBLIC_PAGES };
