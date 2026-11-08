# ZeroPhix 站点 · 项目指令

个人站点，发布为 https://zerophix.github.io/ （GitHub Pages，主分支根目录）。
纯 HTML/CSS/JS；唯一的构建环节是 Eleventy 挂载框架（见下）。无打包器、无运行时框架。

## 目录划分

```
pages/                       ✏️ 内容源：站长写 HTML 的地方
  <领域>/*.html               一个目录 = 一个领域；目录里每个 html = 一个完整独立页面
  _template.njk               起步模板（_ 前缀不发布），cp 后改成完整文档
index.html                   首页模板（结构 + 留白位，不含内容数据）
data.js                      站点事实数据（brand / since / github / email）
app.js                       首页渲染：读 mounted.js → 领域墙 + 分组页面列表
theme.js                     主题切换（全站唯一实现，localStorage zp-ink）
style.css                    全站样式
eleventy.config.js           挂载框架：扫描 / 校验 / 清单 / sitemap / 资源指纹
githooks/pre-commit          提交即挂载（构建 → 校验 → 暂存 → 孤儿下架）

── 以下为生成物，禁止手改（改源会在下次构建覆盖）──
mounted.js                   挂载清单：fields → pages[{t,u,d}]
sitemap.xml                  站点地图
<领域>/<页面>/                 挂载页输出（原样复制的独立页面）
<领域>/<页面>/ 里的附属 css/js/图   同目录源文件一并复制

.nojekyll                    关闭 Jekyll（不可删除，见「部署」）
tests/                       三套 Playwright 测试（见「验证」）
scripts/                   资产与自动化：gen-og.js（分享卡）、auto.js（全自动挂载守护）
```

## 常用命令

```sh
npm install                 # 首次：装依赖 + 自动接上提交钩子
npm run build               # Eleventy 构建（= node_modules/.bin/eleventy）
npm run auto                # 全自动：监听 pages/ → 构建+提交+推送，丢文件即上线
npm run sync                # 单次执行同一条管线（auto 被安全阀暂停时的重试入口）
python3 -m http.server 8765 # 本地预览（npm run auto 会自动把它起起来）
node tests/web-smoke-test.js          # 三套测试之一，其余见下
BASE_URL=https://zerophix.github.io/ node tests/web-smoke-test.js   # 线上模式
```

测试套件（三套，均用系统 Chrome `channel:'chrome'`，无需下载浏览器）：

- `web-smoke`：首页动态基线断言 + 设计 12 项 + **文案守卫**（AI 编造句不得再出现）
- `web-mount`：框架验收 24 项（门禁 / 原样发布 / 收录 / 点开可达 / 孤儿下架 / 清理）
- `web-audit`：质量报告（axe / SEO / 无 JS / 移动端 / 性能），**默认打线上**，`BASE_URL` 切本地

`web-smoke`、`web-mount` 需要本地服务；断言全部动态基线，**加页面不用改测试**。

## 挂载框架规则（Eleventy）

1. 结构：`pages/<领域>/<页面>.html` —— **一个目录一个领域**（目录名 = 领域名，新建用 ASCII）。
2. 页面必须是**完整独立 HTML 文档**：自带 `<html>`、`<title>`、自己的 `<style>`/`<script>`。
   **没有 front matter，不注入任何外壳，原样发布**（输出 `<领域>/<页面>/`，URL 同名目录）。
3. 元数据自动提取：首页标题 = 页面 `<title>`；日期 = 该文件最后一次 git 提交日
   （未跟踪文件回退文件修改时间 → `YYYY.MM.DD`）。
4. 校验（不过就拦提交，报错点名文件）：散装在 `pages/` 根、缺 `<html>`、缺 `<title>`、
   领域目录里没有任何页面。
5. 提交即挂载：pre-commit 跑构建 → 校验 → 暂存 `mounted.js`/`sitemap.xml` 与各领域输出目录
   → 源目录删除时自动下架孤儿输出。**不要用 `--no-verify` 绕过**；新环境先 `npm install`。
6. 全自动（推荐）：`npm run auto` 常驻监听 `pages/` —— 丢文件 → 构建 → 自动提交 →
   自动推送，约 10 秒后线上可见；本地预览也会自动起。
   - 草稿丢 `pages/_drafts/`（`_` 前缀不挂载、**不进 git**，只留本机），改名/移出即上线。
   - 安全阀：仓库有非内容改动（`style.css`/`tests/` 等开发文件）时暂停自动提交、
     构建照常（本地预览保持最新），处理完改动动一次 `pages/` 或跑 `npm run sync` 即恢复。
   - `--no-push` 只到本地提交；`--dry` 只报告将做什么。

## 内容与设计约定

- **文案红线：首页不放表述性散文。** title / meta description / lead / 区块注释 / 关于正文 /
  页脚语等文案位一律**留白**，只保留品牌、结构标签、功能按钮。
  页面上的字只出自站长本人——AI 不得代写内容文案（曾整站编造，已全部清除，冒烟测试有守卫断言）。
- 站点事实（品牌 / 年份 / 链接）= `data.js` 的 `site`；首页计数与列表全部来自 `mounted.js`；
  **加内容 = 往 `pages/<领域>/` 丢文件**，归档、计数、日期全部自动。
- `--ink-3` 与 `--muted` 统一为 `#6f675e`（WCAG 4.5:1 达标色，**勿改回 `#837c73`**）。
- 夜读键是 `localStorage['zp-ink']`（`paper`/`night`），首页与挂载页共享（`theme.js`）。
- 新建文件名用 ASCII；站长已有的中文文件名**不改名**。
- 提交信息走 `<type>(<scope>): <subject>`（英文，主题 ≤72 字符）。
- **不要用 `git add -A`**：曾把草稿误发布；逐个列出本次要提交的路径。

## 验证（完成任何改动前必须跑）

1. 起本地服务（仓库根，8765 端口），跑 `web-smoke` + `web-mount`；`web-audit` 出报告看 axe。
2. 全绿才算完成；测试有断言失败就先修测试或修代码，不许跳过。
3. 涉及发布的行为（挂载 / 删除页面）必跑 `node tests/web-mount-test.js`。

## 部署

- `git push origin main` → Pages 构建（有 `.nojekyll` 后约 5 秒）。
- 资源指纹：构建自动给 `style.css`/`app.js`/`data.js`/`mounted.js`/`theme.js` 的引用加
  `?v=<内容哈希>`（Pages 资源缓存 `max-age=600`，指纹保证部署后 URL 必变、必回源）。
  **不需要手动改版本号**；若访客看到旧样式，是其本地 600 秒缓存，硬刷新一次即可。
- 查构建：`gh api repos/zerophix/zerophix.github.io/pages/builds/latest --jq '.status'`
- 构建卡在 `building` 超过 2 分钟 = 异常，重新触发：
  `gh api repos/zerophix/zerophix.github.io/pages/builds -X POST`
- 上线后抽查：`curl -s -o /dev/null -w '%{http_code}' https://zerophix.github.io/<path>/`
- `.nojekyll` 绝不能删：没有它 GitHub Pages 会跑 Jekyll，正文里的 `{{` 会被当 Liquid
  处理，构建会卡死（历史故障）。

## 项目 Skills（按需加载）

- `@add-page`：挂载一个新页面的完整流程与坑
- `@edit-content`：改 `data.js` 站点信息
- `@site-verify`：本地/线上验证套件的跑法与判读
- `@site-deploy`：推送、Pages 构建监控与排障
