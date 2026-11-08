/* ============================================================
   ZeroPhix · 行为层
   数据源：
     data.js    → window.ZP.site（品牌/年份/链接等事实数据）
     mounted.js → window.ZP_MOUNT.fields（pages/<领域>/*.html 扫描结果）
   模板 index.html 不含内容数据。
   ============================================================ */
(function(){
"use strict";

var ZP    = window.ZP || {};
var SITE  = ZP.site  || {};
var MOUNT = (window.ZP_MOUNT && window.ZP_MOUNT.fields) || [];

/* ─── helpers ─── */
function esc(s){
  return String(s).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function $(id){ return document.getElementById(id); }
var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ═══════════════════════════════════════════════
   站点信息填充：data.js 的值灌进带 data-site 的占位元素。
   模板里写了默认文案，data.js 缺项时不覆盖。
   ═══════════════════════════════════════════════ */
function fillSite(){
  var id = [SITE.brand, SITE.tagline].filter(Boolean).join(' · ');
  var txt = {
    brand:     SITE.brand || null,
    eyebrow:   id ? id + (SITE.since ? ' · ' + SITE.since + ' —' : '') : null,
    brandline: id || null,
    since:     SITE.since ? SITE.since + '—' : null
  };
  Array.prototype.forEach.call(document.querySelectorAll('[data-site]'), function(el){
    var v = txt[el.getAttribute('data-site')];
    if (v == null || v === '') return;
    el.textContent = v;
  });

  var href = {
    github: SITE.github,
    email: SITE.email
      ? (/^mailto:/i.test(SITE.email) ? SITE.email : 'mailto:' + SITE.email)
      : null
  };
  Array.prototype.forEach.call(document.querySelectorAll('[data-site-href]'), function(el){
    var v = href[el.getAttribute('data-site-href')];
    if (v) el.setAttribute('href', v);
  });
}

/* 主题切换在 theme.js（全站共享 zp-ink） */

/* ───────── 菜单 ───────── */
var menuBtn = $('menuBtn'), nav = $('nav');
menuBtn.addEventListener('click', function(){
  var open = nav.classList.toggle('open');
  menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  menuBtn.textContent = open ? '关闭' : '菜单';
});
nav.addEventListener('click', function(e){
  if (e.target.closest('a')){
    nav.classList.remove('open');
    menuBtn.setAttribute('aria-expanded','false');
    menuBtn.textContent = '菜单';
  }
});

/* ───────── 领域墙：pages/ 下每个目录一张卡 ───────── */
function buildWall(){
  var el = $('fields-wall'); if (!el) return;
  if (!MOUNT.length){
    el.innerHTML = '<p class="empty">暂无</p>';
    return;
  }
  el.innerHTML = MOUNT.map(function(f, i){
    var n = f.pages.length;
    var latest = n ? f.pages[0].d : '';   /* 清单内按日期倒序，首条即最近 */
    return '<article class="field" data-reveal style="--d:' + ((i % 4) * 90) + 'ms">' +
      '<div class="spine"><span>' + String(i + 1).padStart(2, '0') + '</span></div>' +
      '<div class="fbody">' +
        '<div class="fhead"><h3>' + esc(f.id) + '</h3>' +
          '<span class="en">' + n + ' 页</span></div>' +
        (latest ? '<div class="fstat">最近 ' + esc(latest) + '</div>' : '') +
      '</div>' +
    '</article>';
  }).join('');
}

/* ───────── 全部页面：按领域分组，点开即独立页 ───────── */
function buildPageList(){
  var el = $('pageList'); if (!el) return;
  var total = MOUNT.reduce(function(s, f){ return s + f.pages.length; }, 0);
  if (!total){
    el.innerHTML = '<p class="empty">暂无</p>';
    return;
  }
  el.innerHTML = MOUNT.map(function(f){
    var rows = f.pages.map(function(p){
      return '<li><a class="row" href="' + esc(p.u) + '">' +
        '<span class="when"><b>' + esc(p.d) + '</b></span>' +
        '<span class="rmain"><b>' + esc(p.t) + '</b></span>' +
        '<span class="rtags"><span class="tag">' + esc(f.id) + '</span></span>' +
        '<span class="go">打开<i>→</i></span>' +
      '</a></li>';
    }).join('');
    return '<section class="year" id="pg-' + esc(f.id) + '">' +
      '<div class="year-h"><span class="yn">' + esc(f.id) + '</span>' +
        '<span class="yc">' + f.pages.length + ' 页</span></div>' +
      '<ul class="index">' + rows + '</ul>' +
    '</section>';
  }).join('');
}

/* ───────── 揭幕 ───────── */
function reveal(){
  var els = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));
  if (!('IntersectionObserver' in window) || reduce){
    els.forEach(function(el){ el.classList.add('in'); });
    return;
  }
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold:.12, rootMargin:'0px 0px -5% 0px' });
  els.forEach(function(el){ io.observe(el); });
}

/* ───────── 滚动 ───────── */
var progress = $('progress');
var navLinks = Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]'));
var sections = navLinks.map(function(a){
  return document.getElementById(a.getAttribute('href').slice(1));
}).filter(Boolean);
var ticking = false;
function onScroll(){
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(function(){
    var y = window.pageYOffset || document.documentElement.scrollTop;
    var h = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = (h > 0 ? (y / h) * 100 : 0) + '%';
    var active = 0;
    sections.forEach(function(sec, i){
      if (sec.getBoundingClientRect().top <= 130) active = i;
    });
    navLinks.forEach(function(a, i){ a.classList.toggle('active', i === active); });
    ticking = false;
  });
}
window.addEventListener('scroll', onScroll, { passive:true });
window.addEventListener('resize', onScroll);

/* ───────── 启动 ───────── */
fillSite();
buildWall();
buildPageList();
reveal();
onScroll();

})();
