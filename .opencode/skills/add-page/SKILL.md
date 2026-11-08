---
name: 挂载新页面
description: 新页面先分类进 pages/<领域>/ 再提交挂载（首页领域墙/页面列表/sitemap 自动更新）。触发：/挂载、新增页面、加一页、写个新页面、add page、pages 目录、挂载页、新页面进来、页面分类。
---

# 挂载新页面（Eleventy 挂载框架）

## 模型一句话

一个目录一个领域；目录里每个 html = 一个**完整独立页面**（自带样式和脚本），
原样发布、点开即它自己——不注入任何外壳，没有 front matter。

## 流程

0. **新页面常直接落在 `pages/` 根目录（未分类）——先分类，再提交**（标准工作流）：
   - 读 `<title>` 和 `meta description` 判断领域，`mv` 进对应目录；
   - 归类原则：**优先复用已有领域**、同模式归同领域——「XX · 项目全景」→ `projects/`、
     漫画制作 → `manga/`、物理笔记 → `physics/`、动画 → `animation/`…；
     确是全新主题才建 ASCII 新目录；
   - **拿不准就问站长，别猜着放**；
   - 未分类的散装文件会被门禁拦（构建失败），`npm run auto` 在分类完成前不会提交——这是设计行为；
   - `mv` 本身就是 pages/ 变更：开着 auto 时 mv 即触发 构建→提交→推送，没开则手动 `npm run sync`。
1. 起步（可选）：复制模板后改成完整文档，或直接手写完整 HTML。
   ```sh
   cp pages/_template.njk pages/<领域>/<页面名>.html
   ```
2. 页面要求（缺一即被门禁拦下，报错点名文件）：
   - 完整 `<html>` 文档；必须有 `<title>`（title = 首页列表里显示的标题）
   - **不写 front matter、不写片段**——文件本身就是页面
   - 必须放在领域目录里：`pages/<领域>/…`（散装在 `pages/` 根会被拦）
   - 同目录可放 css/js/图片，相对路径引用即可，构建会一并复制发布
   - 领域目录名 = 首页卡片名（新建用 ASCII，如 `physics`、`leetcode`）
3. 提交即挂载。**推荐直接开 `npm run auto`**：丢文件后构建/提交/推送全自动，
   下面是手动方式——pre-commit 自动：构建 → 校验（不过就中止提交）→ 生成并暂存
   `mounted.js` + `sitemap.xml` + 输出目录。
   ```sh
   git add pages/<领域>/ && git commit -m "chore(content): mount <页面名>"
   ```
4. 发布地址：`https://zerophix.github.io/<领域>/<页面名>/`

## 删除页面

删掉源文件（或整个领域目录）再提交，构建时自动下架孤儿输出并暂存删除
（**不要手删输出目录**，源在输出就在）。

## 提交被拦截时

读钩子报错，常见四类：散装在 pages/ 根、缺 `<html>`、缺 `<title>`、领域目录里没有页面。
散装文件 → 走第0 步先分类；其余修文件后重试；**不要 `--no-verify`**。

## 验证

```sh
python3 -m http.server 8765 &                    # 仓库根
node tests/web-mount-test.js                     # 框架级：门禁/原样/收录/孤儿 24 项
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8765/<领域>/<页面名>/
```

线上发布后：
```sh
curl -s -o /dev/null -w '%{http_code}' https://zerophix.github.io/<领域>/<页面名>/
curl -s https://zerophix.github.io/sitemap.xml | grep -c '<loc>'
```

## 连带影响

- 首页领域卡与页面行自动 +1；标题、日期自动提取，**测试用动态基线，无需改断言**。
- 首页文案位保持留白（红线，见 AGENTS.md）：不要往 `index.html` 加介绍性散文。

## 集成文件

- 源：`pages/<领域>/*.html` ｜ 框架与校验：`eleventy.config.js`
- 清单：`mounted.js` ｜ 渲染：`app.js` ｜ 钩子：`githooks/pre-commit`
