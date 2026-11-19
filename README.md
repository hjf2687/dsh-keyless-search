# dsh-keyless-search · 免费联网搜索

给 DeepSeek Harness（DSH）用的**免 API Key 联网搜索**插件：多引擎抓取公开搜索页面，
自动取最快的一个、失败自动降级，内置缓存与熔断；并附带设置页与会话内结果卡片。

> 数据来源是公开搜索页面（HTML / RSS）与公开 API 的**匿名额度**（AnySearch / Exa / Tavily keyless），
> **不需要任何 key、账号或付费额度**；想提额度时再填自己的 key。

---

## 1. 装上之后得到了什么

| 能力 | 说明 |
| --- | --- |
| **内置 `web_search` 变免费** | `cordis.patch.yml` 把 `web.searchProvider` 指向本插件的 `free` provider，harness 原有的 `web_search` / `web_fetch` 工具立刻变成免 key 搜索，无需改任何调用方代码。 |
| **新工具 `free_search`** | 显式控制：选引擎、搜索深度、**时间范围（在结果上按发布时间真实过滤，见 §3.3）**、限定站点，返回结构化结果。 |
| **可选中 `tavily`（key 可选）** | 不填 key 走匿名额度，填 key 走账号额度；默认排在免 key 引擎之后，作为「增强/兜底」来源。 |
| **匿名 API 引擎** | `anysearch`（JSON）与 `exa`（公开 MCP，SSE）：不受页面改版影响，是 HTML 引擎被限流时的第一顺位替补；无需 key，额度按 IP 限。 |
| **自定义引擎** | 在设置页填 URL + JSON 路径，把任意 JSON / RSS / SearXNG 兼容接口接进同一条链路（key 可选，自动以 `{key}` 注入）。 |
| **设置页「免费搜索」** | 设置 → 免费搜索：引擎顺序 / 主引擎 / 结果数 / 超时 / 缓存 / 区域语言，逐引擎健康状态与一键并发探活，**每个引擎默认只占一行**：主行直接可 ↑↓ 排序、★ 设为主引擎、单引擎测试、启停开关（延迟/冷却/异常一眼可见），**点引擎名或行内空白即展开**说明、完整健康信息与 key 输入（没有额外的小三角按钮）；亮/暗主题都有清晰边框。API key 写入，自定义引擎编辑器（可测试未保存的草稿），外加即时测试搜索框；改动未保存时会明确提示。 |
| **会话内结果卡片** | `free_search` 的每次调用在对话里渲染成一张卡片：每条结果**默认只显示一行标题**（域名色块、标题、域名、日期），右侧「展开」按钮点开才显示摘要正文，再点「收起」；卡片顶部有引擎/耗时/深度等元信息。 |
| **HTTP 面板接口** | `/dsh-keyless-search/{status,config,search,probe,test-engine}.json`，全部带回环 + 同源 + 宿主信任栅栏。 |

实测（本机、无任何 key）：

```
Query: DeepSeek Harness 插件开发 文档
Engine: bing · depth: deep · 5 sources · 382ms

$ node tools/selftest.mjs "DeepSeek Harness 插件"
OK   bing        308ms  6 sources      OK   anysearch  3281ms  6 sources
OK   baidu       785ms  6 sources      OK   exa        1603ms  6 sources
OK   so360       501ms  5 sources      OK   tavily      943ms  6 sources
OK   bing-web    292ms  6 sources
7/12 engines returned usable results    # 其余 5 个是本机网络不可达 / 反爬（DDG、Wikipedia、SearXNG、Mojeek）
```

> 界面只有两处：**设置页**和**会话内的结果卡片**。早期版本还有一个可拖动的右下角浮窗，
> 已按需求移除——日常用 `free_search` / `web_search` 工具就够了，浮窗属于多余的一层。

#### 没有这个插件时会怎样（实测）

| | 装/启用本插件 | 禁用本插件后 |
| --- | --- | --- |
| `web_search`（宿主内置工具） | 走本插件的 `free` provider：免 key、带日期、带摘要正文 | **仍可用，但换成宿主自带的 provider**：它会向 `https://api.deepseek.com/anthropic/v1/messages` 发一次**模型调用**（`deepseek-v4-flash` + 服务端 `web_search` 工具）——**占你的账号额度**，且查询经过 DeepSeek 服务端 |
| `free_search` 工具 | 可用：多引擎深度合并、时间范围、限定站点、选引擎 | **工具不存在**（`Error: unknown tool "free_search"`） |
| 自定义引擎 / key（Tavily）/ 缓存 / 熔断 / 设置页 / 结果卡片 | 全部可用 | 全部消失 |

证据来自本会话日志（`tools/probe-hosts-search.mjs` 可直接复跑）：整个会话只出现 **2 次**
`web/deepseek-search-llm-request`，而那 2 次**都是插件不在场的时刻**——一次是本会话开场还没装插件时的试探，
一次是把插件关掉做对照实验时；与此同期插件路径上跑的 17 次 `free_search` **没有产生任何一次** DeepSeek 搜索请求。
请求体长这样：

```json
{ "endpoint": "https://api.deepseek.com/anthropic/v1/messages",
  "body": { "model": "deepseek-v4-flash", "max_tokens": 4096,
            "messages": [{ "role": "user", "content": [{ "type": "text",
              "text": "Perform a web search for the query: 异环 明音凛" }] }],
            "tools": [{ "type": "web_search_20250305", "name": "web_search", "max_uses": 5 }] } }
```

也就是说：**宿主自己那条搜索是要账号/要额度的**（按量或占订阅额度，取决于你的套餐），
本插件的作用正是把这条换成**本机抓公开页面、零 key、零额度**的那条。

### 引擎怎么「删」

* **内置引擎**（bing / baidu / … / tavily）写在 `lib/engines.js` 里，**不能删除**，这是刻意的：
  它们同时是降级链的兜底，删掉会让「搜索突然没结果」变成常态。行尾的启停开关关掉 = 从链路中移除
  （效果等价于删除：不参与选择、不参与降级、不出现在工具描述里），行内会显示 `已停用`；也可以把它
  **排到队尾**当最后兜底。列表下方有一行说明写清这一点。
* **自定义引擎**可以在「自定义引擎」卡片里直接**删除**（同时清掉它的 key）。
* 「保存设置」是唯一的落盘动作：改了顺序 / 主引擎 / 关掉某个引擎后，工具栏会出现**有未保存的改动**提示，
  点保存才生效——避免误以为改完就已经生效。

---

## 2. 安装 / 卸载

```powershell
# 把本仓库克隆到本机任意目录（下称 <插件目录>），再按下面任一种方式安装：
#   方式一：DSH 插件管理器 / 插件页「安装」→ 填 link:<插件目录>
#   方式二：dsh plugin --profile <profile> add link:<插件目录>
# 若已发布到 npm，也可直接按包名 dsh-keyless-search 安装
```

安装动作只有两件事：把包加进 profile 的 `dsh.profile.bundles` + 依赖，以及应用本包的
[`cordis.patch.yml`](cordis.patch.yml)（插入插件行 + 重定向 `web.searchProvider`）。
**卸载时会自动回滚**，`web.searchProvider` 恢复成 `deepseek-official`。

> ℹ️ **是否需要重启？**
> 本机实测：用插件管理器 `install_bundle` 安装后**当场生效**（`application: applied`），无需重启。
> 如果某次安装后条目仍处于 `failed`/未激活，再重启一次 DSH 即可——原因是 DSH Loader 在进程内
> 缓存「包名 → 入口模块」的解析结果，同一个包名在本次进程里只解析一次（这也是插件改名而不是
> 沿用旧名的原因之一：旧名 `dsh-free-search` 已被一次失败的尝试占用了解析结果）。
>
> 另外，本插件为了让**后续改动能热生效**，入口 `lib/plugin.js` 是一个极薄的引导层，
> 每次激活时按 `lib/host.js` 的 mtime 重新 import（见第 5 节）：
> *编辑 `lib/host.js`* → 在插件页关掉再打开该插件即生效；
> *编辑 `lib/plugin.js`*（很少需要）→ 需要重启 DSH。
>
> ⚠️ **改动 `lib/client.js`（界面部分）后，除了关→开插件，还需要刷新一次页面（F5）。**
> 浏览器半区是按 bundle 的 mtime 生成带 rev 的 URL 加载的：关→开插件让宿主重新组合 graph，
> 页面刷新才会去取新 rev。宿主半区不受此影响，无需刷新。

---

## 3. 引擎

| id | 名称 | 免 key | 说明 | 中国大陆 |
| --- | --- | --- | --- | --- |
| `bing` | Bing 必应（RSS） | ✅ | 默认主引擎。最快、最稳，解析几乎不受页面改版影响 | 可用 |
| `baidu` | 百度 | ✅ | 中文覆盖率最高；有风控，触发后自动冷却降级 | 可用 |
| `so360` | 360 搜索 | ✅ | 中文 HTML，`data-mdurl` 直接给出真实 URL | 可用 |
| `bing-web` | Bing 网页版 | ✅ | 摘要更完整，页面改版时可能失效 | 可用 |
| `anysearch` | AnySearch 公开 API | ✅ | JSON 结果，不受页面改版影响；匿名额度有 IP 限流，单次上限 10 条，比 HTML 引擎慢（实测 2.1–2.3s） | 可用 |
| `exa` | Exa（公开 MCP） | ✅ | 语义检索，摘要为高亮片段；匿名额度很紧（同分钟第 3–4 次就限流，约 65s 恢复），限流返回 200+文本，已归类为限流 | 可用但额度紧张 |
| `duckduckgo` | DuckDuckGo | ✅ | 隐私友好 | 通常不可达 |
| `ddg-lite` | DuckDuckGo Lite | ✅ | 极简版，适合受限网络做兜底 | 通常不可达 |
| `searxng` | SearXNG 公共实例 | ✅ | 元搜索；多个实例并行竞速 | 通常不可达 |
| `wikipedia` | Wikipedia API | ✅ | 事实型查询的好兜底 | 不可达 |
| `mojeek` | Mojeek | ✅ | 独立索引（不转售 Google/Bing） | 有反自动化风控 |
| `tavily` | Tavily | ✅ 匿名额度 / 🔑 可带 key | AI 搜索 API，返回已提炼摘要；**不填 key 走匿名额度，填 key 提升额度与稳定性** | 可用 |

* 默认顺序 `bing → baidu → so360 → bing-web → anysearch → exa → duckduckgo → ddg-lite → searxng → wikipedia → mojeek → tavily`。
  把 `tavily` 放最后是刻意的：有 key 时它是**额外来源**，而不是抢走免 key 链路。
  想让它当主引擎，在设置页按 ↑ 排到最前、或点它的「主引擎」。
* 两个匿名 API（`anysearch` / `exa`）排在 HTML 引擎之后、海外引擎之前：它们不受页面改版影响，
  是 Bing/百度被限流时的第一顺位替补；代价是延迟（实测 2–4s，而 Bing RSS 约 250ms）。
* **老配置自动补齐**：你保存的引擎顺序是当时的快照。升级后新增的引擎会**插在它在默认顺序里的前一个引擎之后**，
  而不是被扔到队尾——否则 `deep` 模式只取前 N 个引擎，新引擎永远轮不到。自定义引擎不会被移到队尾。
* **`deep` 模式的并发数**默认是 3（`deepEngines`），只并发链路最前面的 3 个引擎。想让 `anysearch` / `exa`
  参与 deep，把设置页的「deep 引擎数」调到 4–5，或把它们往上拖。
* **熔断**：连续失败 2 次的引擎进入冷却（默认 10 分钟）并自动排到队尾，不影响主链路。
* **合规提示**：Bing RSS 端点声明其结果供个人非商业聚合使用；本插件正是这种用法（个人开发工具）。
  想完全避开这一条，把主引擎换成 `baidu` / `so360`，或用自己的 keyed / 自定义引擎。

### 3.1 Tavily（可选 key：匿名额度 / 账号额度）

Tavily 同一个端点有两档：**不填 key** 时走 `x-tavily-access-mode: keyless` 的匿名额度（实测可用，
单次约 1s，额度按 IP 限）；**填了 key** 时走你的账号额度，更稳、更多。所以它不需要「有 key 才参与」，
而是 `keyOptional`：始终在链路里，key 只是升级。

两种给 key 的方式，任选一种：

1. **设置页**：设置 → 免费搜索 → 引擎列表里点 `Tavily` 那一行展开 → 「填写 key」→ 粘贴 → 保存。
2. **环境变量**：`TAVILY_API_KEY=tvly-...`（插件会自动读取；`status.json` 里会标 `source: "env"`）。

细节：
* key 只写不读 —— 所有 HTTP 响应里都不会出现明文，界面只显示**末 4 位**（`••••1234`）。
  未填 key 时那一行显示「可选 key（不填走匿名额度）」，不会显示成「需要 key」。
* 有 key 时请求同时带 `api_key`（Tavily 经典形态）与 `Authorization: Bearer`（新形态），兼容不同批次的账号；
  无 key 时两个都不带，只加 `x-tavily-access-mode: keyless`。
* `depth: deep` 时使用 `search_depth: advanced`；`429` 记为限流、`401/403` 记为凭证/额度问题，都会降级到下一个引擎。
* key 存在 `${DSH_HOME}/keyless-search.json`（本机明文，同 DSH 自己的 `.credentials.yaml` 口径）。

### 3.2 自定义引擎

设置页「自定义引擎」卡片 → 新增引擎 → 填 4 类字段 → **测试**（不会保存）→ 保存引擎。
支持三种形态，覆盖绝大多数搜索接口：

| 类型 | 适用 | 说明 |
| --- | --- | --- |
| `json` | 返回 JSON 的 API | 用「结果数组路径 + 标题/链接/摘要/日期路径」取值；路径用点号，如 `data.results`、`attributes.title` |
| `rss` | RSS 2.0 / Atom 源 | 自动解析 `<item>` / `<entry>`（标题、链接、描述、日期） |
| `searxng` | SearXNG 兼容 JSON | 直接吃 `results[] {url,title,content,publishedDate}`，把自建 SearXNG 接进来只要一行 URL |

URL（以及请求头 / 请求体模板）里可用这些占位符：

| 占位符 | 含义 |
| --- | --- |
| `{query}` | URL 编码后的查询词 |
| `{queryRaw}` | 原始查询词（放 JSON 请求体时用） |
| `{key}` | 该引擎配置的 API key（没有就替换成空串） |
| `{maxResults}` | 本次请求的期望条数 |
| `{lang}` / `{region}` | 当前语言 / 区域设置 |

摘要路径支持 `a|b|c` **兜底链**：取第一个非空值（例如 `content|description|snippet`）。

### 3.3 日期与「时间范围」是真的怎么实现的

`free_search` 的 `recency: day|week|month|year` **不是**把过滤条件丢给引擎，而是在结果上执行：

```jsonc
// 实测：同样的 bing 查询，加不加 freshness 参数，返回的条目/顺序/时间戳完全一致
// filters=ex1:"ez1" · qft=+filterui:age-lt1440 · freshness=Day · f=Day · gpc=1 …
```

Bing / 百度 的日期过滤只对**登录后的网页版**开放；6 种参数形态在 RSS 与 HTML 端点上全部无效（同一 9 条结果、同一顺序）。所以插件改为：

1. 解析每条结果的发布时间（`publishedAt`）；
2. 按窗口过滤：**无日期的结果一律保留**（无法判断），窗口内全被过滤掉时退回未过滤结果，并在 `recencyUnmet: true` 里说明**没真正生效**（结果卡片上显示「未生效」）。

解析器覆盖的格式：

| 输入 | 结果 |
| --- | --- |
| `周日, 27 9月 2026 23:22:00 GMT`（zh） | `2026-09-27` |
| `Sun, 27 Sep 2026 23:22:00 GMT`（en） | `2026-09-27` |
| `2026年9月27日` / `2026년 9월 27일` / `2026/9/27` | `2026-09-27` |
| `2026-09-27T02:00:00+08:00` | `2026-09-26`（按时区换算） |
| `4天前` / `4 天之前` / `2 周前` / `3 小时前` / `昨天` / `前天` / `2 days ago` | 按当前时间精确回推 |
| `3个月前` / `2年前` | 按 30 天 / 365 天近似回推（**近似值，已注明**） |
| `2 天之前` 之类**解析不了**的 | 留空（不猜） |

**HTML 引擎的日期藏在摘要开头**（RSS 才有 `<pubDate>` 标签）：`bing-web` 的摘要是
`2025年2月28日 · …` / `4 天之前 · …`，`so360` 是 `4天前 - …`。所以 finalize 会从摘要开头
**取出日期并从摘要里删掉**（`dateFromSnippet()`）。实测效果（同一查询）：

| 引擎 | 修复前有日期的条数 | 修复后 |
| --- | --- | --- |
| `bing-web` | 0/6 | **5/6** |
| `so360` | 0/6 | 2/6（其余 4 条**根本没返回摘要**，无从判断） |
| `baidu` | 0/6 | 0/6（它的摘要确实不带日期前缀） |

顺带修掉一个真 bug：引擎用字符偏移切 HTML，会把标签**切一半**，于是 `baidu` 的摘要里出现过
`<div class="cos-row cos-row-c"` 这种生标签；现在 `text()` 会同时清掉「结尾未闭合的标签」
和「开头残标签」。

实测（默认 zh-CN、无 key，`bing`）：不带窗口 8 条 → `recency: "week"` 后 7 条，被去掉的正是唯一一条 2025 年的结果。
deep 模式（3 引擎合并 + 1 周窗口）修复前后都是保留了 2 条无日期旧文（`so360` 不返回摘要），
所以窗口在 deep 下仍是**尽力而为**。

几个能直接抄的例子：

```jsonc
// 自建 SearXNG（不需要 key）
{ "id": "my-searx", "label": "公司 SearXNG", "type": "searxng",
  "url": "https://searx.corp/search?q={query}&format=json" }

// 通用 JSON API（Brave / SerpAPI / 内部服务都是这个形状）
{ "id": "brave", "label": "Brave", "type": "json",
  "url": "https://api.search.brave.com/res/v1/web/search?q={query}&count={maxResults}",
  "headers": "{\"x-subscription-token\":\"{key}\"}",
  "resultsPath": "web.results", "titlePath": "title", "urlPath": "url", "snippetPath": "description" }

// POST + JSON 模板 + 从服务端取真实 URL
{ "id": "internal", "label": "内部搜索", "type": "json", "method": "POST",
  "url": "https://search.corp/api/v1/query",
  "body": "{\"q\":\"{queryRaw}\",\"limit\":{maxResults}}",
  "resultsPath": "data.hits", "titlePath": "title", "urlPath": "link", "snippetPath": "summary|description" }
```

约束与安全：

* `id` 必须是小写字母 / 数字 / 短横线（2–32 位），且**不能和内置引擎重名**（不能覆盖 `bing` 等）。
* URL 必须是 `http(s)`（可以是内网地址 —— 自定义引擎本来就要能干这个）。
* 定义是**纯声明式**的：只有 URL / 请求头 / 请求体模板和取值路径，插件不执行任何用户代码。
* 无效定义会在 `status.json` 的 `rejectedCustomEngines` 里点名，而不是静默消失。
* 「测试」按钮走 `/test-engine.json`，用**未保存的草稿**真发一次请求，失败原因（`CUSTOM_INVALID` /
  `ENGINE_PARSE` / `ENGINE_EMPTY` / `ENGINE_NO_KEY`）直接显示在编辑器里。
* 自定义引擎和内置引擎在同一条链路里：可选、可排序、可设主引擎、参与熔断与缓存、能作为降级目标。

---

## 4. 配置

三种入口，优先级从低到高：**内置默认 → `cordis.patch.yml` 的 `config` → 设置页保存的文件**。

设置页写入 `${DSH_HOME}/keyless-search.json`（原子写：临时文件 + rename）：

```jsonc
{
  "version": 1,
  "config": {
    "primary": "bing",
    "order": ["bing", "baidu", "so360", "..."],
    "enabled": { "mojeek": false },   // 关掉某个引擎
    "keys": { "tavily": "tvly-..." }, // 引擎 API key（只写入，接口不回显）
    "customEngines": [                // 自定义引擎（见 3.2）
      { "id": "my-searx", "type": "searxng", "url": "https://searx.corp/search?q={query}&format=json", "enabled": true }
    ],
    "maxResults": 8,
    "minResults": 3,                  // 均衡模式：拿到这么多就停
    "timeoutMs": 12000,
    "cacheTtlMs": 300000,
    "cooldownMs": 600000,
    "depth": "balanced",              // fast | balanced | deep
    "deepEngines": 3,
    "region": "zh-CN",
    "lang": "zh",
    "includeContent": true
  }
}
```

`cordis.patch.yml` 里的 `config` 会作为基线；设置页的改动覆盖它并持久化。删除该文件即回到基线。

若本机 DSH 部署在非回环地址（反代 / 局域网），用环境变量声明可信 Host：

```powershell
$env:DSH_KEYLESS_SEARCH_TRUSTED_HOSTS = "dsh.example.com,192.168.1.10:3080"
```

---

## 5. 结构

```
dsh-keyless-search/
├─ package.json          入口声明：dsh.bundle.patch + dsh.client(platform/external)
├─ cordis.patch.yml      挂载声明：插入插件行 + 把 web.searchProvider 指向 free
├─ lib/
│  ├─ plugin.js          薄引导层：静态 name/inject；apply() 按 host.js 的 mtime 重新 import
│  ├─ host.js            宿主半区：provider / free_search 工具 / 配置与 key / 5 条 HTTP 路由 / 信任栅栏
│  ├─ engines.js         纯引擎层：10 个内置引擎 + 自定义引擎编译器（无 ctx 依赖，可独立测试）
│  └─ client.js          浏览器半区：__ModuleLoader__ 工厂包，React 由宿主模块表提供（2 个 slot）
└─ tools/
   ├─ selftest.mjs       真实联网跑引擎（`--key=` 带 key、`--custom=defs.json` 带自定义引擎）
   ├─ hosttest.mjs       假 Cordis ctx + 本地 fixture 服务器：provider/tool/缓存/路由/栅栏/JSON 安全/key/自定义引擎/重试/日期/时间范围/并发去重
   ├─ clienttest.mjs     极小 React 运行时 + 假 HTTP：设置页、结果卡片、key 与自定义引擎编辑器
   ├─ reloadtest.mjs     热重载回归：closure 级 cache-bust 是否真的换掉了旧模块
   ├─ recover-from-log.mjs  从会话日志回放 write/edit 重建某个文件（改坏了文件时的救命工具）
   ├─ probe-hosts-search.mjs 查你这个会话的搜索到底走没走 DeepSeek（看 `web/deepseek-search-llm-request` 事件）
   └─ schemacheck.mjs    按 dsh-tools 的 schema 子集规则校验工具 schema
```

**为什么 `plugin.js` 是薄的一层？**
DSH Loader 每个条目只 import 一次并把模块留在 ESM 注册表里（进程生命周期）。
若入口直接写实现，改完必须重启进程才会生效。引导层用一个基于 mtime 的 cache-bust URL，
让 `host.js` 的修改在「插件关→开」时立即生效，同时文件没变时复用同一 URL（不泄漏模块实例）。

**客户端半区**走 DSH 正规通道：`package.json` 的 `dsh.client` + `exports["./client"]`，
由 `dsh-client-modules` 扫描并注入；`require('react')` 来自宿主静态模块表，无需打包器。
贡献两个 slot：`settings.section`（设置页）与 `tool.call.toolview`（key = `free_search`，结果卡片）。
样式全部使用主题 token（`--dsw-alias-*`）并带亮/暗安全兜底，跟随主题切换。

---

## 6. 自测

```powershell
node tools/selftest.mjs                                  # 真实联网：跑所有当前可用的引擎
node tools/selftest.mjs "查询词" bing baidu               # 只测指定引擎
node tools/selftest.mjs --key=tvly-xxx                   # 带上 key 测 tavily
node tools/selftest.mjs --custom=defs.json               # 用文件里的自定义引擎定义
node tools/hosttest.mjs                                  # 宿主半区集成测试（含本地 fixture 服务器）
node tools/clienttest.mjs                                # 设置页 / 结果卡片 / key / 自定义引擎编辑器
node tools/reloadtest.mjs                                # 热重载：改 engines.js 后同进程二次 apply 立即生效
node tools/schemacheck.mjs                               # 工具 schema 校验
node tools/recover-from-log.mjs --target client.js       # 出事时的救命工具（见下）
```

测试全部使用临时 `DSH_HOME`，**不会**碰你真实的设置文件；自定义引擎的解析用本机
`127.0.0.1` 上的 fixture HTTP 服务器验证，不依赖外网，也不发真实搜索请求。

**`recover-from-log.mjs` 是什么**：DSH 的会话日志记录了每一次工具调用，所以某个文件被脚本改坏时，
可以用「回放 write + edit」的方式把它重建出来。本插件开发中真的用到过一次：一次基于行号的批量删除
匹配错了锚点，把 `lib/client.js` 中间 1740 行删掉了（其中包含设置页、结果卡片、自定义引擎编辑器），
就是靠这个工具在几分钟内完整恢复，并用「未被删掉的首尾两段逐字节对比」验证了恢复结果一致。
注意：脚本改的内容不在日志里，所以恢复后可能仍需手工补一步（那次就是补了一遍包名重命名）。

---

## 7. 已知限制

1. **公共搜索面会被限流**：百度会弹「安全验证」、Mojeek/DDG 会对自动化请求返回 403。
   插件按「失败 → 降级 → 冷却」处理，不会把失败当成空结果。
2. **个别引擎在中国大陆不可达**（DDG / Wikipedia / SearXNG / Mojeek）。它们仍是可选项，
   出国或走代理的环境能直接用；本机默认链路不会因为它们的失败而变慢——
   主引擎成功即提前结束。
3. **解析依赖页面结构**：Bing/百度/360 改版可能导致某个引擎失效（`bing` 走 RSS，最不容易坏）。
   失效表现为该引擎进入冷却，其余引擎继续工作；此时用设置页的「测试全部引擎」一眼定位。
4. **结果最多 25 条**，单引擎超时默认 12 秒，工具总超时 60 秒。
5. **摘要（`content`）是引擎给的原文片段**，不做二次摘要——本插件不调用任何模型。
6. **key 是本机明文**（`keyless-search.json`），与 DSH 自身 `.credentials.yaml` 口径一致；
   接口从不回显明文，界面只显示末 4 位。共享机器上请注意文件权限。
7. **自定义引擎只支持 JSON / RSS / SearXNG 三类形状**。纯 HTML 页面（需要 CSS 选择器）不支持——
   那种情况用内置的 HTML 引擎，或让目标服务开一个 JSON 接口。
8. **匿名额度会限流**：`tavily` 不填 key 时走匿名额度（单次上限 10 条）；`anysearch` / `exa` 也是公开 API 的匿名额度
   （`exa` 额度很紧：同分钟第 3–4 次就限流，约 65s 恢复，而且它以 **HTTP 200 + 一段文本**表示限流，插件已把这种情况
   归类为 `ENGINE_BLOCKED` 而不是空结果）。额度耗尽时该引擎进入冷却，链路自动降级，不会拖慢主链路。
   `status.json` 的 `usable` / `health` 会如实反映，设置页也能一键探活。
9. **内置引擎不可删除**（只能停用或排到最后），见 §1 的「引擎怎么删」。
10. **传输层失败会重试一次**（约 350 ms 后），HTTP 状态码不重试——状态码是结果，不是故障。
    错误信息里带主机名与 `cause`（如 `127.0.0.1:1: fetch failed (Error: bad port)`），方便定位自定义引擎。
11. **`web_search`（宿主内置工具）没有时间范围 / 限定站点参数**：宿主给我的 provider 契约只有
    `WebSearchRequest = { query, maxResults? }`，没有第三个字段可传。要用 `recency` / `site` 请调 `free_search`。
12. **相同查询并发时不重复打引擎**：完全相同的请求（同查询 + 同参数 + 同引擎集）在飞行中共用一次链路运行，
    第二个调用者拿到同一份结果并标记 `coalesced: true`（卡片显示「并行合并」）。不同查询照常各打一次。
13. **相对时间是算出来的，不是猜的**：`4天前`/`2 周前`/`3 小时前`/`昨天`/`2 days ago` 都是按当前时间**精确回推**；
    `3个月前`/`2年前` 因为日历上没有确切对应值，按 30 天 / 365 天**近似**（已在上面注明）。解析不了的一律留空。
14. **`recency` 在 deep 模式下是「尽力而为」**：窗口作用在**有日期**的结果上，无日期的结果一律保留。
    本机实测 `so360` 经常**不返回摘要**（4/6 条摘要为空），这些结果无从判断日期，所以窗口拦不住它们。
    需要严格时间范围时，用 `engines: ["bing"]`（RSS，日期齐全）而不是 deep。
15. **不可解码字符会被清掉**：中文结果页里的 emoji 常常解码成 `U+FFFD` 或半个代理对，直接显示就是
    `真身曝光!ߔ` 这种脏字符。标题与摘要统一过一遍 `sanitiseText()`：去掉替换字符、控制字符、**孤立代理对**，
    但**成对的 emoji 照常保留**（`😀` 不会被误删）。

---

## 8. 验收记录（本机 DSH 0.1.7-rc.2 / desktop profile）

| 检查 | 结果 |
| --- | --- |
| `plugin_manager install_bundle` | `application: applied`，无 warning |
| 内置 `web_search` 走本 provider | 返回内容首行 `Engine: bing · depth: balanced · 8 sources · 227ms` |
| `free_search` 真实执行（deep） | 3 引擎并行合并，5 条结果 / 382 ms |
| `settings.section` 占用者 | `dsh-keyless-search` id `keyless-search` order 45 active |
| `tool.call.toolview` 占用者 | `dsh-keyless-search` key `free_search` active |
| 客户端 slot 总数 | 2 个（浮窗已移除，`shell.overlay` 不再注册） |
| tavily（无 key） | 走 `x-tavily-access-mode: keyless` 匿名额度：真机 200 / 6 条 / 969 ms；`status.json` 报 `usable:true`、`keys.tavily.optional:true` |
| tavily（本机 User 级 `TAVILY_API_KEY`） | 真机调用成功：`Engine: tavily · depth: fast · 3 sources · 2192ms`（key 全程不回显） |
| tavily（写入 key 后） | `usable:true`、`hint:"••••1234"`、明文不出现在任何响应里；清空 key 后回到匿名额度（**仍 usable**，而不是从链路消失） |
| 自定义引擎（宿主进程内实测） | 加了 `probe-tavily-get/post` 两个自定义引擎直连 `api.tavily.com`：GET 走到解析阶段（`ENGINE_PARSE`）、POST 用错 key 得到 `ENGINE_NO_KEY` —— 证明自定义引擎的取数/鉴权/错误分类在真实宿主进程里都对 |
| 自定义引擎（fixture 服务器） | JSON 嵌套路径、`a\|b` 摘要兜底、`{queryRaw}`/`{key}` 模板、POST 请求体、RSS、SearXNG、日期归一化全过；坏 JSON → `ENGINE_PARSE`、空结果 → `ENGINE_EMPTY`、错 key → `ENGINE_NO_KEY`、非法 id/URL → `CUSTOM_INVALID` |
| 自定义引擎（链路行为） | 显式 `engines:["自定义id"]` 生效；失败自动降级到下一个；删除后从 registry 消失（内置 12 个仍在） |
| 传输重试 | fixture 主动断开一次 → 重试后成功（恰好 2 次请求）；解析失败**不**重试（恰好 1 次） |
| 发布时间解析 | 16 种绝对格式 + 13 种相对说法断言全过（zh/en/ko/日式/ISO/带时区/相对/垃圾输入留空）；相对时间用固定的 `now` 保证可重复 |
| 摘要里的日期 | 用真机取到的原串做断言：`2025年2月28日 · …`、`4 天之前 · …`、`4天前 - …` 都能取出日期并从摘要删掉；无日期的摘要**一字不改** |
| 摘要里的生标签 | `baidu` 真出现过的 `<div class="cos-row cos-row-c"`（半个标签）不再外泄，整批结果里不含 `<` |
| 时间范围（真机） | 默认 zh-CN 下 `bing`：不带窗口 8 条（日期 2025-05-09 … 2026-09-28）→ `recency:"week"` 后 7 条，只去掉了唯一的 2025 年结果；全旧结果集 → 退回未过滤并报 `recencyUnmet: true` |
| HTML 引擎的日期（真机） | `bing-web` 0/6 → **5/6** 有日期，`so360` 0/6 → 2/6；deep + 1 周窗口仍是"尽力而为"（`so360` 4 条无摘要） |
| 时间范围（fixture） | 窗口内保留、窗口外丢弃、无日期保留（不猜）、窗口空集退回并报 `unmet` —— 4 项断言 |
| 并发去重 | 两个**完全相同**的请求并发 → 引擎只被调用 1 次且两者都拿到结果、恰好一个标记 `coalesced`；不同查询 → 2 次调用 |
| 停用 / 未保存提示 | 行尾开关关掉 → 出现 `已停用` 与「有未保存的改动」，列表下方说明内置引擎不可删除；保存后提示消失并持久化 `enabled:{bing:false}`；开关再打开即恢复 |
| 文本清洗 | fixture 里塞入 `U+FFFD`、控制字符、孤立代理对 → 标题变成 `真身曝光!_九游`、摘要 `摘要带替换字符与控制符`，而**成对 emoji `😀` 原样保留**（4 项断言） |
| 禁用插件后的回滚（实测） | 禁用 → `web_search` 仍返回结果（宿主自带 provider，无日期/无摘要正文）；`free_search` 报 `unknown tool`；重新启用 → 全部恢复 |
| 热重载 | 改 `engines.js` 后同一进程内二次 `apply()` 立刻看到新引擎（closure 级 cache-bust，8 项断言） |
| 引擎真实联网 | bing / bing-web / baidu / so360 / anysearch / exa / tavily(keyless) 返回可用结果；其余按网络环境自动冷却 |
| anysearch（真机） | 3 个查询 3/3 成功：200 / 6 条 / 2.1–2.3 s，结果相关；信封 `code:0` 判定正确 |
| exa（真机） | 成功时 200 / 5–6 条 / 2.4–4.2 s（SSE 帧）；额度耗尽时返回 200 + `_meta["ai.exa/rateLimited"]` + 一段文本 → 归类 `ENGINE_BLOCKED` 并进入冷却，而不是当成空结果 |
| 匿名 API 解析（fixture） | AnySearch 信封/日期/限流码/坏 JSON 4 项；Exa 分块/日期/`N/A`/`...`/SSE 帧/限流文本/JSON-RPC 错误 7 项，全过 |
| 老配置补新引擎 | `mergedOrder(['tavily','bing','baidu'])` → `tavily,bing,baidu,so360,bing-web,anysearch,exa,…`：新引擎插在默认顺序的前一个引擎之后，而不是被扔到队尾（3 项断言） |
| 匿名额度边界 | Exa 限流与 `isError` 同时出现 → 仍判 `ENGINE_BLOCKED`（不被误判成空结果）；行内 `Highlights:`、`N/A` 行、AnySearch `code:"0"`、中文限流措辞 —— 6 项断言 |
| 引擎列表折叠（v1.1.1） | 默认 12 行各一行：`aria-expanded=false`、无 body；点 Tavily 行 → 只展开该行（body 出现、`aria-expanded=true`）；再点收起；开关是 toggle 的兄弟节点（点开关不展开）；收起后仍显示 key 状态与延迟/冷却 |
| 行内操作（v1.1.2） | ↑↓ / ★ / 测试 都在主行、无需展开：点测试会打 `/probe.json` 且不展开；点 ★ 切换主引擎且不展开；长引擎名省略号 + title 提示；主引擎行不显示 ★ |
| 视觉与可点区域（v1.1.3） | 无 `dfs-chevron` 元素（整行点击展开）；hero 标题与副标题同一行、外部数据提示并入徽章行（顶部高度约减少 30px）；边框改为由文字色推导（`color-mix(fg 26%/17%)`），亮色主题下卡片/行/输入框边界清晰；卡片加 1px 阴影 |
| 结果卡折叠（v1.1.4） | 每条结果默认只有标题行（无摘要文本）；「展开」按钮位于标题行右侧；点开显示该条摘要、按钮变「收起」；只展开被点的那一条，再点收起；无摘要的结果不显示按钮（7 项断言） |
| 宿主测试 / 客户端测试 / schema 校验 / 热重载 | ALL CHECKS PASSED（宿主 130 / 客户端 91 / 热重载 8） |

## License

MIT