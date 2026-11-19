/**
 * dsh-keyless-search · client half
 *
 * Loaded by the Harness client module system as a plain factory bundle: the
 * bootstrap injects `window.__ModuleLoader__` and answers `require('react')`
 * from its static table, so this file needs no build step and no dependencies.
 *
 * It contributes three surfaces:
 *
 *   1. `settings.section`  — the 免费搜索 settings page: engine order, primary
 *      engine, limits, health, a live test box and a one-click engine probe.
 *   2. `tool.call.toolview` keyed `free_search` — the result card in the
 *      conversation, driven by the tool result's structured `meta`.

 * Styling uses the Harness theme tokens (with light/dark-safe fallbacks) so the
 * surfaces follow the active theme instead of hard-coding a palette.
 */
window.__ModuleLoader__.load({
  id: 'dsh-keyless-search',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require('react');
    const h = React.createElement;
    const Fragment = React.Fragment;
    const useState = React.useState;
    const useEffect = React.useEffect;
    const useRef = React.useRef;
    const useCallback = React.useCallback;
    const useMemo = React.useMemo;

    const NS = 'dsh-keyless-search';
    const ROUTE = '/dsh-keyless-search';
    const TOOL = 'free_search';

    /* ------------------------------------------------------------------ */
    /* Styles                                                             */
    /* ------------------------------------------------------------------ */

    const CSS = `
.dfs-scope{
  --dfs-bg:var(--dsw-alias-bg-layer-2,#1c1d22);
  --dfs-bg-soft:var(--dsw-alias-bg-layer-1,#16171b);
  --dfs-bg-input:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-3,#23242a));
  --dfs-overlay:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-2,#1c1d22));
  --dfs-border:color-mix(in srgb,var(--dfs-fg) 26%,transparent);
  --dfs-border-soft:color-mix(in srgb,var(--dfs-fg) 17%,transparent);
  --dfs-fg:var(--dsw-alias-label-primary,#e8e8ea);
  --dfs-fg-2:var(--dsw-alias-label-secondary,#b7b8be);
  --dfs-fg-3:var(--dsw-alias-label-tertiary,#8a8b93);
  --dfs-accent:var(--dsw-alias-brand-primary,#4f8cff);
  --dfs-ok:var(--dsw-alias-state-success-primary,#3fb950);
  --dfs-warn:var(--dsw-alias-state-warn-primary,#d29922);
  --dfs-err:var(--dsw-alias-state-error-primary,#f85149);
  --dfs-hover:var(--dsw-alias-interactive-bg-hover,rgba(128,140,180,.12));
  --dfs-radius:10px;
  color:var(--dfs-fg);
  font-size:13px;
  line-height:1.55;
}
.dfs-scope *{box-sizing:border-box}
.dfs-page{display:flex;flex-direction:column;gap:12px;padding:2px 2px 10px;min-width:0}
.dfs-hero{display:flex;flex-direction:column;gap:7px;padding:11px 14px;border:1px solid var(--dfs-border);border-radius:12px;
  background:linear-gradient(135deg,color-mix(in srgb,var(--dfs-accent) 12%,transparent),transparent 62%),var(--dfs-bg);overflow:hidden}
.dfs-heroTop{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.dfs-heroTitle{font-size:15px;font-weight:650;letter-spacing:.2px;margin:0;line-height:1.35}
.dfs-heroSub{color:var(--dfs-fg-3);font-size:11.5px;margin:0}
.dfs-heroMeta{display:flex;gap:5px;flex-wrap:wrap;align-items:center}
.dfs-heroNote{color:var(--dfs-fg-3);font-size:11px}
.dfs-pill{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:500;
  border:1px solid var(--dfs-border-soft);background:var(--dfs-bg-soft);color:var(--dfs-fg-2);white-space:nowrap}
.dfs-pill[data-tone=ok]{color:var(--dfs-ok);border-color:color-mix(in srgb,var(--dfs-ok) 40%,transparent)}
.dfs-pill[data-tone=warn]{color:var(--dfs-warn);border-color:color-mix(in srgb,var(--dfs-warn) 40%,transparent)}
.dfs-pill[data-tone=err]{color:var(--dfs-err);border-color:color-mix(in srgb,var(--dfs-err) 40%,transparent)}
.dfs-pill[data-tone=brand]{color:var(--dfs-accent);border-color:color-mix(in srgb,var(--dfs-accent) 40%,transparent)}
.dfs-card{display:flex;flex-direction:column;gap:11px;padding:13px 15px;border:1px solid var(--dfs-border);border-radius:12px;background:var(--dfs-bg);
  box-shadow:0 1px 2px color-mix(in srgb,var(--dfs-fg) 5%,transparent)}
.dfs-cardHead{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap}
.dfs-cardTitle{font-size:13px;font-weight:600;margin:0}
.dfs-cardHint{color:var(--dfs-fg-3);font-size:11.5px;margin:0}
.dfs-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.dfs-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.dfs-label{color:var(--dfs-fg-2);font-size:12px;font-weight:500;display:flex;align-items:center;gap:6px}
.dfs-input,.dfs-select{width:100%;font:inherit;font-size:12.5px;color:var(--dfs-fg);background:var(--dfs-bg-input);
  border:1px solid var(--dfs-border);border-radius:8px;padding:6px 9px;transition:border-color .14s,box-shadow .14s}
.dfs-input:hover,.dfs-select:hover{border-color:color-mix(in srgb,var(--dfs-accent) 45%,var(--dfs-border))}
.dfs-input:focus,.dfs-select:focus{outline:none;border-color:var(--dfs-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--dfs-accent) 22%,transparent)}
.dfs-select{color-scheme:light dark;cursor:pointer}
.dfs-select option,.dfs-select optgroup{background:#fff;color:#1f2328}
@media (prefers-color-scheme:dark){.dfs-select option,.dfs-select optgroup{background:#1e1f24;color:#e8e8ea}}
.dfs-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;font:inherit;font-size:12.5px;font-weight:550;
  color:var(--dfs-fg);background:var(--dfs-bg);border:1px solid var(--dfs-border);border-radius:8px;padding:6px 13px;cursor:pointer;
  transition:background .14s,border-color .14s,transform .06s}
.dfs-btn:hover:not(:disabled){background:var(--dfs-hover);border-color:color-mix(in srgb,var(--dfs-accent) 40%,var(--dfs-border))}
.dfs-btn:active:not(:disabled){transform:translateY(1px)}
.dfs-btn:disabled{opacity:.5;cursor:default}
.dfs-btn[data-variant=primary]{background:var(--dfs-accent);border-color:var(--dfs-accent);color:#fff}
.dfs-btn[data-variant=primary]:hover:not(:disabled){background:color-mix(in srgb,var(--dfs-accent) 86%,#000);border-color:transparent}
.dfs-btn[data-variant=ghost]{background:transparent;border-color:transparent;color:var(--dfs-fg-2);padding:5px 8px}
.dfs-btn[data-variant=ghost]:hover:not(:disabled){background:var(--dfs-hover);color:var(--dfs-fg)}
.dfs-btn[data-size=sm]{padding:3px 9px;font-size:11.5px;border-radius:7px}
.dfs-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.dfs-engines{display:flex;flex-direction:column;gap:6px}
.dfs-engine{display:flex;flex-direction:column;padding:0;border:1px solid var(--dfs-border-soft);border-radius:9px;background:var(--dfs-bg);
  transition:border-color .14s,background .14s}
.dfs-engine:hover{border-color:color-mix(in srgb,var(--dfs-accent) 38%,var(--dfs-border-soft))}
.dfs-engine[data-active=true]{border-color:color-mix(in srgb,var(--dfs-accent) 55%,transparent);background:color-mix(in srgb,var(--dfs-accent) 8%,var(--dfs-bg))}
.dfs-engine[data-off=true]{opacity:.55}
.dfs-engineHead{display:flex;align-items:center;gap:8px;padding:7px 10px;min-width:0;overflow:hidden}
.dfs-engineToggle{display:flex;align-items:center;gap:9px;flex:1;min-width:0;overflow:hidden;padding:2px 3px;margin:-2px -3px;border:0;background:transparent;color:inherit;
  font:inherit;cursor:pointer;text-align:left;border-radius:7px}
.dfs-engineToggle:hover .dfs-engineLabel{color:var(--dfs-accent)}
.dfs-engineToggle:focus-visible{outline:2px solid color-mix(in srgb,var(--dfs-accent) 60%,transparent);outline-offset:2px}
.dfs-engineName{display:flex;align-items:center;gap:7px;flex-wrap:nowrap;overflow:hidden;font-weight:600;font-size:12.5px;min-width:0}
.dfs-engineLabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.dfs-engineMeta{flex:none;margin-left:auto;color:var(--dfs-fg-3);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
@media (max-width:520px){.dfs-engineMeta{display:none}}
.dfs-engineBody{display:flex;flex-direction:column;gap:7px;padding:9px 11px 10px 30px;border-top:1px solid var(--dfs-border-soft)}
.dfs-engineNote{color:var(--dfs-fg-3);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dfs-engineActions{display:flex;align-items:center;gap:3px;flex:none}
.dfs-engineActions .dfs-btn[data-size=sm]{padding:3px 7px}
.dfs-primaryBtn{color:var(--dfs-fg-2);font-size:13px;line-height:1}
.dfs-primaryBtn:hover:not(:disabled){color:var(--dfs-accent)}
.dfs-dot{width:7px;height:7px;border-radius:50%;background:var(--dfs-fg-3);flex:none}
.dfs-dot[data-state=ok]{background:var(--dfs-ok)}
.dfs-dot[data-state=warn]{background:var(--dfs-warn)}
.dfs-dot[data-state=err]{background:var(--dfs-err)}
.dfs-switch{position:relative;width:34px;height:19px;border-radius:999px;border:1px solid var(--dfs-border);background:var(--dfs-bg-input);
  cursor:pointer;padding:0;flex:none;transition:background .16s,border-color .16s}
.dfs-switch::after{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:var(--dfs-fg-3);transition:transform .16s,background .16s}
.dfs-switch[data-on=true]{background:color-mix(in srgb,var(--dfs-accent) 70%,transparent);border-color:var(--dfs-accent)}
.dfs-switch[data-on=true]::after{transform:translateX(15px);background:#fff}
.dfs-results{display:flex;flex-direction:column;gap:8px}
.dfs-source{display:flex;flex-direction:column;gap:5px;padding:8px 12px;border:1px solid var(--dfs-border-soft);border-radius:9px;background:var(--dfs-bg);
  transition:border-color .14s,background .14s}
.dfs-source:hover{border-color:color-mix(in srgb,var(--dfs-accent) 40%,var(--dfs-border))}
.dfs-sourceTop{display:flex;align-items:center;gap:8px;min-width:0}
.dfs-favicon{width:18px;height:18px;border-radius:5px;flex:none;display:flex;align-items:center;justify-content:center;
  font-size:10px;font-weight:700;color:#fff;background:var(--dfs-accent);text-transform:uppercase}
.dfs-sourceTitle{color:var(--dfs-fg);font-weight:600;font-size:12.5px;text-decoration:none;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dfs-sourceTitle:hover{text-decoration:underline;color:var(--dfs-accent)}
.dfs-sourceHost{color:var(--dfs-fg-3);font-size:11px;flex:none}
.dfs-sourceToggle{flex:none;margin-left:2px}
.dfs-sourceSnippet{color:var(--dfs-fg-2);font-size:12px;line-height:1.6;padding:2px 2px 2px 26px}
.dfs-empty{color:var(--dfs-fg-3);font-size:12px;padding:10px 2px}
.dfs-note{color:var(--dfs-fg-3);font-size:11.5px}
.dfs-msg{display:flex;align-items:center;gap:7px;font-size:12px;padding:7px 11px;border-radius:8px;border:1px solid var(--dfs-border-soft);background:var(--dfs-bg)}
.dfs-msg[data-tone=ok]{color:var(--dfs-ok);border-color:color-mix(in srgb,var(--dfs-ok) 35%,transparent)}
.dfs-msg[data-tone=err]{color:var(--dfs-err);border-color:color-mix(in srgb,var(--dfs-err) 35%,transparent)}
.dfs-code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--dfs-fg-3);word-break:break-all}
.dfs-attempts{display:flex;gap:6px;flex-wrap:wrap}
.dfs-searchBar{display:flex;gap:8px;align-items:center}
.dfs-searchBar .dfs-input{flex:1}
.dfs-spin{width:12px;height:12px;border-radius:50%;border:2px solid color-mix(in srgb,var(--dfs-fg-3) 40%,transparent);border-top-color:var(--dfs-accent);
  animation:dfs-spin .7s linear infinite;flex:none}
@keyframes dfs-spin{to{transform:rotate(360deg)}}

/*
 * The container is the layout box: a fixed, panel-wide column anchored by
 * left+top, with the pill right-aligned at its top and the panel expanding
 * *below* the pill. Because the box width never changes with the open state,
 * the pill keeps its screen position when the panel opens or closes.
 * The box itself is click-through; the pill and the panel opt back in.
 */
  right:18px;top:120px;width:min(420px,calc(100vw - 40px));pointer-events:none;font-family:inherit}
  font-weight:600;color:var(--dfs-fg);background:var(--dfs-overlay);border:1px solid var(--dfs-border);
  box-shadow:0 8px 26px rgba(0,0,0,.28);transition:transform .14s,border-color .14s;
  user-select:none;-webkit-user-select:none;touch-action:none;max-width:100%}
  padding:14px;border:1px solid var(--dfs-border);border-radius:14px;background:var(--dfs-overlay);box-shadow:0 18px 48px rgba(0,0,0,.36);overflow:hidden}

/* API keys */
.dfs-key{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dfs-keyInput{width:210px}
.dfs-keyHint{color:var(--dfs-fg-3);font-size:11px;margin:0}
/* Custom engines */
.dfs-customRows{display:flex;flex-direction:column;gap:6px}
.dfs-customRow{display:flex;align-items:center;gap:10px;padding:9px 11px;border:1px solid var(--dfs-border-soft);border-radius:9px;background:var(--dfs-bg)}
.dfs-customRow[data-off=true]{opacity:.55}
.dfs-customMain{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.dfs-customName{display:flex;align-items:center;gap:7px;font-weight:600;font-size:12.5px}
.dfs-customMeta{color:var(--dfs-fg-3);font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dfs-editor{display:flex;flex-direction:column;gap:11px;padding:13px;border:1px dashed color-mix(in srgb,var(--dfs-accent) 45%,var(--dfs-border));
  border-radius:10px;background:color-mix(in srgb,var(--dfs-accent) 5%,var(--dfs-bg))}
.dfs-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:10px}
.dfs-formFull{grid-column:1/-1}
.dfs-textarea{width:100%;font:inherit;font-size:11.5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dfs-fg);
  background:var(--dfs-bg-input);border:1px solid var(--dfs-border);border-radius:8px;padding:6px 8px;min-height:54px;resize:vertical;line-height:1.5}
.dfs-textarea:focus{outline:none;border-color:var(--dfs-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--dfs-accent) 22%,transparent)}
.dfs-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
`;

    /** Insert the plugin stylesheet once; the loader removes plugin tags on unload. */
    function ensureStyles() {
      const marker = `${NS}/styles`;
      if (typeof document === 'undefined') return;
      if (document.querySelector(`style[data-plugin-css="${marker}"]`) !== null) return;
      const tag = document.createElement('style');
      tag.setAttribute('data-plugin', NS);
      tag.setAttribute('data-plugin-css', marker);
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /* ------------------------------------------------------------------ */
    /* Dictionaries                                                       */
    /* ------------------------------------------------------------------ */

    /* ------------------------------------------------------------------ */
    /* Dictionaries                                                       */
    /*                                                                    */
    /* Values must be plain strings: the locale registry types every      */
    /* dictionary as Record<string, string>, so interpolation is done by  */
    /* the local `fmt()` helper below using `{name}` placeholders.        */
    /* ------------------------------------------------------------------ */

    const DICT_ZH = {
      nav: '免费搜索',
      title: '免费联网搜索',
      subtitle: '无需任何 API Key：多引擎自动取最快的一个，失败自动降级',
      engineCount: '{n} 个免 key 引擎',
      providerReady: 'provider 已注册 · free',
      primaryLabel: '主引擎',
      depthLabel: '搜索深度',
      depthFast: '快速（仅主引擎）',
      depthBalanced: '均衡（够了就停）',
      depthDeep: '深度（并行多引擎合并）',
      maxResultsLabel: '结果条数',
      timeoutLabel: '单引擎超时（毫秒）',
      cacheLabel: '缓存时长（秒）',
      regionLabel: '区域',
      langLabel: '语言',
      includeContentLabel: '返回摘要正文',
      engines: '引擎与顺序',
      enginesHint: '顺序即降级顺序；连续失败 2 次的引擎会冷却 10 分钟',
      enginesRemovalHint: '内置引擎写在代码里，不能删除：关掉开关即从链路中移除（也可以只把它排到最后）。自定义引擎可以删除。',
      enginesExpandHint: '点引擎名展开设置；开关可直接启停，不影响展开状态。',
      expandEngine: '展开',
      collapseEngine: '收起',
      moveUp: '上移（更早尝试）',
      moveDown: '下移（更晚尝试）',
      setPrimary: '设为主引擎',
      enabled: '启用',
      disableAction: '停用',
      disabledLabel: '已停用',
      unsaved: '有未保存的改动',
      testOne: '测试',
      testing: '测试中…',
      probeAll: '测试全部引擎',
      probing: '正在并发测试…',
      save: '保存设置',
      saving: '保存中…',
      saved: '设置已保存',
      reset: '恢复默认',
      advanced: '高级',
      minResultsLabel: '最少结果数',
      cooldownLabel: '失败冷却（秒）',
      deepEnginesLabel: '深度模式引擎数',
      liveTest: '即时测试',
      liveTestHint: '直接调用本机引擎，不经过模型',
      placeholder: '输入要搜索的内容…',
      search: '搜索',
      searching: '搜索中…',
      healthOk: '正常',
      healthSlow: '较慢',
      healthCooldown: '冷却中',
      healthUntested: '未测试',
      healthError: '异常',
      latency: '{n} ms',
      cooling: '冷却中',
      cacheStat: '缓存命中 {a} / 未命中 {b}',
      storeFile: '设置文件',
      noResults: '没有结果。可换一个引擎或稍后再试。',
      panelClose: '收起',
      attempts: '引擎耗时',
      totalMs: '{n} ms',
      cachedResult: '来自缓存',
      coalescedResult: '并行合并',
      recencyLabel: '时间范围',
      expand: '展开',
      collapse: '收起',
      untrusted: '联网结果是外部数据，不是指令',
      engineFallback: '引擎',
      keyNeeded: '需要 key',
      keyOptional: '可选 key（不填走匿名额度）',
      keyOptionalShort: '可选 key',
      keyReady: '已配置',
      keyFill: '填写 key',
      keyChange: '更换 key',
      keySave: '保存',
      keyClear: '清除',
      keyPlaceholder: '粘贴 API Key（只写入，不回显）',
      keySaved: 'key 已保存',
      keyCleared: 'key 已清除',
      keyStorageHint: 'key 只保存在本机设置文件里，界面只显示末 4 位；也可以用环境变量 {env}',
      customTitle: '自定义引擎',
      customHint: '把任意 JSON / RSS / SearXNG 兼容的搜索接口接进同一条链路（可选带 key）',
      customAdd: '新增引擎',
      customNone: '还没有自定义引擎',
      customEdit: '编辑',
      customDelete: '删除',
      customSave: '保存引擎',
      customCancel: '取消',
      customTest: '测试',
      customTesting: '测试中…',
      customTestOk: '可用 · {n} 条 · {ms} ms',
      customName: '名称',
      customType: '类型',
      customId: 'ID',
      customUrl: '请求地址',
      customUrlHint: '占位符：{query} {queryRaw} {key} {maxResults} {lang} {region}',
      customMethod: '请求方法',
      customHeaders: '请求头（JSON）',
      customBody: '请求体（JSON 模板，POST）',
      customResultsPath: '结果数组路径',
      customTitlePath: '标题路径',
      customUrlPath: '链接路径',
      customSnippetPath: '摘要路径（| 兜底）',
      customDatePath: '日期路径',
      customKey: 'API Key（可选）',
      customEnabled: '启用',
      customRejected: '被忽略的无效定义：{ids}',
      customPlaceholderExample: '示例',
      customUntested: '未测试',
    };

    const DICT_EN = {
      nav: 'Free Search',
      title: 'Keyless Web Search',
      subtitle: 'No API key: picks the fastest free engine and falls back automatically',
      engineCount: '{n} keyless engines',
      providerReady: 'provider registered · free',
      primaryLabel: 'Primary engine',
      depthLabel: 'Depth',
      depthFast: 'Fast (primary only)',
      depthBalanced: 'Balanced (stop when enough)',
      depthDeep: 'Deep (merge several engines)',
      maxResultsLabel: 'Results',
      timeoutLabel: 'Engine timeout (ms)',
      cacheLabel: 'Cache TTL (s)',
      regionLabel: 'Region',
      langLabel: 'Language',
      includeContentLabel: 'Return a digest',
      engines: 'Engines and order',
      enginesHint: 'The list is the fallback order; two consecutive failures rest an engine for 10 minutes',
      enginesRemovalHint: 'Built-in engines live in code and cannot be deleted: switch one off to drop it from the chain (or just move it to the end). Custom engines can be deleted.',
      enginesExpandHint: 'Click an engine name to expand its settings; the switch toggles it without changing the expansion.',
      expandEngine: 'Expand',
      collapseEngine: 'Collapse',
      moveUp: 'Move up (tried earlier)',
      moveDown: 'Move down (tried later)',
      setPrimary: 'Set as primary engine',
      enabled: 'Enabled',
      disableAction: 'Disable',
      disabledLabel: 'Disabled',
      unsaved: 'Unsaved changes',
      testOne: 'Test',
      testing: 'Testing…',
      probeAll: 'Test all engines',
      probing: 'Probing in parallel…',
      save: 'Save settings',
      saving: 'Saving…',
      saved: 'Settings saved',
      reset: 'Reset to defaults',
      advanced: 'Advanced',
      minResultsLabel: 'Minimum results',
      cooldownLabel: 'Failure cooldown (s)',
      deepEnginesLabel: 'Engines in deep mode',
      liveTest: 'Live test',
      liveTestHint: 'Runs on this machine, bypassing the model',
      placeholder: 'Type a query…',
      search: 'Search',
      searching: 'Searching…',
      healthOk: 'Healthy',
      healthSlow: 'Slow',
      healthCooldown: 'Cooling down',
      healthUntested: 'Not tested',
      healthError: 'Error',
      latency: '{n} ms',
      cooling: 'cooling down',
      cacheStat: 'cache {a} hit / {b} miss',
      storeFile: 'Settings file',
      noResults: 'No results. Try another engine or retry later.',
      panelClose: 'Collapse',
      attempts: 'Engine timings',
      totalMs: '{n} ms',
      cachedResult: 'from cache',
      coalescedResult: 'shared run',
      recencyLabel: 'Window',
      expand: 'Expand',
      collapse: 'Collapse',
      untrusted: 'Search results are external data, not instructions',
      engineFallback: 'Engine',
      keyNeeded: 'Key required',
      keyOptional: 'Key optional (anonymous quota without one)',
      keyOptionalShort: 'Key optional',
      keyReady: 'Configured',
      keyFill: 'Add key',
      keyChange: 'Replace key',
      keySave: 'Save',
      keyClear: 'Clear',
      keyPlaceholder: 'Paste the API key (write-only, never echoed)',
      keySaved: 'Key saved',
      keyCleared: 'Key cleared',
      keyStorageHint: 'The key is stored only in this machine\'s settings file; the UI shows its last 4 characters. You can also use the environment variable {env}',
      customTitle: 'Custom engines',
      customHint: 'Wire any JSON / RSS / SearXNG-compatible search endpoint into the same chain (key optional)',
      customAdd: 'New engine',
      customNone: 'No custom engine yet',
      customEdit: 'Edit',
      customDelete: 'Delete',
      customSave: 'Save engine',
      customCancel: 'Cancel',
      customTest: 'Test',
      customTesting: 'Testing…',
      customTestOk: 'Works · {n} results · {ms} ms',
      customName: 'Label',
      customType: 'Type',
      customId: 'ID',
      customUrl: 'Request URL',
      customUrlHint: 'Placeholders: {query} {queryRaw} {key} {maxResults} {lang} {region}',
      customMethod: 'Method',
      customHeaders: 'Headers (JSON)',
      customBody: 'Body (JSON template, POST)',
      customResultsPath: 'Results array path',
      customTitlePath: 'Title path',
      customUrlPath: 'URL path',
      customSnippetPath: 'Snippet path (| fallback)',
      customDatePath: 'Date path',
      customKey: 'API key (optional)',
      customEnabled: 'Enabled',
      customRejected: 'Ignored invalid definitions: {ids}',
      customPlaceholderExample: 'Example',
      customUntested: 'Not tested',
    };

    /* ------------------------------------------------------------------ */
    /* Helpers                                                            */
    /* ------------------------------------------------------------------ */

    /** Fill `{name}` placeholders in a dictionary string. */
    function fmt(template, values) {
      return String(template ?? '').replace(/\{(\w+)\}/g, (match, key) => (values !== undefined && values[key] !== undefined ? String(values[key]) : match));
    }

    async function api(path, body) {
      const options = body === undefined
        ? { headers: { accept: 'application/json' } }
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
      const response = await fetch(`${ROUTE}${path}`, options);
      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 120)}`);
      }
      if (payload && payload.ok === false) throw new Error(payload.error ?? 'request failed');
      return payload;
    }

    function hostOf(url) {
      try {
        return new URL(url).hostname.replace(/^www\./, '');
      } catch {
        return url;
      }
    }

    function initialOf(host) {
      const clean = String(host ?? '?').replace(/^[^a-z0-9\u4e00-\u9fa5]+/i, '');
      return (clean[0] ?? '?').toUpperCase();
    }

    /** Deterministic accent per domain so result chips read as identities. */
    function hueOf(host) {
      let hash = 0;
      const value = String(host ?? '');
      for (let index = 0; index < value.length; index++) hash = (hash * 31 + value.charCodeAt(index)) % 360;
      return hash;
    }

    function healthState(health, probe) {
      if (probe !== undefined) return probe.ok ? (probe.ms > 4000 ? 'warn' : 'ok') : 'err';
      if (health?.coolingDown) return 'err';
      if (health?.lastOkAt) return health.lastMs > 4000 ? 'warn' : 'ok';
      if (health?.lastError) return 'err';
      return 'idle';
    }

    function healthLabel(t, health, probe) {
      if (probe !== undefined) return probe.ok ? fmt(t('latency'), { n: probe.ms }) : String(probe.error ?? 'failed').slice(0, 60);
      if (health?.coolingDown) return t('cooling');
      if (health?.lastOkAt) return `${t('healthOk')} · ${fmt(t('latency'), { n: health.lastMs })}`;
      if (health?.lastError) return String(health.lastError).slice(0, 60);
      return t('healthUntested');
    }

    /** One-glance health for the collapsed row: latency, cooling, or nothing. */
    function healthMeta(t, health, probe) {
      if (probe !== undefined) return probe.ok ? fmt(t('latency'), { n: probe.ms }) : t('healthError');
      if (health?.coolingDown) return t('cooling');
      if (health?.lastOkAt) return fmt(t('latency'), { n: health.lastMs });
      if (health?.lastError) return t('healthError');
      return '';
    }

    /** Small error boundary so a bad payload can never blank the conversation. */
    class Boundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }

      static getDerivedStateFromError(error) {
        return { error };
      }

      render() {
        if (this.state.error !== null) {
          return h(
            'div',
            { className: 'dfs-scope' },
            h('div', { className: 'dfs-note' }, `${this.props.fallback ?? 'free_search'} — render error: ${String(this.state.error?.message ?? this.state.error)}`),
          );
        }
        return this.props.children;
      }
    }

    /* ------------------------------------------------------------------ */
    /* Shared atoms                                                       */
    /* ------------------------------------------------------------------ */

    function Pill({ tone, children }) {
      return h('span', { className: 'dfs-pill', 'data-tone': tone ?? 'neutral' }, children);
    }

    function Card({ title, hint, right, children }) {
      return h(
        'section',
        { className: 'dfs-card' },
        (title !== undefined || right !== undefined)
          ? h(
              'header',
              { className: 'dfs-cardHead' },
              h('div', null, h('h4', { className: 'dfs-cardTitle' }, title), hint !== undefined ? h('p', { className: 'dfs-cardHint' }, hint) : null),
              right ?? null,
            )
          : null,
        children,
      );
    }

    function Select({ value, onChange, options, disabled }) {
      return h(
        'select',
        { className: 'dfs-select', value, disabled: disabled === true, onChange: (event) => onChange(event.target.value) },
        options.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
      );
    }

    function NumberField({ value, onChange, min, max, step }) {
      return h('input', {
        className: 'dfs-input',
        type: 'number',
        value: Number.isFinite(value) ? value : 0,
        min,
        max,
        step: step ?? 1,
        onChange: (event) => {
          const parsed = Number(event.target.value);
          if (Number.isFinite(parsed)) onChange(parsed);
        },
      });
    }

    function Switch({ on, onToggle, title }) {
      return h('button', {
        type: 'button',
        className: 'dfs-switch',
        'data-on': on === true,
        title,
        'aria-pressed': on === true,
        onClick: onToggle,
      });
    }

    function Field({ label, children }) {
      return h('label', { className: 'dfs-field' }, h('span', { className: 'dfs-label' }, label), children);
    }

    function TextArea({ value, onChange, rows, placeholder }) {
      return h('textarea', {
        className: 'dfs-textarea',
        rows: rows ?? 3,
        value: value ?? '',
        placeholder,
        spellCheck: false,
        onChange: (event) => onChange(event.target.value),
      });
    }

    /**
     * Add / replace / clear one engine's API key.
     *
     * Keys are write-only: the status payload only carries `{configured, hint}`
     * so this control can show "configured ••••1234" but can never read the value
     * back. Saving posts `{keys: {id: value}}`; an empty value clears it.
     */
    function KeyEditor({ t, id, meta, busy, onSave, onClear }) {
      const [editing, setEditing] = useState(false);
      const [value, setValue] = useState('');
      const configured = meta?.configured === true;
      if (!editing) {
        return h(
          'div',
          { className: 'dfs-key' },
          configured
            ? h(Pill, { tone: 'ok' }, `${t('keyReady')} ${meta?.hint ?? ''}`.trim(), meta?.source === 'env' ? ' · env' : '')
            : meta?.optional === true
              ? h(Pill, { tone: 'ok' }, t('keyOptional'))
              : h(Pill, { tone: 'warn' }, t('keyNeeded')),
          h(
            'button',
            { type: 'button', className: 'dfs-btn', 'data-size': 'sm', disabled: busy === true, onClick: () => setEditing(true) },
            configured ? t('keyChange') : t('keyFill'),
          ),
        );
      }
      const commit = () => {
        const trimmed = value.trim();
        if (trimmed === '') return;
        onSave(id, trimmed);
        setValue('');
        setEditing(false);
      };
      return h(
        'div',
        { className: 'dfs-key' },
        h('input', {
          className: 'dfs-input dfs-keyInput',
          type: 'password',
          autoComplete: 'off',
          value,
          placeholder: t('keyPlaceholder'),
          onChange: (event) => setValue(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') setEditing(false);
          },
        }),
        h('button', { type: 'button', className: 'dfs-btn', 'data-variant': 'primary', 'data-size': 'sm', disabled: value.trim() === '', onClick: commit }, t('keySave')),
        configured
          ? h(
              'button',
              { type: 'button', className: 'dfs-btn', 'data-size': 'sm', disabled: busy === true, onClick: () => { onClear(id); setEditing(false); } },
              t('keyClear'),
            )
          : null,
        h('button', { type: 'button', className: 'dfs-btn', 'data-variant': 'ghost', 'data-size': 'sm', onClick: () => setEditing(false) }, t('customCancel')),
        h('p', { className: 'dfs-keyHint' }, fmt(t('keyStorageHint'), { env: meta?.envKey ?? '' })),
      );
    }

    const CUSTOM_TYPES = [
      { value: 'json', label: 'JSON API' },
      { value: 'rss', label: 'RSS / Atom' },
      { value: 'searxng', label: 'SearXNG 兼容' },
    ];

    const EMPTY_CUSTOM = {
      id: '',
      label: '',
      type: 'json',
      url: '',
      method: 'GET',
      headers: '',
      body: '',
      resultsPath: '',
      titlePath: 'title',
      urlPath: 'url',
      snippetPath: 'content|description|snippet',
      publishedAtPath: 'published_date|published|date',
      enabled: true,
    };

    /**
     * Custom-engine manager: list, enable/disable, test, edit, delete.
     *
     * A draft is validated by the host *before* it is saved: 测试 posts the
     * unsaved definition to `/test-engine.json`, so a broken path/URL is caught
     * in the editor instead of polluting the saved chain.
     */
    function CustomEnginePanel({ t, status, draft, patch, save, busy, setMessage, query }) {
      const [editor, setEditor] = useState(null);
      const [testing, setTesting] = useState(false);
      const [testResult, setTestResult] = useState(null);
      const customs = Array.isArray(draft?.customEngines) ? draft.customEngines : [];
      const keys = status.keys ?? {};

      const persist = (nextList, keyPatch) => {
        patch({ customEngines: nextList });
        save({ ...draft, customEngines: nextList }, keyPatch === undefined ? undefined : { keys: keyPatch });
      };

      const openEditor = (definition, isNew) => {
        setEditor({ definition: { ...EMPTY_CUSTOM, ...definition }, isNew: isNew === true, key: '' });
        setTestResult(null);
      };

      const runTest = async () => {
        if (editor === null) return;
        setTesting(true);
        setTestResult(null);
        try {
          const payload = await api('/test-engine.json', {
            engine: editor.definition,
            key: editor.key.trim() === '' ? undefined : editor.key.trim(),
            query: typeof query === 'string' && query.trim() !== '' ? query.trim() : 'DeepSeek Harness',
            maxResults: 5,
          });
          setTestResult(payload);
        } catch (error) {
          setTestResult({ ok: false, error: String(error.message ?? error) });
        } finally {
          setTesting(false);
        }
      };

      const saveEditor = () => {
        if (editor === null) return;
        const definition = editor.definition;
        const next = [...customs.filter((entry) => entry.id !== definition.id), definition];
        const keyPatch = editor.key.trim() === '' ? undefined : { [definition.id]: editor.key.trim() };
        persist(next, keyPatch);
        setMessage?.({ tone: 'ok', text: t('saved') });
        setEditor(null);
      };

      const remove = (id) => {
        const next = customs.filter((entry) => entry.id !== id);
        patch({ customEngines: next });
        save({ ...draft, customEngines: next }, { keys: { [id]: '' } });
      };

      const setEnabled = (id, enabled) => {
        const next = customs.map((entry) => (entry.id === id ? { ...entry, enabled } : entry));
        persist(next);
      };

      return h(
        Card,
        {
          title: t('customTitle'),
          hint: t('customHint'),
          right: h(
            'button',
            { type: 'button', className: 'dfs-btn', 'data-size': 'sm', disabled: busy === 'save', onClick: () => openEditor(EMPTY_CUSTOM, true) },
            `+ ${t('customAdd')}`,
          ),
        },
        Array.isArray(status.rejectedCustomEngines) && status.rejectedCustomEngines.length > 0
          ? h('div', { className: 'dfs-msg', 'data-tone': 'err' }, fmt(t('customRejected'), { ids: status.rejectedCustomEngines.join(', ') }))
          : null,
        customs.length === 0 && editor === null ? h('p', { className: 'dfs-note' }, t('customNone')) : null,
        customs.length > 0
          ? h(
              'div',
              { className: 'dfs-customRows' },
              customs.map((entry) => {
                const engine = status.engines.find((item) => item.id === entry.id);
                const keyMeta = keys[entry.id];
                return h(
                  'div',
                  { key: entry.id, className: 'dfs-customRow', 'data-off': entry.enabled === false },
                  h('span', { className: 'dfs-dot', 'data-state': engine?.health?.lastError ? 'err' : engine?.health?.lastOkAt ? 'ok' : 'idle' }),
                  h(
                    'div',
                    { className: 'dfs-customMain' },
                    h(
                      'div',
                      { className: 'dfs-customName' },
                      entry.label || entry.id,
                      h(Pill, { tone: 'brand' }, entry.type),
                      h('span', { className: 'dfs-mono', style: { color: 'var(--dfs-fg-3)', fontSize: '11px' } }, entry.id),
                      keyMeta?.configured === true ? h(Pill, { tone: 'ok' }, `key ${keyMeta.hint ?? ''}`.trim()) : null,
                    ),
                    h('div', { className: 'dfs-customMeta' }, entry.url),
                  ),
                  h(
                    'div',
                    { className: 'dfs-engineSide' },
                    h(
                      'button',
                      { type: 'button', className: 'dfs-btn', 'data-size': 'sm', disabled: busy === 'save', onClick: () => openEditor(entry, false) },
                      t('customEdit'),
                    ),
                    h(
                      'button',
                      { type: 'button', className: 'dfs-btn', 'data-size': 'sm', disabled: busy === 'save', onClick: () => remove(entry.id) },
                      t('customDelete'),
                    ),
                    h(Switch, { on: entry.enabled !== false, title: t('customEnabled'), onToggle: () => setEnabled(entry.id, entry.enabled === false) }),
                  ),
                );
              }),
            )
          : null,
        editor !== null
          ? h(
              'div',
              { className: 'dfs-editor' },
              h(
                'div',
                { className: 'dfs-form' },
                h(Field, { label: t('customId') }, h('input', {
                  className: 'dfs-input',
                  value: editor.definition.id,
                  disabled: editor.isNew !== true,
                  placeholder: 'my-search',
                  onChange: (event) => setEditor((current) => ({ ...current, definition: { ...current.definition, id: event.target.value } })),
                })),
                h(Field, { label: t('customName') }, h('input', {
                  className: 'dfs-input',
                  value: editor.definition.label,
                  placeholder: 'My Search',
                  onChange: (event) => setEditor((current) => ({ ...current, definition: { ...current.definition, label: event.target.value } })),
                })),
                h(Field, { label: t('customType') }, Select({
                  value: editor.definition.type,
                  onChange: (value) => setEditor((current) => ({ ...current, definition: { ...current.definition, type: value } })),
                  options: CUSTOM_TYPES,
                })),
                h(Field, { label: t('customMethod') }, Select({
                  value: editor.definition.method ?? 'GET',
                  onChange: (value) => setEditor((current) => ({ ...current, definition: { ...current.definition, method: value } })),
                  options: [
                    { value: 'GET', label: 'GET' },
                    { value: 'POST', label: 'POST' },
                  ],
                })),
                h(Field, { label: t('customUrl') }, h('input', {
                  className: 'dfs-input dfs-mono',
                  value: editor.definition.url,
                  placeholder: 'https://api.example.com/search?q={query}',
                  onChange: (event) => setEditor((current) => ({ ...current, definition: { ...current.definition, url: event.target.value } })),
                })),
                h(Field, { label: t('customKey') }, h('input', {
                  className: 'dfs-input',
                  type: 'password',
                  autoComplete: 'off',
                  value: editor.key,
                  placeholder: keys[editor.definition.id]?.configured === true ? `${t('keyReady')} ${keys[editor.definition.id].hint ?? ''}` : '{key}',
                  onChange: (event) => setEditor((current) => ({ ...current, key: event.target.value })),
                })),
                h('p', { className: 'dfs-note dfs-formFull' }, fmt(t('customUrlHint'), {})),
                editor.definition.type === 'json'
                  ? h(Field, { label: t('customResultsPath') }, h('input', {
                      className: 'dfs-input dfs-mono',
                      value: editor.definition.resultsPath ?? '',
                      placeholder: 'data.results',
                      onChange: (event) => setEditor((current) => ({ ...current, definition: { ...current.definition, resultsPath: event.target.value } })),
                    }))
                  : null,
                editor.definition.type === 'json'
                  ? h(Field, { label: t('customTitlePath') }, h('input', {
                      className: 'dfs-input dfs-mono',
                      value: editor.definition.titlePath ?? '',
                      placeholder: 'title',
                      onChange: (event) => setEditor((current) => ({ ...current, definition: { ...current.definition, titlePath: event.target.value } })),
                    }))
                  : null,
                editor.definition.type === 'json'
                  ? h(Field, { label: t('customUrlPath') }, h('input', {
                      className: 'dfs-input dfs-mono',
                      value: editor.definition.urlPath ?? '',
                      placeholder: 'url',
                      onChange: (event) => setEditor((current) => ({ ...current, definition: { ...current.definition, urlPath: event.target.value } })),
                    }))
                  : null,
                editor.definition.type === 'json'
                  ? h(Field, { label: t('customSnippetPath') }, h('input', {
                      className: 'dfs-input dfs-mono',
                      value: editor.definition.snippetPath ?? '',
                      placeholder: 'content|description',
                      onChange: (event) => setEditor((current) => ({ ...current, definition: { ...current.definition, snippetPath: event.target.value } })),
                    }))
                  : null,
                editor.definition.type === 'json'
                  ? h(Field, { label: t('customDatePath') }, h('input', {
                      className: 'dfs-input dfs-mono',
                      value: editor.definition.publishedAtPath ?? '',
                      placeholder: 'published_date|date',
                      onChange: (event) => setEditor((current) => ({ ...current, definition: { ...current.definition, publishedAtPath: event.target.value } })),
                    }))
                  : null,
                h(Field, { label: t('customHeaders') }, h('input', {
                  className: 'dfs-input dfs-mono',
                  value: editor.definition.headers ?? '',
                  placeholder: '{"x-api-key":"{key}"}',
                  onChange: (event) => setEditor((current) => ({ ...current, definition: { ...current.definition, headers: event.target.value } })),
                })),
                editor.definition.method === 'POST'
                  ? h(Field, { label: t('customBody') }, h('span', { className: 'dfs-formFull' }, TextArea({
                      value: editor.definition.body ?? '',
                      rows: 3,
                      placeholder: '{"query":"{queryRaw}","limit":{maxResults}}',
                      onChange: (value) => setEditor((current) => ({ ...current, definition: { ...current.definition, body: value } })),
                    })))
                  : null,
              ),
              h(
                'div',
                { className: 'dfs-toolbar' },
                h(
                  'button',
                  { type: 'button', className: 'dfs-btn', disabled: testing, onClick: runTest },
                  testing ? h('span', { className: 'dfs-spin' }) : null,
                  testing ? t('customTesting') : t('customTest'),
                ),
                h(
                  'button',
                  { type: 'button', className: 'dfs-btn', 'data-variant': 'primary', disabled: busy === 'save', onClick: saveEditor },
                  t('customSave'),
                ),
                h('button', { type: 'button', className: 'dfs-btn', onClick: () => setEditor(null) }, t('customCancel')),
                h('label', { className: 'dfs-label' }, h(Switch, {
                  on: editor.definition.enabled !== false,
                  title: t('customEnabled'),
                  onToggle: () => setEditor((current) => ({ ...current, definition: { ...current.definition, enabled: current.definition.enabled === false } })),
                }), t('customEnabled')),
              ),
              testResult !== null
                ? testResult.ok === true
                  ? h(
                      Fragment,
                      null,
                      h('div', { className: 'dfs-msg', 'data-tone': 'ok' }, fmt(t('customTestOk'), { n: testResult.count, ms: testResult.ms })),
                      h(SourceList, { sources: testResult.sources, t }),
                    )
                  : h('div', { className: 'dfs-msg', 'data-tone': 'err' }, testResult.error ?? t('customUntested'))
                : null,
            )
          : null,
      );
    }

    function SourceList({ sources, t, dense }) {
      const [open, setOpen] = useState({});
      if (!Array.isArray(sources) || sources.length === 0) return h('p', { className: 'dfs-empty' }, t('noResults'));
      return h(
        'div',
        { className: 'dfs-results' },
        sources.map((source, index) => {
          const host = hostOf(source.url);
          const isOpen = open[index] === true;
          const hasSnippet = typeof source.snippet === 'string' && source.snippet !== '';
          return h(
            'article',
            { key: `${source.url}-${index}`, className: 'dfs-source', 'data-open': isOpen },
            h(
              'div',
              { className: 'dfs-sourceTop' },
              h('span', { className: 'dfs-favicon', style: { background: `hsl(${hueOf(host)} 62% 46%)` } }, initialOf(host)),
              h(
                'a',
                { className: 'dfs-sourceTitle', href: source.url, target: '_blank', rel: 'noreferrer noopener', title: source.title ?? source.url },
                source.title ?? host,
              ),
              h('span', { className: 'dfs-sourceHost' }, host),
              source.publishedAt !== undefined ? h(Pill, { tone: 'neutral' }, source.publishedAt) : null,
              // Collapsed rows show the title only; the snippet is one click away.
              hasSnippet
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dfs-btn dfs-sourceToggle',
                      'data-variant': 'ghost',
                      'data-size': 'sm',
                      'aria-expanded': isOpen,
                      title: isOpen ? t('collapse') : t('expand'),
                      onClick: () => setOpen((previous) => ({ ...previous, [index]: previous[index] !== true })),
                    },
                    isOpen ? t('collapse') : t('expand'),
                  )
                : null,
            ),
            isOpen && hasSnippet ? h('p', { className: 'dfs-sourceSnippet' }, source.snippet) : null,
          );
        }),
      );
    }

    /* ------------------------------------------------------------------ */
    /* Settings page                                                      */
    /* ------------------------------------------------------------------ */

    const DEPTHS = ['fast', 'balanced', 'deep'];

    function SettingsPage(props) {
      const t = props.t;
      const [status, setStatus] = useState(null);
      const [draft, setDraft] = useState(null);
      const [busy, setBusy] = useState(null);
      const [message, setMessage] = useState(null);
      const [probes, setProbes] = useState({});
      const [probeBusy, setProbeBusy] = useState({});
      const [query, setQuery] = useState('');
      const [test, setTest] = useState(null);
      const [advanced, setAdvanced] = useState(false);
      // Engine rows are one line by default: a long engine list otherwise eats
      // the whole page. Expansion is per engine and lives only in this view.
      const [expandedEngines, setExpandedEngines] = useState({});
      const toggleEngine = (id) => setExpandedEngines((current) => ({ ...current, [id]: current[id] !== true }));

      const load = useCallback(async () => {
        try {
          const payload = await api('/status.json');
          setStatus(payload);
          setDraft(payload.config);
        } catch (error) {
          setMessage({ tone: 'err', text: `status.json: ${String(error.message ?? error)}` });
        }
      }, []);

      useEffect(() => {
        load();
      }, [load]);

      const patch = useCallback((change) => setDraft((previous) => (previous === null ? previous : { ...previous, ...change })), []);

      /**
       * Is the form ahead of what the host has stored? Every control writes to
       * the draft, so without this a reorder (or a disabled engine) looks applied
       * while the running chain is unchanged.
       */
      const dirty =
        draft !== null && status !== null
          ? JSON.stringify({ ...draft, customEngines: draft.customEngines ?? [] }) !== JSON.stringify({ ...status.config, customEngines: status.config.customEngines ?? [] })
          : false;

      const save = useCallback(
        async (nextDraft, extra) => {
          const target = nextDraft ?? draft;
          if (target === null) return;
          setBusy('save');
          setMessage(null);
          try {
            const payload = await api('/config.json', { config: target, ...(extra ?? {}) });
            setStatus(payload);
            setDraft(payload.config);
            setMessage({ tone: 'ok', text: t('saved') });
          } catch (error) {
            setMessage({ tone: 'err', text: String(error.message ?? error) });
          } finally {
            setBusy(null);
          }
        },
        [draft, t],
      );

      /**
       * Key writes go through the same route but as a `keys` patch, so saving a
       * key never has to resend (or risk clobbering) the rest of the config.
       */
      const writeKey = useCallback(
        async (id, value) => {
          setBusy('save');
          try {
            const payload = await api('/config.json', { keys: { [id]: value } });
            setStatus(payload);
            setMessage({ tone: 'ok', text: value === '' ? t('keyCleared') : t('keySaved') });
          } catch (error) {
            setMessage({ tone: 'err', text: String(error.message ?? error) });
          } finally {
            setBusy(null);
          }
        },
        [t],
      );

      const probe = useCallback(
        async (ids) => {
          const key = ids.length === 1 ? ids[0] : '*';
          if (key === '*') setBusy('probe');
          else setProbeBusy((previous) => ({ ...previous, [key]: true }));
          setMessage(null);
          try {
            const payload = await api('/probe.json', { engines: ids, query: query.trim() === '' ? 'DeepSeek Harness' : query.trim() });
            const next = {};
            for (const item of payload.probes) next[item.engine] = item;
            setProbes((previous) => ({ ...previous, ...next }));
            const failed = payload.probes.filter((item) => item.ok !== true).length;
            setMessage(
              failed === 0
                ? { tone: 'ok', text: `${payload.probes.length}/${payload.probes.length} ${t('healthOk')}` }
                : { tone: 'err', text: `${payload.probes.length - failed}/${payload.probes.length} ${t('healthOk')}` },
            );
            await load();
          } catch (error) {
            setMessage({ tone: 'err', text: String(error.message ?? error) });
          } finally {
            setBusy(null);
            setProbeBusy((previous) => ({ ...previous, [key]: false }));
          }
        },
        [query, t, load],
      );

      const runTest = useCallback(async () => {
        if (query.trim() === '' || draft === null) return;
        setBusy('search');
        setMessage(null);
        try {
          const payload = await api('/search.json', { query: query.trim(), depth: draft.depth, maxResults: draft.maxResults, fresh: true });
          setTest(payload);
        } catch (error) {
          setTest({ ok: false, error: String(error.message ?? error) });
        } finally {
          setBusy(null);
        }
      }, [query, draft]);

      if (status === null || draft === null) {
        return h('div', { className: 'dfs-scope' }, h('div', { className: 'dfs-page' }, h(Pill, null, h('span', { className: 'dfs-spin' }), 'loading…')));
      }

      const enginesById = new Map(status.engines.map((engine) => [engine.id, engine]));
      const order = Array.isArray(draft.order) ? draft.order.filter((id) => enginesById.has(id)) : [];
      // Engines missing from the stored order (added by a later plugin version)
      // are slotted in by the host's own rank (`engine.order`), not appended to
      // the tail: the host inserts them after their default predecessor, and a
      // tail append here would show — and then persist on the first ↑/↓ — an
      // order that differs from the one actually executed.
      const rank = new Map(status.engines.map((engine) => [engine.id, typeof engine.order === 'number' ? engine.order : Number.MAX_SAFE_INTEGER]));
      for (const engine of status.engines) {
        if (order.includes(engine.id)) continue;
        const at = order.findIndex((id) => (rank.get(id) ?? Number.MAX_SAFE_INTEGER) > rank.get(engine.id));
        order.splice(at === -1 ? order.length : at, 0, engine.id);
      }
      const enabledCount = status.engines.filter((engine) => draft.enabled[engine.id] !== false).length;
      const ready = status.engines.filter((engine) => engine.enabled && engine.health.lastOkAt !== null).length;
      const primaryEngine = enginesById.get(draft.primary);

      const move = (index, delta) => {
        const next = [...order];
        const target = index + delta;
        if (target < 0 || target >= next.length) return;
        const [item] = next.splice(index, 1);
        next.splice(target, 0, item);
        patch({ order: next });
      };

      return h(
        'div',
        { className: 'dfs-scope' },
        h(
          'div',
          { className: 'dfs-page' },
          /* hero */
          h(
            'header',
            { className: 'dfs-hero' },
            h(
              'div',
              { className: 'dfs-heroTop' },
              h('h3', { className: 'dfs-heroTitle' }, t('title')),
              h('p', { className: 'dfs-heroSub' }, t('subtitle')),
            ),
            h(
              'div',
              { className: 'dfs-heroMeta' },
              h(Pill, { tone: 'brand' }, fmt(t('engineCount'), { n: status.engines.length })),
              h(Pill, { tone: enabledCount > 0 ? 'ok' : 'err' }, `${enabledCount} ${t('enabled')}`),
              h(Pill, { tone: 'ok' }, t('providerReady')),
              ready > 0 ? h(Pill, { tone: 'ok' }, `liveness ${ready}/${enabledCount || 1}`) : null,
              h(Pill, null, fmt(t('cacheStat'), { a: status.cache.hits, b: status.cache.misses })),
              h('span', { className: 'dfs-heroNote' }, t('untrusted')),
            ),
          ),

          /* live test */
          h(
            Card,
            {
              title: t('liveTest'),
              hint: t('liveTestHint'),
              right: h(
                'select',
                {
                  className: 'dfs-select',
                  style: { width: 'auto' },
                  value: draft.depth,
                  onChange: (event) => patch({ depth: event.target.value }),
                },
                DEPTHS.map((depth) => h('option', { key: depth, value: depth }, t(depth === 'fast' ? 'depthFast' : depth === 'balanced' ? 'depthBalanced' : 'depthDeep'))),
              ),
            },
            h(
              'div',
              { className: 'dfs-searchBar' },
              h('input', {
                className: 'dfs-input',
                value: query,
                placeholder: t('placeholder'),
                onChange: (event) => setQuery(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') runTest();
                },
              }),
              h(
                'button',
                { type: 'button', className: 'dfs-btn', 'data-variant': 'primary', disabled: busy === 'search' || query.trim() === '', onClick: runTest },
                busy === 'search' ? h('span', { className: 'dfs-spin' }) : null,
                busy === 'search' ? t('searching') : t('search'),
              ),
            ),
            test !== null && test.error !== undefined ? h('div', { className: 'dfs-msg', 'data-tone': 'err' }, test.error) : null,
            test !== null && Array.isArray(test.sources)
              ? h(
                  Fragment,
                  null,
                  h(
                    'div',
                    { className: 'dfs-toolbar' },
                    h(Pill, { tone: 'brand' }, `${t('engineFallback')}: ${test.engine ?? '—'}`),
                    h(Pill, null, fmt(t('totalMs'), { n: test.ms })),
                    h(Pill, null, `${test.sources.length} / ${test.maxResults}`),
                    test.cached ? h(Pill, { tone: 'warn' }, t('cachedResult')) : null,
                  ),
                  h(SourceList, { sources: test.sources, t }),
                  h(
                    'div',
                    { className: 'dfs-attempts' },
                    (test.attempts ?? []).map((attempt, index) =>
                      h(Pill, { key: `${attempt.engine}-${index}`, tone: attempt.ok ? 'ok' : 'warn' }, `${attempt.engine} ${attempt.ok ? `${attempt.count} · ${attempt.ms}ms` : '×'}`),
                    ),
                  ),
                )
              : null,
          ),

          /* engine list */
          h(
            Card,
            {
              title: t('engines'),
              hint: t('enginesHint'),
              right: h(
                'div',
                { className: 'dfs-toolbar' },
                h(
                  'button',
                  { type: 'button', className: 'dfs-btn', 'data-size': 'sm', disabled: busy === 'probe', onClick: () => probe(status.engines.map((engine) => engine.id)) },
                  busy === 'probe' ? h('span', { className: 'dfs-spin' }) : null,
                  busy === 'probe' ? t('probing') : t('probeAll'),
                ),
              ),
            },
            h(
              'div',
              { className: 'dfs-engines' },
              order.map((id, index) => {
                const engine = enginesById.get(id);
                const probeResult = probes[id];
                const state = healthState(engine.health, probeResult);
                const on = draft.enabled[id] !== false;
                const keyMeta = status.keys?.[id];
                // `keyOptional` engines (tavily, exa) run keyless on an anonymous
                // quota, so they still get a key control — it is an upgrade,
                // not a requirement, and the row never blocks without one.
                const keyed = engine.needsKey === true || engine.keyOptional === true || engine.custom === true;
                const blocked = engine.needsKey === true && keyMeta?.configured !== true;
                const open = expandedEngines[id] === true;
                // Key state is the one thing worth seeing without expanding; when
                // the row is open the key editor below already shows it.
                const keyChip =
                  open || !keyed || engine.custom === true
                    ? null
                    : keyMeta?.configured === true
                      ? h(Pill, { tone: 'ok' }, t('keyReady'))
                      : engine.keyOptional === true
                        ? h(Pill, { tone: 'neutral' }, t('keyOptionalShort'))
                        : blocked
                          ? h(Pill, { tone: 'warn' }, t('keyNeeded'))
                          : null;
                return h(
                  'div',
                  { key: id, className: 'dfs-engine', 'data-active': draft.primary === id, 'data-off': !on || blocked, 'data-open': open },
                  h(
                    'div',
                    { className: 'dfs-engineHead' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dfs-engineToggle',
                        'aria-expanded': open,
                        title: open ? t('collapseEngine') : t('expandEngine'),
                        onClick: () => toggleEngine(id),
                      },
                      h('span', { className: 'dfs-dot', 'data-state': blocked ? 'idle' : state === 'idle' ? 'idle' : state }),
                      h(
                        'span',
                        { className: 'dfs-engineName' },
                        h('span', { className: 'dfs-engineLabel', title: engine.label }, engine.label),
                        h(Pill, { tone: engine.needsKey === true ? 'warn' : 'ok' }, engine.badge),
                        draft.primary === id ? h(Pill, { tone: 'brand' }, t('primaryLabel')) : null,
                        on ? null : h(Pill, { tone: 'neutral' }, t('disabledLabel')),
                        keyChip,
                      ),
                      h('span', { className: 'dfs-engineMeta' }, healthMeta(t, engine.health, probeResult)),
                    ),
                    // Reorder / primary / test live on the main row: they are the
                    // actions you reach for repeatedly, and hiding them behind an
                    // expand made the list feel inert. Only the details (note,
                    // health text, key editor) stay behind the toggle.
                    h(
                      'div',
                      { className: 'dfs-engineActions' },
                      h(
                        'button',
                        { type: 'button', className: 'dfs-btn', 'data-variant': 'ghost', 'data-size': 'sm', title: t('moveUp'), disabled: index === 0, onClick: () => move(index, -1) },
                        '↑',
                      ),
                      h(
                        'button',
                        { type: 'button', className: 'dfs-btn', 'data-variant': 'ghost', 'data-size': 'sm', title: t('moveDown'), disabled: index === order.length - 1, onClick: () => move(index, 1) },
                        '↓',
                      ),
                      on && draft.primary !== id
                        ? h(
                            'button',
                            {
                              type: 'button',
                              className: 'dfs-btn dfs-primaryBtn',
                              'data-size': 'sm',
                              title: t('setPrimary'),
                              'aria-label': t('setPrimary'),
                              onClick: () => patch({ primary: id }),
                            },
                            '★',
                          )
                        : null,
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dfs-btn',
                          'data-size': 'sm',
                          disabled: probeBusy[id] === true,
                          onClick: () => probe([id]),
                        },
                        probeBusy[id] === true ? h('span', { className: 'dfs-spin' }) : null,
                        probeBusy[id] === true ? t('testing') : t('testOne'),
                      ),
                    ),
                    // The switch sits outside the toggle so flipping it never
                    // expands or collapses the row.
                    h(Switch, { on, title: on ? t('disableAction') : t('enabled'), onToggle: () => patch({ enabled: { ...draft.enabled, [id]: !on } }) }),
                  ),
                  open
                    ? h(
                        'div',
                        { className: 'dfs-engineBody' },
                        h('div', { className: 'dfs-engineNote' }, engine.note),
                        h('div', { className: 'dfs-engineNote' }, blocked ? t('keyNeeded') : healthLabel(t, engine.health, probeResult)),
                        // Keyed built-ins get their key control right where the
                        // engine is configured; custom engines manage theirs in
                        // the custom-engine card below.
                        keyed && engine.custom !== true
                          ? h(KeyEditor, {
                              t,
                              id,
                              meta: keyMeta,
                              busy: busy === 'save',
                              onSave: (engineId, value) => writeKey(engineId, value),
                              onClear: (engineId) => writeKey(engineId, ''),
                            })
                          : null,
                      )
                    : null,
                );
              }),
            ),
            h('p', { className: 'dfs-note' }, t('enginesRemovalHint')),
            h('p', { className: 'dfs-note' }, t('enginesExpandHint')),
          ),

          /* custom engines */
          h(CustomEnginePanel, {
            t,
            status,
            draft,
            patch,
            save,
            busy,
            setMessage,
            query,
          }),

          /* settings */
          h(
            Card,
            {
              title: t('save'),
              hint: status.storeFile,
              right: h(
                'button',
                { type: 'button', className: 'dfs-btn', 'data-size': 'sm', onClick: () => setAdvanced((value) => !value) },
                t('advanced'),
              ),
            },
            h(
              'div',
              { className: 'dfs-grid' },
              h(Field, { label: t('primaryLabel') }, Select({
                value: draft.primary,
                onChange: (value) => patch({ primary: value }),
                options: order
                  .filter((id) => draft.enabled[id] !== false && enginesById.get(id)?.usable !== false)
                  .map((id) => ({ value: id, label: enginesById.get(id).label })),
              })),
              h(Field, { label: t('depthLabel') }, Select({
                value: draft.depth,
                onChange: (value) => patch({ depth: value }),
                options: DEPTHS.map((depth) => ({ value: depth, label: t(depth === 'fast' ? 'depthFast' : depth === 'balanced' ? 'depthBalanced' : 'depthDeep') })),
              })),
              h(Field, { label: t('maxResultsLabel') }, NumberField({ value: draft.maxResults, min: 1, max: 25, onChange: (value) => patch({ maxResults: value }) })),
              h(Field, { label: t('timeoutLabel') }, NumberField({ value: draft.timeoutMs, min: 2000, max: 60000, step: 500, onChange: (value) => patch({ timeoutMs: value }) })),
              h(Field, { label: t('cacheLabel') }, NumberField({ value: Math.round(draft.cacheTtlMs / 1000), min: 0, max: 86400, step: 30, onChange: (value) => patch({ cacheTtlMs: value * 1000 }) })),
              h(Field, { label: t('regionLabel') }, Select({
                value: draft.region,
                onChange: (value) => patch({ region: value }),
                options: [
                  { value: 'zh-CN', label: 'zh-CN 中国' },
                  { value: 'zh-TW', label: 'zh-TW 台灣' },
                  { value: 'en', label: 'en-US Global' },
                ],
              })),
              h(Field, { label: t('langLabel') }, Select({
                value: draft.lang,
                onChange: (value) => patch({ lang: value }),
                options: [
                  { value: 'zh', label: '中文' },
                  { value: 'en', label: 'English' },
                ],
              })),
              advanced
                ? h(Field, { label: t('minResultsLabel') }, NumberField({ value: draft.minResults, min: 1, max: 25, onChange: (value) => patch({ minResults: value }) }))
                : null,
              advanced
                ? h(Field, { label: t('cooldownLabel') }, NumberField({ value: Math.round(draft.cooldownMs / 1000), min: 0, max: 86400, step: 60, onChange: (value) => patch({ cooldownMs: value * 1000 }) }))
                : null,
              advanced
                ? h(Field, { label: t('deepEnginesLabel') }, NumberField({ value: draft.deepEngines, min: 1, max: 6, onChange: (value) => patch({ deepEngines: value }) }))
                : null,
            ),
            h(
              'div',
              { className: 'dfs-toolbar' },
              h(
                'button',
                { type: 'button', className: 'dfs-btn', 'data-variant': dirty ? 'primary' : undefined, disabled: busy === 'save' || !dirty, onClick: () => save() },
                busy === 'save' ? h('span', { className: 'dfs-spin' }) : null,
                busy === 'save' ? t('saving') : t('save'),
              ),
              // Order / primary / enabled / limits all land in the draft first, so
              // say so instead of letting a reorder look already applied.
              dirty ? h(Pill, { tone: 'warn' }, t('unsaved')) : null,
              h(
                'button',
                {
                  type: 'button',
                  className: 'dfs-btn',
                  disabled: busy === 'save',
                  onClick: () => {
                    const defaults = {
                      primary: 'bing',
                      order: ['bing', 'baidu', 'so360', 'bing-web', 'duckduckgo', 'searxng', 'wikipedia', 'mojeek'],
                      enabled: {},
                      maxResults: 8,
                      minResults: 3,
                      timeoutMs: 12000,
                      cacheTtlMs: 300000,
                      cooldownMs: 600000,
                      depth: 'balanced',
                      region: 'zh-CN',
                      lang: 'zh',
                      deepEngines: 3,
                      includeContent: true,
                    };
                    setDraft(defaults);
                    save(defaults);
                  },
                },
                t('reset'),
              ),
              h('label', { className: 'dfs-label' }, h(Switch, {
                on: draft.includeContent !== false,
                title: t('includeContentLabel'),
                onToggle: () => patch({ includeContent: draft.includeContent === false }),
              }), t('includeContentLabel')),
            ),
            message !== null ? h('div', { className: 'dfs-msg', 'data-tone': message.tone }, message.text) : null,
          ),

          h('p', { className: 'dfs-note' }, `${t('storeFile')}: `, h('span', { className: 'dfs-code' }, status.storeFile)),
        ),
      );
    }

    /* ------------------------------------------------------------------ */
    /* Conversation card for the free_search tool                         */
    /* ------------------------------------------------------------------ */

    function parseArgs(raw) {
      if (typeof raw !== 'string' || raw === '') return {};
      try {
        const parsed = JSON.parse(raw);
        return parsed !== null && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    }

    function FreeSearchRow(props) {
      const t = props.t;
      const phase = props.phase;
      const block = props.block ?? {};
      const args = useMemo(() => parseArgs(typeof block.call?.argsRaw === 'string' ? block.call.argsRaw : block.argsRaw), [block.call?.argsRaw, block.argsRaw]);
      const meta = phase === 'preparing' || phase === 'start' ? null : block.meta ?? null;
      const sources = Array.isArray(meta?.sources) ? meta.sources : [];
      const query = typeof args.query === 'string' && args.query !== '' ? args.query : (typeof meta?.query === 'string' ? meta.query : '');
      const failed = phase === 'result' && (block.isError === true || block.error !== undefined);

      return h(
        'div',
        { className: 'dfs-scope', style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        h(
          'div',
          { className: 'dfs-toolbar' },
          h(Pill, { tone: 'brand' }, '🔍 free_search'),
          query !== '' ? h(Pill, null, query.length > 48 ? `${query.slice(0, 46)}…` : query) : null,
          phase === 'preparing' ? h(Pill, null, h('span', { className: 'dfs-spin' }), 'preparing') : null,
          phase === 'start' ? h(Pill, null, h('span', { className: 'dfs-spin' }), 'searching…') : null,
          meta?.engine !== undefined ? h(Pill, { tone: 'ok' }, meta.engine) : null,
          meta?.depth !== undefined ? h(Pill, null, meta.depth) : null,
          Number.isFinite(meta?.ms) ? h(Pill, null, `${meta.ms} ms`) : null,
          Number.isFinite(meta?.sources?.length) ? h(Pill, null, `${sources.length} / ${meta.maxResults ?? '?'}`) : null,
          meta?.cached === true ? h(Pill, { tone: 'warn' }, t('cachedResult')) : null,
          meta?.coalesced === true ? h(Pill, { tone: 'brand' }, t('coalescedResult')) : null,
          typeof meta?.recency === 'string' ? h(Pill, { tone: meta.recencyUnmet === true ? 'warn' : 'neutral' }, `${t('recencyLabel')}: ${meta.recency}${meta.recencyUnmet === true ? ' (未生效)' : ''}`) : null,
        ),
        failed ? h('p', { className: 'dfs-note', style: { color: 'var(--dfs-err)' } }, String(block.error?.code ?? block.error?.name ?? 'failed')) : null,
        phase === 'result' && sources.length > 0 ? h(SourceList, { sources, t }) : null,
        Array.isArray(meta?.attempts) && meta.attempts.length > 1
          ? h(
              'div',
              { className: 'dfs-attempts' },
              meta.attempts.map((attempt, index) =>
                h(Pill, { key: `${attempt.engine}-${index}`, tone: attempt.ok ? 'ok' : 'warn' }, `${attempt.engine} ${attempt.ok ? `${attempt.count}·${attempt.ms}ms` : '×'}`),
              ),
            )
          : null,
      );
    }

    /* ------------------------------------------------------------------ */
    /* Plugin body                                                        */
    /* ------------------------------------------------------------------ */

    const name = NS;
    const inject = ['slots', 'locale'];

    function apply(ctx) {
      ensureStyles();

      let translate = (key) => key;
      try {
        ctx.effect(
          () =>
            ctx.locale.register(NS, {
              zh: DICT_ZH,
              en: DICT_EN,
            }),
          'dsh-keyless-search: dictionaries',
        );
        translate = ctx.locale.bind(NS);
      } catch (error) {
        console.warn(`[${NS}] locale registration failed, falling back to Chinese copy:`, error);
      }

      const settingsRender = () => h(Boundary, { fallback: 'settings' }, h(SettingsPage, { t: translate }));
      const toolRender = (ownerProps) => h(Boundary, { fallback: 'free_search' }, h(FreeSearchRow, { ...ownerProps, t: translate }));

      try {
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'keyless-search',
              order: 45,
              label: () => translate('nav'),
              locale: NS,
            },
            settingsRender,
          ),
        );
        console.log(`[${NS}] settings section registered`);
      } catch (error) {
        console.warn(`[${NS}] settings.section registration failed:`, error);
      }

      try {
        ctx.slots.inject('tool.call.toolview', () =>
          ctx.slots.register({ name: 'tool.call.toolview', key: TOOL, locale: NS }, toolRender),
        );
        console.log(`[${NS}] tool card registered for "${TOOL}"`);
      } catch (error) {
        console.warn(`[${NS}] tool.call.toolview registration failed:`, error);
      }

    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});