/* ============================================================
   挂载框架 · Eleventy 配置（2026-11 模型）
   ------------------------------------------------------------
   pages/<领域>/*.html —— 每个子目录 = 一个领域（册），
   目录里每个 HTML = 完整独立页面（自带 style/script），**原样发布**：
     · 不注入任何外壳，不改一行内容
     · 输出到 <领域>/<页面>/，URL: /<领域>/<页面>/
     · 同目录的 css/js/图片等附属文件一并复制
   首页数据：generated mounted.js（领域分组 + 标题 + 日期）
     · 标题取页面 <title>
     · 日期取该文件最后一次 git 提交日期（新文件回退文件时间）
   提交时 githooks/pre-commit 自动构建；校验失败拦住提交。
   ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const PAGES = path.join(__dirname, 'pages');
const REMOVED_LOG = path.join(__dirname, '.cache', 'removed-outputs');

/* 本轮扫描结果：[{ id: 领域目录, pages: [{ t, u, d }] }] */
let mountedFields = [];

/* ── 工具 ───────────────────────────────────── */

/* 文件的展示日期：优先 git 最后提交日，回退文件修改时间 → YYYY.MM.DD */
function gitDates() {
  try {
    const out = execSync('git log --name-only "--pretty=format:-- %cs" -- pages',
      { cwd: __dirname, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const map = {};
    let cur = null;
    out.split('\n').forEach(line => {
      if (line.startsWith('-- ')) { cur = line.slice(3).trim(); return; }
      const p = line.trim();
      if (cur && p.startsWith('pages/') && !(p in map)) map[p] = cur;
    });
    return map;
  } catch (e) { return {}; }
}

function dateOf(rel, dates) {
  const key = 'pages/' + rel;
  if (dates[key]) return dates[key].replace(/-/g, '.');
  const st = fs.statSync(path.join(PAGES, rel));
  const d = st.mtime;
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

function extractTitle(src) {
  const m = src.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1].trim() : '';
}

/* 列出 pages/ 下所有领域目录（跳过 _ 开头） */
function fieldDirs() {
  if (!fs.existsSync(PAGES)) return [];
  return fs.readdirSync(PAGES, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('_'))
    .map(e => e.name).sort();
}

/* ── 配置 ───────────────────────────────────── */

module.exports = function (eleventyConfig) {

  /* _ 前缀 = 草稿：清单扫描跳过，Eleventy 也不处理、不输出（否则草稿会被发布） */
  if (fs.existsSync(PAGES)) {
    fs.readdirSync(PAGES, { withFileTypes: true })
      .filter(e => e.name.startsWith('_'))
      .forEach(e => {
        eleventyConfig.ignores.add(path.join('pages', e.name));
        eleventyConfig.ignores.add(path.join('pages', e.name, '**'));
      });
  }

  /* ── 构建前：孤儿下架 + 扫描校验 + 收集清单 ── */
  eleventyConfig.on('eleventy.before', () => {
    mountedFields = [];

    /* 1) 孤儿下架：旧清单里有、但 pages/<领域> 源已删除的输出目录 */
    const removed = [];
    const mfPath = path.join(__dirname, 'mounted.js');
    if (fs.existsSync(mfPath)) {
      try {
        global.window = global.window || {};
        delete require.cache[require.resolve(mfPath)];
        require(mfPath);
        const old = global.window.ZP_MOUNT || {};
        const dirs = new Set();
        (old.fields || []).forEach(f => f.id && dirs.add(f.id));
        (old.pages || []).forEach(p => {           // 兼容旧扁平清单
          if (p.u) dirs.add(p.u.split('/').filter(Boolean)[0]);
        });
        dirs.forEach(d => {
          if (d && !fs.existsSync(path.join(PAGES, d)) && fs.existsSync(path.join(__dirname, d))) {
            fs.rmSync(path.join(__dirname, d), { recursive: true, force: true });
            removed.push(d);
          }
        });
      } catch (e) { /* 旧清单损坏则跳过 */ }
    }
    if (removed.length) {
      fs.mkdirSync(path.dirname(REMOVED_LOG), { recursive: true });
      fs.appendFileSync(REMOVED_LOG, removed.join('\n') + '\n');
    }

    /* 2) 扫描 pages/<领域>/*.html 并校验 */
    const dates = gitDates();
    const errors = [];
    const byField = {};

    const scan = dirRel => {
      const abs = path.join(PAGES, dirRel);
      fs.readdirSync(abs, { withFileTypes: true }).forEach(e => {
        if (e.name.startsWith('_')) return;
        const rel = dirRel ? dirRel + '/' + e.name : e.name;
        if (e.isDirectory()) return scan(rel);          // 领域下不再嵌套领域，但容忍子目录
        if (!e.name.endsWith('.html')) return;          // css/js 等附属文件另行复制

        const src = fs.readFileSync(path.join(PAGES, rel), 'utf8');
        const field = rel.split('/')[0];
        const slug = path.basename(rel, '.html');
        const where = 'pages/' + rel;

        if (!dirRel) {
          errors.push(`${where} 没有放在领域目录里 —— 结构应为 pages/<领域>/<页面>.html`);
          return;
        }
        if (!/<html[\s>]/i.test(src))
          errors.push(`${where} 不是完整 HTML 文档（缺 <html>）——这里放完整的独立页面，不要片段`);
        const title = extractTitle(src);
        if (!title) errors.push(`${where} 缺 <title>——首页列表用它当标题`);

        (byField[field] = byField[field] || []).push({
          t: title || slug,
          u: `/${field}/${slug}/`,
          d: dateOf(rel, dates),
          _sort: rel
        });
      });
    };
    scan('');

    /* 3) 空领域目录（只有附属文件、没有页面）也算错 */
    fieldDirs().forEach(f => { if (!byField[f]) errors.push(`pages/${f}/ 里没有任何 .html 页面`); });

    if (errors.length)
      throw new Error('挂载校验失败：\n  - ' + errors.join('\n  - '));

    /* 4) 组装：领域按名字、页面按日期倒序 */
    mountedFields = Object.keys(byField).sort().map(id => ({
      id,
      pages: byField[id].sort((a, b) => b.d.localeCompare(a.d) || a._sort.localeCompare(b._sort))
        .map(({ t, u, d }) => ({ t, u, d }))
    }));
  });

  /* ── 构建后：复制附属文件 + 写清单/站点地图 + 资源指纹 ── */
  eleventyConfig.on('eleventy.after', () => {
    /* 附属文件：领域目录里的 css/js/图片等（非 html、非 _ 开头）原样复制到输出 */
    fieldDirs().forEach(f => {
      const src = path.join(PAGES, f);
      const dest = path.join(__dirname, f);
      const files = fs.readdirSync(src, { withFileTypes: true });
      files.forEach(e => {
        if (e.name.startsWith('_') || e.name.endsWith('.html')) return;
        const from = path.join(src, e.name);
        const to = path.join(dest, e.name);
        if (e.isDirectory()) fs.cpSync(from, to, { recursive: true });
        else { fs.mkdirSync(dest, { recursive: true }); fs.copyFileSync(from, to); }
      });
    });

    /* 首页清单 */
    fs.writeFileSync(
      path.join(__dirname, 'mounted.js'),
      '/* GENERATED by Eleventy — 由 pages/<领域>/*.html 生成，勿手改 */\n' +
      'window.ZP_MOUNT = ' + JSON.stringify({ fields: mountedFields }, null, 2) + ';\n'
    );

    /* 站点地图：首页 + 所有挂载页 */
    const urls = ['/', ...mountedFields.flatMap(f => f.pages.map(p => p.u))];
    const today = new Date().toISOString().slice(0, 10);
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map(u =>
        '  <url>\n' +
        `    <loc>https://zerophix.github.io${u}</loc>\n` +
        `    <lastmod>${today}</lastmod>\n` +
        '  </url>'
      ).join('\n') + '\n</urlset>\n';
    fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), xml);

    stampAssets();
  });

  return {
    dir: { input: 'pages', output: '.' },
    /* 关键：HTML 不做模板渲染 —— front matter 照常剥离（本无），正文原样输出 */
    htmlTemplateEngine: false,
    templateFormats: ['html']
  };
};

/* ============================================================
   资源指纹：给 style.css/app.js/data.js/mounted.js/theme.js 的引用
   加 ?v=<内容哈希>。GitHub Pages 资源缓存 max-age=600，内容哈希让
   部署后的 URL 必变、必回源，避免「新 HTML + 旧缓存 CSS/JS」错乱。
   （幂等：内容不变则哈希不变、文件不动）
   ============================================================ */
function stampAssets() {
  /* 被安全阀拦下的构建（工作区有未完成改动）不重写指纹：
     否则会用脏文件的哈希污染 index.html 的 ?v= 引用 */
  if (process.env.MOUNT_NO_STAMP) return;
  const assets = ['style.css', 'app.js', 'data.js', 'mounted.js', 'theme.js'];
  const hashes = {};
  assets.forEach(a => {
    const fp = path.join(__dirname, a);
    if (!fs.existsSync(fp)) return;
    hashes[a] = crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex').slice(0, 8);
  });
  ['index.html'].forEach(t => {
    const fp = path.join(__dirname, t);
    if (!fs.existsSync(fp)) return;
    let s = fs.readFileSync(fp, 'utf8');
    const orig = s;
    assets.forEach(a => {
      if (!hashes[a]) return;
      const esc = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      s = s.replace(
        new RegExp('(href|src)="((?:\\.\\./|\\/)?' + esc + ')(\\?v=[0-9a-f]*)?"', 'g'),
        (m, attr, ref) => `${attr}="${ref}?v=${hashes[a]}"`
      );
    });
    if (s !== orig) fs.writeFileSync(fp, s);
  });
}
