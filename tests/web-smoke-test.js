const { chromium } = require('playwright');

/* 断言助手：expected 以 "~" 开头表示包含匹配，其余为严格相等 */
function expectCheck(list, name, actual, expected) {
  const ok = typeof expected === 'string' && expected.startsWith('~')
    ? String(actual).includes(expected.slice(1))
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) list.push(`${name}: expect ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

(async () => {
  const errors = [];
  const httpFails = [];
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  page.on('console', m => {
    if (m.type() !== 'error') return;
    /* 字体 CDN（gstatic 中文分片）连接失败是环境因素，不算站点缺陷 */
    const u = ((m.location() || {}).url) || '';
    if (/fonts\.(gstatic|googleapis)\.com/.test(u)) return;
    errors.push('console: ' + m.text());
  });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('response', r => { if (r.status() >= 400) httpFails.push(r.status() + ' ' + r.url()); });

  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8765/index.html',
    { waitUntil: 'domcontentloaded' });
  /* 字体 CDN（gstatic 中文分片）在境内常挂起，不等 networkidle；
     等挂载清单渲染进 DOM 即可 */
  await page.waitForFunction(() => {
    const m = window.ZP_MOUNT;
    return !!m && document.querySelectorAll('#fields-wall .field').length === m.fields.length;
  }, { timeout: 15000 });

  const r = {};
  // 动态基线：挂载清单是唯一真相
  r.mount = await page.evaluate(() => {
    const m = window.ZP_MOUNT || { fields: [] };
    return { fields: m.fields.length, pages: m.fields.reduce((s, f) => s + f.pages.length, 0) };
  });
  r.fieldCards = await page.locator('#fields-wall .field').count();
  r.pageRows = await page.locator('#pageList .row').count();
  r.groupCount = await page.locator('#pageList .year').count();
  r.brand = await page.locator('header .brand b').textContent();
  r.eyebrow = await page.locator('[data-site="eyebrow"]').textContent();
  r.brandline = await page.locator('[data-site="brandline"]').textContent();
  r.colophonBrand = await page.locator('.colophon [data-site="brand"]').textContent();
  r.colophonSince = await page.locator('.colophon [data-site="since"]').textContent();
  r.githubHref = await page.locator('.foot [data-site-href="github"]').getAttribute('href');
  r.emailHref = await page.locator('.foot [data-site-href="email"]').getAttribute('href');
  r.brandAria = await page.locator('header .brand').getAttribute('aria-label');
  r.h1 = (await page.locator('h1').textContent()).trim();
  r.navLinks = await page.locator('.nav a').count();
  r.title = await page.title();
  r.descLen = await page.evaluate(() => {
    const e = document.querySelector('meta[name="description"]');
    return e ? (e.content || '').length : null;
  });

  // 墙卡与页面列表的领域顺序必须与清单一致
  r.cardOrder = await page.evaluate(() => {
    const m = window.ZP_MOUNT || { fields: [] };
    const expected = m.fields.map(f => f.id).join(',');
    const cards = [...document.querySelectorAll('#fields-wall .field h3')].map(h => h.textContent).join(',');
    const groups = [...document.querySelectorAll('#pageList .year-h .yn')].map(h => h.textContent).join(',');
    return cards === expected && groups === expected;
  });

  // 首行链接必须指向真实挂载页（/领域/页面/）
  r.firstRowHrefOk = await page.evaluate(() => {
    const a = document.querySelector('#pageList .row');
    return !!a && /^\/[^/]+\/.+\/$/.test(a.getAttribute('href'));
  });

  // ── 文案守卫：AI 编造的句子不得再出现 ──
  r.fabricated = await page.evaluate(() => {
    const t = document.body.innerText;
    return ['几本分册', '往目录里丢', '自动长出来', '失败的配色', '没有排期',
            '抄了十遍', '多一册摄影', '一个人的博客']
      .filter(s => t.includes(s));
  });

  // ── 设计体系断言 ──
  r.design = await page.evaluate(() => {
    const cs = s => getComputedStyle(document.querySelector(s));
    return {
      bodyFont: cs('body').fontFamily,
      bodyBg: cs('body').backgroundColor,
      navFont: cs('.nav a').fontFamily,
      h1Weight: cs('h1').fontWeight,
      accentVar: getComputedStyle(document.documentElement).getPropertyValue('--blue').trim(),
      grainOpacity: cs('.grain').opacity,
      fieldBorder: cs('.field').borderTopColor,
      fieldBg: cs('.field').backgroundColor,
      btnFont: cs('.btn--fill').fontFamily,
      secBorder: cs('.sec-h').borderTopColor
    };
  });

  // hover 动效：主按钮 → accent 底色；页面行 → accent-soft 底色
  await page.locator('.intro .btn--fill').hover();
  await page.waitForTimeout(450);
  r.btnHoverBg = await page.locator('.intro .btn--fill').evaluate(el => getComputedStyle(el).backgroundColor);
  await page.locator('#pageList .row').first().hover();
  await page.waitForTimeout(450);
  r.rowHoverBg = await page.locator('#pageList .row').first().evaluate(el => getComputedStyle(el).backgroundColor);

  // 主题切换
  await page.locator('#inkBtn').click();
  r.inkMode = await page.locator('html').getAttribute('data-ink');
  r.inkBtnText = await page.locator('#inkBtn').textContent();
  r.themeColor = await page.locator('#themeColor').getAttribute('content');

  await browser.close();

  const expect = {
    fieldCards: r.mount.fields,
    pageRows: r.mount.pages,
    groupCount: r.mount.fields,
    brand: 'ZeroPhix',
    eyebrow: 'ZeroPhix · 2023 —',
    brandline: 'ZeroPhix',
    colophonBrand: 'ZeroPhix',
    colophonSince: '2023—',
    githubHref: 'https://github.com/zerophix',
    emailHref: 'mailto:zerophix@users.noreply.github.com',
    /* 品牌链接不带 aria-label：可访问名 = 可见文本，避免 label-content-name-mismatch */
    brandAria: null,
    h1: 'ZeroPhix',
    navLinks: 3,
    title: 'ZeroPhix',
    descLen: 0,
    cardOrder: true,
    firstRowHrefOk: true,
    fabricated: [],
    inkMode: 'night',
    inkBtnText: '纸张',
    themeColor: '#15140f'
  };

  // 设计体系断言（~ 前缀 = 包含）
  const designFails = [];
  expectCheck(designFails, 'bodyFont', r.design.bodyFont, '~Noto Serif SC');
  expectCheck(designFails, 'bodyBg', r.design.bodyBg, 'rgb(240, 237, 230)');
  expectCheck(designFails, 'navFont', r.design.navFont, '~JetBrains Mono');
  expectCheck(designFails, 'btnFont', r.design.btnFont, '~JetBrains Mono');
  expectCheck(designFails, 'h1Weight', r.design.h1Weight, '900');
  expectCheck(designFails, 'accentVar', r.design.accentVar, '#27457e');
  expectCheck(designFails, 'grainOpacity', r.design.grainOpacity, '0.05');
  expectCheck(designFails, 'fieldBorder', r.design.fieldBorder, 'rgb(214, 208, 196)');
  expectCheck(designFails, 'fieldBg', r.design.fieldBg, 'rgb(246, 244, 239)');
  expectCheck(designFails, 'secBorder', r.design.secBorder, 'rgb(27, 25, 23)');
  expectCheck(designFails, 'btnHoverBg', r.btnHoverBg, 'rgb(39, 69, 126)');
  expectCheck(designFails, 'rowHoverBg', r.rowHoverBg, 'rgba(39, 69, 126, 0.1)');

  let pass = true;
  console.log('=== 实测 ===');
  for (const [k, v] of Object.entries(r)) console.log(`  ${k} = ${JSON.stringify(v)}`);
  console.log('=== 断言 ===');
  for (const [k, v] of Object.entries(expect)) {
    const ok = JSON.stringify(r[k]) === JSON.stringify(v);
    if (!ok) pass = false;
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${k}: expect ${JSON.stringify(v)}, got ${JSON.stringify(r[k])}`);
  }
  if (designFails.length) {
    pass = false;
    console.log('=== 设计断言失败 ===');
    designFails.forEach(f => console.log('  FAIL ' + f));
  } else {
    console.log(`  PASS designChecks: 12 项全部通过`);
  }

  const isFont = e => /fonts\.(gstatic|googleapis)\.com/.test(e);
  const fatal = [
    ...errors.filter(e => !isFont(e)),
    ...httpFails.filter(u => !isFont(u)).map(u => 'http fail: ' + u)
  ];
  const fontGap = [...errors, ...httpFails].filter(isFont);
  if (fatal.length) { pass = false; console.log('=== 运行时错误 ==='); fatal.forEach(e => console.log('  ' + e)); }
  else console.log('=== 无运行时错误 ===');
  if (fontGap.length) console.log(`=== 已知环境项（字体 CDN，${fontGap.length} 条，不计失败） ===`);
  console.log(pass ? '\nALL PASS' : '\nFAILED');
  process.exit(pass ? 0 : 1);
})();
