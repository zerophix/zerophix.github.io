const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'https://zerophix.github.io/';

(async () => {
  const consoleMsgs = [], badResponses = [], failedReqs = [];
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleMsgs.push(m.type() + ': ' + m.text()); });
  p.on('pageerror', e => consoleMsgs.push('pageerror: ' + e.message));
  p.on('response', r => { if (r.status() >= 400) badResponses.push(r.status() + ' ' + r.url()); });
  p.on('requestfailed', r => failedReqs.push(r.url() + ' :: ' + ((r.failure() || {}).errorText || '')));

  const t0 = Date.now();
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);   /* 字体 CDN 常挂起，不等 networkidle */
  const loadMs = Date.now() - t0;

  const R = {};

  // ── 元信息 / SEO ──
  R.meta = await p.evaluate(() => {
    const g = s => { const e = document.querySelector(s); return e ? (e.content || e.href || '') : null; };
    return {
      title: document.title,
      titleLen: document.title.length,
      description: g('meta[name="description"]'),
      descLen: (g('meta[name="description"]') || '').length,
      lang: document.documentElement.lang,
      viewport: g('meta[name="viewport"]'),
      canonical: g('link[rel="canonical"]'),
      ogTitle: g('meta[property="og:title"]'),
      ogDescription: g('meta[property="og:description"]'),
      ogImage: g('meta[property="og:image"]'),
      twitterCard: g('meta[name="twitter:card"]'),
      robots: g('meta[name="robots"]'),
      themeColor: g('meta[name="theme-color"]'),
      hasJsonLd: !!document.querySelector('script[type="application/ld+json"]'),
      favicon: (document.querySelector('link[rel="icon"]') || {}).href || null
    };
  });

  // ── 标题层级 ──
  R.headings = await p.evaluate(() =>
    [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => h.tagName + ' | ' + h.textContent.trim().replace(/\s+/g, ' ').slice(0, 24)));
  R.h1Count = await p.evaluate(() => document.querySelectorAll('h1').length);

  // ── 链接审计 ──
  R.links = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('a[href]').forEach(a => {
      out.push({ href: a.getAttribute('href'), text: a.textContent.trim().replace(/\s+/g, ' ').slice(0, 22) });
    });
    return out;
  });
  R.brokenAnchors = await p.evaluate(() => {
    const bad = [];
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      const id = a.getAttribute('href');
      if (id === '#') return;
      if (!document.getElementById(id.slice(1))) bad.push(id);
    });
    return bad;
  });

  // ── 可访问性基础项 ──
  R.a11y = await p.evaluate(() => {
    const imgsNoAlt = [...document.querySelectorAll('img')].filter(i => !i.hasAttribute('alt')).length;
    const iframesNoTitle = [...document.querySelectorAll('iframe')].filter(f => !f.title).length;
    const btnsNoName = [...document.querySelectorAll('button')].filter(b => !b.textContent.trim() && !b.getAttribute('aria-label')).length;
    const inputsNoLabel = [...document.querySelectorAll('input')].filter(i =>
      !i.getAttribute('aria-label') && !document.querySelector(`label[for="${i.id}"]`)).length;
    const emptyLinks = [...document.querySelectorAll('a')].filter(a => !a.textContent.trim() && !a.getAttribute('aria-label')).length;
    return { imgsNoAlt, iframesNoTitle, btnsNoName, inputsNoLabel, emptyLinks,
             mainCount: document.querySelectorAll('main').length,
             navLabel: !!document.querySelector('nav[aria-label]') };
  });

  // ── 无 JS 降级（爬虫/禁用脚本时看到什么）──
  const p2 = await b.newPage({ javaScriptEnabled: false });
  await p2.goto(BASE, { waitUntil: 'load' });
  R.noJs = await p2.evaluate(() => ({
    bodyTextLen: document.body.innerText.replace(/\s+/g, '').length,
    visibleArchiveRows: document.querySelectorAll('#archiveBody .row').length,
    visibleFieldCards: document.querySelectorAll('#fields-wall .field').length,
    textHasPlaceholder: document.body.innerText.includes('29 条'),
    hasNoscriptNotice: document.body.innerText.includes('JavaScript'),
    noscriptNavLinks: [...document.querySelectorAll('noscript a')].map(a => a.getAttribute('href'))
  }));
  await p2.close();

  // ── 移动端 375px 横向溢出 ──
  await p.setViewportSize({ width: 375, height: 800 });
  await p.waitForTimeout(500);
  R.mobile375 = await p.evaluate(() => ({
    hOverflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    menuBtnVisible: getComputedStyle(document.getElementById('menuBtn')).display !== 'none',
    navHidden: !document.getElementById('nav').classList.contains('open')
  }));
  // 菜单开合
  await p.locator('#menuBtn').click();
  await p.waitForTimeout(400);
  R.mobileMenu = await p.evaluate(() => ({
    navOpen: document.getElementById('nav').classList.contains('open'),
    expanded: document.getElementById('menuBtn').getAttribute('aria-expanded'),
    btnText: document.getElementById('menuBtn').textContent
  }));

  // ── 性能 ──
  await p.setViewportSize({ width: 1440, height: 900 });
  R.perf = await p.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource');
    return {
      ttfbMs: Math.round(n.responseStart - n.requestStart),
      domContentLoadedMs: Math.round(n.domContentLoadedEventEnd),
      loadEventMs: Math.round(n.loadEventEnd),
      transferKB: Math.round(res.reduce((s, r) => s + (r.transferSize || 0), 0) / 1024),
      requestCount: res.length + 1,
      externalOrigins: [...new Set(res.map(r => new URL(r.name).origin).filter(o => o !== location.origin))],
      fontsReady: document.fonts.status
    };
  });

  // ── axe-core 自动可访问性审计 ──
  let axeViolations = 'axe-core 注入失败';
  try {
    await p.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });  /* 本地注入，不依赖 cdnjs */
    await p.waitForFunction(() => !!window.axe);
    axeViolations = await p.evaluate(async () => {
      const r = await window.axe.run(document, { resultTypes: ['violations'] });
      return r.violations.map(v => ({
        id: v.id, impact: v.impact, help: v.help,
        nodes: v.nodes.length, target: (v.nodes[0] && v.nodes[0].target || []).join(' ')
      }));
    });
  } catch (e) { axeViolations = 'axe 错误: ' + e.message; }
  R.axe = axeViolations;

  R.consoleMsgs = consoleMsgs;
  R.badResponses = badResponses;
  R.failedReqs = failedReqs;
  R.loadMs = loadMs;

  await b.close();
  console.log(JSON.stringify(R, null, 2));
})();
