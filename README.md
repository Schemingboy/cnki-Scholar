# cnki-batch-download

知网（CNKI）批量下载扩展。在检索结果页勾选文献后按可控间隔逐篇下载 PDF，顺带给期刊名标注分区和影响因子、鼠标悬停看摘要。

本项目基于 [fenqijun/cnki-Scholar](https://github.com/fenqijun/cnki-Scholar) 改造，核心目标是「点了下载就真的能下」，所有花哨能力都退到辅助位置。

---

## 设计原则

这个分支上游最大的分歧在于：**不用扩展接管知网的文件下载**。

扩展只负责一件事——从文献详情页里找出 PDF 直链，然后用 `window.open()` 交回浏览器和知网页面的原生下载流程。因为一旦用 `chrome.downloads.download()` 接管，知网的鉴权和跳转链路就容易断，表现为「显示下载成功、实际是一个 HTML 错误页」。

明确不做的事：

| 不做 | 原因 |
|---|---|
| `chrome.downloads.download()` 下载论文 | 绕开知网原生鉴权，易下到错误页 |
| `chrome.downloads.onDeterminingFilename` 自动改名 | 干扰下载核心链路 |
| 绕过验证码 / 人机验证 | 触发验证就交给人处理 |
| 提速、并发、压测 | 保留下载间隔，避免账号风险 |
| 写入任意绝对路径 | 扩展没有这个权限，见下方「保存目录」 |

---

## 功能

**单篇下载** — 每个文献标题旁插入「下载」按钮。区分期刊论文（取 `#pdfDown`）和学位论文（取 `.btn-dlpdf`），只接受 `http`/`https` 的 PDF 链接，不下 CAJ。

**摘要悬停** — 鼠标停在标题上，异步拉取并浮出摘要。

**期刊标签** — 在来源期刊旁标注中科院分区、JCR/WJCI 分区、北大核心、EI、SCI、CSSCI、TOP、影响因子，按等级配色。数据来自 Gitee 上的 `cnki-journals` 数据集，取不到时回落到内置的少量默认数据。

**关键词标签** — 详情页关键词转成彩色可点击标签。

**批量下载面板** — 勾选当前页文献后逐篇触发下载。

- 间隔默认 8 秒，最小 6 秒，**暂停后可以改间隔再继续**
- 状态如实写成「已触发」，不谎报「已下载成功」
- 遇到验证页时把当前条目标为需人工处理，流程继续往后走，不停在原地重试

**核查按钮** — 只读浏览器的下载记录，比对勾选文献是否已经有对应 PDF 落盘。纯只读，不接管下载、不改名。

---

## 关于保存目录

浏览器扩展**不能**把文件写到任意绝对路径，只能给出「下载根目录下的相对路径」。所以本分支的做法是：

> **把浏览器的默认下载目录直接设成你的目标文件夹**（例如 `H:\CNKI`），并关闭「下载前询问每个文件的保存位置」。

面板里那个「保存到 下载目录/」输入框在本分支属于**遗留字段**：它只用于「核查」时推算预期文件名，不再决定文件实际落点。别指望填 `CNKI` 就会自动建子目录。

---

## 安装

1. 浏览器地址栏进扩展管理页
   - Chrome：`chrome://extensions/`
   - Edge：`edge://extensions/`
   - 星愿：菜单 → 扩展
2. 打开右上角「开发者模式」
3. 点「加载已解压的扩展程序」，选中本项目文件夹
4. 进浏览器下载设置，把默认下载位置设成目标文件夹，并**关闭「下载前询问每个文件的保存位置」**
5. 打开知网检索结果页，刷新，确认出现「下载」和「批量下载」按钮

改完代码后必须回扩展管理页点一次**重新加载**，再刷新知网页面。

---

## AI Agent 一键部署

把下面整段贴给 Claude Code / Codex 之类的编码 agent，它会自己完成克隆、校验、同步到浏览器加载目录，并打印后续要你手动点的几步。

```
帮我部署 cnki-batch-download 知网批量下载扩展，按以下步骤执行，每步给出验证证据：

1. 克隆仓库到 <目标目录>：
   git clone https://github.com/Schemingboy/cnki-batch-download.git
   若目录已存在则 git pull --ff-only，并先 git status 确认工作区干净。

2. 静态校验（三个都必须通过，失败就停下报错，不要继续）：
   node --check content.js
   node --check background.js
   node --check download-worker.js
   node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"

3. 用 stat/ls 核对 manifest.json、content.js、background.js、content.css 四个文件确实存在且非空，
   打印 git rev-parse --short HEAD 作为版本证据。

4. 如果我已有一份浏览器正在加载的副本目录，把上面校验通过的文件同步过去，
   同步后用 diff 逐个文件核对两边一致（不要只看命令返回码）。

5. 最后打印我需要手动做的步骤清单：
   - 扩展管理页开启开发者模式 → 加载已解压的扩展程序 → 选择该目录
   - 浏览器默认下载目录设为目标文件夹，关闭「下载前询问每个文件的保存位置」
   - 扩展管理页点「重新加载」，刷新知网页面确认按钮出现

约束：不要修改任何业务逻辑，不要引入 chrome.downloads.download 下载论文，
不要提交或推送代码。只做部署和校验。
```

想手动跑校验的话，等价命令是：

```powershell
node --check content.js
node --check background.js
node --check download-worker.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
```

---

## 项目结构

```
manifest.json         MV3 清单，权限 storage/downloads/scripting/activeTab
content.js            主体：按钮注入、摘要、期刊标签、批量面板
background.js         Service Worker：跨域取期刊数据、读下载记录做核查
content.css           按钮、标签、批量面板样式
cnki_journals.json    期刊数据快照（约 3.2 万条，未被代码引用，见下）
download-worker.js    早期批量下载的 Web Worker（当前未被引用）
icon.png             图标文件（manifest 未声明 icons，当前不生效）
```

---

## 已知问题

**初始化依赖 `DOMContentLoaded`** — `content.js` 末尾的初始化挂在 `document.addEventListener('DOMContentLoaded', ...)` 上，而 manifest 没有声明 `run_at`，默认 `document_idle` 通常在 `DOMContentLoaded` **之后**才执行。这意味着首屏按钮很可能不是靠这个监听器插入的，而是靠后面的 `MutationObserver` 在页面后续变动时补上。表现是按钮偶尔要等一下或者刷新才出现。想彻底修的话，把初始化改成直接调用（或加 `document.readyState` 判断）。

**`cnki_journals.json` 是死文件** — 代码里只从 Gitee 远端拉数据，从没读过这个 9MB 的本地副本。取不到远端时回落的是 `content.js` 里内置的十几条 `DEFAULT_JOURNALS_DATA`，不是这个文件。

**`download-worker.js` 和 `icon.png` 当前无效** — 前者没有任何引用，后者因为 manifest 未声明 `icons` 字段不会被使用。扩展的 `action` 也没配 popup，点工具栏图标没反应属正常。

**核查是弱匹配** — 靠文件名包含关系比对，同名不同版本的文献可能误判。文件数量和知网记录数对不上时，不要直接当成缺失，要按题名、来源、年份人工核对。

---

## 验收顺序

改动代码或换浏览器后，按这个顺序过一遍：

1. 单篇下载 1 篇 → 确认不弹保存窗口、文件真的落到目标目录
2. 小批量 2–3 篇 → 确认间隔生效、不重复、不落错目录
3. 点「核查」→ 确认能区分已下载 / 未找到

单篇不通过就别进批量。

---

## 相关文档

本扩展配套的操作流程、作者文献核查方法和历次验证记录放在
`C:\Users\LKs\Documents\知网下载自动化`（`AGENTS.md` + `notes/` + `checks/`）。

---

## 使用前提

需要已登录知网账号并拥有对应文献的下载权限。扩展不提供、也不绕过任何权限。
