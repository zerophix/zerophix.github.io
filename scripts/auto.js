#!/usr/bin/env node
/* ============================================================
   全自动挂载守护：pages/ 丢文件 → 构建 → 提交 → 推送 → 上线

   用法：
     node scripts/auto.js            常驻监听（构建 + 提交 + 推送，全自动）
     node scripts/auto.js --once     单次执行（同一条管线，跑完退出）
     node scripts/auto.js --no-push  只到本地提交，不推送
     node scripts/auto.js --dry      演练：只报告将发生什么，不提交

   约定：
     · 草稿保护 —— pages/ 下 _ 开头的目录或文件不挂载（如 pages/_drafts/），
       也不进 git（.gitignore，只留本机）；改名/移出 _ 前缀即自动挂载上线。
     · 安全阀   —— 仓库存在非内容改动（style.css/app.js/tests 等开发文件）
       时暂停自动提交，防止把未完成的开发工作卷进内容提交；
       构建照常执行（本地预览保持最新），处理完改动后动一次 pages/ 即恢复。
   ============================================================ */
'use strict';
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = path.resolve(__dirname, '..');
const PAGES = path.join(ROOT, 'pages');
const PREVIEW_PORT = 8765;
const ELEVENTY = path.join(ROOT, 'node_modules', '.bin', 'eleventy');

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('用法: node scripts/auto.js [--once] [--no-push] [--dry]');
  process.exit(0);
}
const OPT = {
  once: args.includes('--once'),
  noPush: args.includes('--no-push'),
  dry: args.includes('--dry'),
};

/* ── 工具 ───────────────────────────────────── */
const log = msg => console.log(`[auto ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${msg}`);

function git(argv) {
  const r = spawnSync('git', argv, { cwd: ROOT, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}

/* 工作区脏路径（porcelain v1；还原 git 的引号/转义路径） */
function dirtyPaths() {
  const r = git(['status', '--porcelain']);
  return r.out.split('\n').filter(Boolean).map(line => {
    let p = line.slice(3);
    if (p.startsWith('"') && p.endsWith('"')) {
      p = p.slice(1, -1).replace(/\\([nrt\\"])/g,
        (_, c) => ({ n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"' }[c]));
    }
    if (p.includes(' -> ')) p = p.split(' -> ')[1];   /* rename */
    return p;
  }).filter(Boolean);
}

/* 开发文件黑名单：这些改动绝不允许被自动提交卷走 */
const DENY = [
  /^style\.css$/, /^app\.js$/, /^data\.js$/, /^theme\.js$/, /^index\.html$/,
  /^eleventy\.config\.js$/, /^package(-lock)?\.json$/, /^AGENTS\.md$/, /^\.gitignore$/,
  /^scripts\//, /^tests\//, /^githooks\//, /^\.opencode\//,
  /^[^/]+\.html$/,              /* 根目录散装 html（非挂载输出） */
  /^robots\.txt$/, /^og\.png$/,
];
const isContentPath = p => !DENY.some(re => re.test(p));

/* ── 构建 ───────────────────────────────────── */
function build(noStamp) {
  if (!fs.existsSync(ELEVENTY)) {
    return { ok: false, out: '找不到 node_modules/.bin/eleventy —— 先运行 npm install' };
  }
  const env = { ...process.env };
  if (noStamp) env.MOUNT_NO_STAMP = '1';   /* 拦截态构建：不重写资源指纹 */
  const r = spawnSync(ELEVENTY, [], { cwd: ROOT, encoding: 'utf8', env });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}

/* ── 本地预览（没起就起） ───────────────────── */
function ensurePreview() {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once('error', () => {
      log(`预览已在运行 → http://127.0.0.1:${PREVIEW_PORT}/`);
      resolve();
    });
    probe.once('listening', () => probe.close(() => {
      const child = spawn('python3', ['-m', 'http.server', String(PREVIEW_PORT)], {
        cwd: ROOT, detached: true, stdio: 'ignore',
      });
      child.unref();
      log(`预览已启动 → http://127.0.0.1:${PREVIEW_PORT}/`);
      resolve();
    }));
    probe.listen(PREVIEW_PORT);
  });
}

function fail(stage, out) {
  log(`✖ 失败于 ${stage}：`);
  console.log(String(out || '').trim());
  return { ok: false, stage };
}

function doPush() {
  let push = git(['push', 'origin', 'main']);
  if (!push.ok && /non-fast-forward|rejected/i.test(push.out)) {
    log('远端有新提交 → pull --rebase 后重推');
    const re = git(['pull', '--rebase', '--autostash', 'origin', 'main']);
    if (!re.ok) { git(['rebase', '--abort']); return fail('pull', re.out); }
    push = git(['push', 'origin', 'main']);
  }
  if (!push.ok) return fail('push', push.out);
  log('已推送 → GitHub Pages 约 10 秒后上线');
  return { ok: true };
}

/* ── 提交 + 推送 ────────────────────────────── */
function commitAndPush() {
  /* 只暂存内容源 pages/；构建产物（输出目录、mounted.js、sitemap、
     index.html 指纹）由 pre-commit 钩子按规则暂存 */
  const add = git(['add', 'pages']);
  if (!add.ok) return fail('add', add.out);

  const staged = git(['diff', '--cached', '--name-status'])
    .out.split('\n').filter(Boolean);
  if (!staged.length) {
    log('无内容变化，跳过提交');
    /* 补推：本地有未推送提交时（例如上次 push 网络失败），
       npm run sync 就是重试入口 */
    const ahead = git(['rev-list', '--count', '@{u}..HEAD']);
    const n = parseInt(ahead.out.trim(), 10);
    if (ahead.ok && n > 0) {
      if (OPT.noPush || OPT.dry) log(`本地领先 ${n} 个提交，未推送`);
      else { log(`本地领先 ${n} 个提交 → 补推`); return doPush(); }
    }
    return { ok: true, skipped: true };
  }

  /* 提交信息：优先取 pages/ 源路径 */
  const paths = staged.map(l => l.split('\t').pop() || '');
  const src = paths.find(p => p.startsWith('pages/'));
  const hasAdd = staged.some(l => /^[AM]/.test(l));
  const hasDel = staged.some(l => /^D/.test(l));
  /* pages/ 下任何 _ 开头的路径段 = 草稿（与扫描器的跳过规则一致） */
  const isDraft = !!src && /(^|\/)_/.test(src.slice('pages/'.length));
  const verb = isDraft ? 'draft' : (hasAdd ? 'mount' : (hasDel ? 'unmount' : 'sync'));
  let subject;
  if (src) {
    subject = `chore(content): ${verb} ${src.slice('pages/'.length)}`;
    if (staged.length > 1) subject += ` (+${staged.length - 1})`;
    if (subject.length > 72) subject = subject.slice(0, 69) + '...';
  } else {
    subject = 'chore(content): sync mount manifest';
  }

  const commit = git(['commit', '-m', subject]);
  if (!commit.ok) return fail('commit', commit.out);
  const sha = git(['rev-parse', '--short', 'HEAD']).out.trim();
  log(`已提交 ${sha} ${subject}`);

  if (OPT.noPush) { log('--no-push：跳过推送'); return { ok: true, sha }; }
  const r = doPush();
  return r.ok ? { ok: true, sha } : r;
}

/* ── 一次完整周期 ───────────────────────────── */
function cycle(reason) {
  log(`触发：${reason}`);

  const blocked = dirtyPaths().filter(p => !isContentPath(p));
  if (blocked.length) {
    const b = build(true);            /* 拦截态：构建但不重写指纹，防止污染 index.html */
    log(b.ok ? '构建 ✓（本地预览已更新）' : '构建失败（详见上方11ty输出）');
    log(`⚠ 暂停自动提交——存在非内容改动：${blocked.join('、')}`);
    log('  处理掉这些改动后，再动一次 pages/ 或运行 npm run sync 即恢复');
    return { ok: false, blocked };
  }

  const b = build();
  if (!b.ok) {
    log('构建失败（校验未过），不提交。错误：');
    const lines = b.out.split('\n');
    const key = lines.filter(l => /挂载校验|pages\//.test(l));
    console.log((key.length ? key : lines.slice(-12)).join('\n'));
    return { ok: false, buildFailed: true };
  }
  log('构建 ✓');

  if (OPT.dry) {
    const pending = dirtyPaths().filter(isContentPath);
    log(`--dry：${pending.length ? '将提交 → ' + pending.join('、') : '无内容变化'}`);
    return { ok: true, dry: true };
  }
  return commitAndPush();
}

/* ── 常驻监听 ───────────────────────────────── */
function startWatch() {
  if (!fs.existsSync(PAGES)) { log('pages/ 不存在，无法监听'); return; }

  let timer = null, running = false, queued = false;
  const trigger = reason => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (running) { queued = true; return; }
      running = true;
      try { cycle(reason); } catch (e) { log('异常：' + (e.stack || e.message)); }
      running = false;
      if (queued) { queued = false; trigger('排队的后续变化'); }
    }, 800);                       /* 防抖：批量落盘合成一次提交 */
  };

  fs.watch(PAGES, { recursive: true }, (event, file) => {
    trigger(`${event} ${file || ''}`.trim());
  });

  log(`监听中：${PAGES}`);
  log('丢文件即挂载；_ 前缀 = 草稿不挂载；Ctrl+C 退出');
}

/* ── 入口 ───────────────────────────────────── */
(async () => {
  await ensurePreview();
  const first = cycle('启动扫描');
  if (OPT.once) process.exit(first.ok ? 0 : 1);
  if (first.blocked) log('（安全阀生效中，监听继续——改动处理后会自动恢复）');
  startWatch();
})();
