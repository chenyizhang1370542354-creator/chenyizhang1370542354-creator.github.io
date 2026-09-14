(() => {
  'use strict';

  const STORE_KEY = 'medresearch_state_v1';
  const SCREEN_REASONS = ['人群不符合','暴露/干预不符合','结局不符合','非原始研究','动物研究','病例报告','无相关数据','其他'];
  const FULL_REASONS = ['研究对象不符合','研究设计不符合','结局指标不符合','数据不可获得','非目标全文','重复发表','其他'];
  const NAV = [
    ['home','⌂','我的项目'],['criteria','◇','项目方案'],['import','⇧','导入文献'],['library','▥','文献库'],['dedup','◎','重复复核'],['screen','✓','题名初筛'],
    ['fulltext','▤','全文筛选'],['evidence','▦','证据矩阵'],['prisma','↳','PRISMA'],['export','⇩','导出备份']
  ];
  const MOBILE = ['home','import','library','screen','evidence','export'];
  const TITLES = Object.fromEntries(NAV.map(x => [x[0], x[2]]));
  let route = (location.hash || '#home').slice(1);
  let state = loadState();
  let libraryQuery = '';
  let libraryFilter = 'all';

  const app = document.querySelector('#app');
  const pageTitle = document.querySelector('#pageTitle');
  const switcher = document.querySelector('#projectSwitcher');
  const installButton = document.querySelector('#installButton');
  const restoreInput = document.querySelector('#restoreInput');
  let deferredInstallPrompt = null;

  function uid(prefix='id') { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`; }
  function esc(v='') { return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function csvCell(v='') { const s=String(v??''); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; }
  function normalizeTitle(v='') { return v.toLowerCase().replace(/<[^>]*>/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ').trim(); }
  function normalizeDoi(v='') { return v.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//,'').replace(/^doi:\s*/,'').trim().replace(/[\s.;]+$/,''); }
  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {version:1,projects:[],activeId:null}; }
    catch { return {version:1,projects:[],activeId:null}; }
  }
  function saveState() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  function activeProject() { return state.projects.find(p => p.id === state.activeId) || null; }
  function go(next) { route = next; location.hash = next; render(); }
  function toast(msg) { const el=document.querySelector('#toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove('show'),2200); }
  function fmtDate(v) { try { return new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium'}).format(new Date(v)); } catch { return ''; } }
  function statusLabel(v) { return ({pending:'未处理',include:'纳入',exclude:'排除',maybe:'待定'})[v] || '未处理'; }

  function counts(p) {
    const all=p?.records||[]; const usable=all.filter(r=>!r.isDuplicate); const full=usable.filter(r=>['include','maybe'].includes(r.screening));
    return {
      total:all.length, duplicates:all.filter(r=>r.isDuplicate).length, deduped:usable.length,
      screened:usable.filter(r=>r.screening && r.screening!=='pending').length,
      screenExcluded:usable.filter(r=>r.screening==='exclude').length, fullAssessed:full.length,
      fullDone:full.filter(r=>r.fullText && r.fullText!=='pending').length,
      fullExcluded:full.filter(r=>r.fullText==='exclude').length,
      included:full.filter(r=>r.fullText==='include').length
    };
  }
  function progress(p) {
    const c=counts(p); if(!c.total) return 5; if(c.screened<c.deduped) return 35+Math.round(25*c.screened/Math.max(1,c.deduped));
    if(c.fullDone<c.fullAssessed) return 65+Math.round(20*c.fullDone/Math.max(1,c.fullAssessed)); return c.included?95:85;
  }

  function renderNav() {
    const item = ([id,icon,label], mobile=false) => `<button class="nav-btn ${route===id?'active':''}" data-route="${id}"><span class="nav-icon">${icon}</span><span>${label}</span></button>`;
    document.querySelector('#desktopNav').innerHTML = NAV.map(x=>item(x)).join('');
    document.querySelector('#mobileNav').innerHTML = NAV.filter(x=>MOBILE.includes(x[0])).map(x=>item(x,true)).join('');
  }
  function render() {
    const p=activeProject(); renderNav(); pageTitle.textContent=TITLES[route]||'研迹'; switcher.textContent=p?p.name:'尚未创建项目';
    if(route!=='home'&&!p){ app.innerHTML=noProject(); return; }
    const views={home:renderHome,criteria:renderCriteria,import:renderImport,library:renderLibrary,dedup:renderDedup,screen:renderScreen,fulltext:renderFulltext,evidence:renderEvidence,prisma:renderPrisma,export:renderExport};
    app.innerHTML=(views[route]||renderHome)(p);
    if(route==='prisma') app.insertAdjacentHTML('afterbegin','<div class="section-head"><span class="muted tiny">可打印或另存为 PDF 留档</span><button class="btn ghost small" data-action="print">打印 / 保存 PDF</button></div>');
    bindDropzone();
    bindLibrary();
  }
  function noProject(){return `<div class="card empty"><div class="empty-mark">＋</div><h2>先创建一个科研项目</h2><p>项目会把导入、去重、筛选、PRISMA 和证据提取连成一条线。</p><div class="btn-row" style="justify-content:center"><button class="btn" data-action="new-project">新建项目</button><button class="btn secondary" data-action="load-demo">载入示例</button></div></div>`}

  function renderHome(p) {
    if(!p) return `<div class="card hero-card"><div><span class="tag">本地保存 · 手机电脑通用</span><h2>把散乱的文献，变成可追踪的证据链。</h2><p>导入数据库记录，复核重复文献，完成题名摘要与全文筛选，自动核对 PRISMA 数字，最后形成证据矩阵。</p><div class="btn-row"><button class="btn" data-action="new-project">新建我的综述项目</button><button class="btn secondary" data-action="load-demo">先看示例项目</button></div></div><div class="hero-steps"><div class="step-chip"><span>01</span>导入与去重</div><div class="step-chip"><span>02</span>题名摘要筛选</div><div class="step-chip"><span>03</span>全文筛选</div><div class="step-chip"><span>04</span>证据提取与导出</div></div></div>`;
    const c=counts(p), pct=progress(p);
    const next=c.total===0?'导入第一批文献':c.screened<c.deduped?`继续题名摘要筛选（剩 ${c.deduped-c.screened} 篇）`:c.fullDone<c.fullAssessed?`继续全文筛选（剩 ${c.fullAssessed-c.fullDone} 篇）`:'整理证据矩阵并导出';
    const nextRoute=c.total===0?'import':c.screened<c.deduped?'screen':c.fullDone<c.fullAssessed?'fulltext':'evidence';
    return `<div class="grid four"><div class="card stat-card"><span>原始记录</span><strong>${c.total}</strong></div><div class="card stat-card"><span>去重后</span><strong>${c.deduped}</strong></div><div class="card stat-card"><span>已完成初筛</span><strong>${c.screened}</strong></div><div class="card stat-card"><span>最终纳入</span><strong>${c.included}</strong></div></div>
      <div class="section-head"><h2>当前项目</h2><button class="btn ghost small" data-action="new-project">＋ 新建项目</button></div>
      <div class="card project-card"><div><span class="tag">${esc(p.type)}</span><h3>${esc(p.name)}</h3><p>${esc(p.question||'尚未填写研究问题')}</p><div class="progress"><i style="width:${pct}%"></i></div><p class="tiny" style="margin-top:7px">整体进度约 ${pct}% · 创建于 ${fmtDate(p.createdAt)}</p></div><div><p class="tiny muted">你现在应该做</p><button class="btn" data-route="${nextRoute}">${next} →</button></div></div>
      <div class="section-head"><h2>完整路线</h2></div><div class="grid four">${[['导入文献',c.total>0],['重复复核',c.total>0],['题名初筛',c.screened===c.deduped&&c.deduped>0],['全文筛选',c.fullDone===c.fullAssessed&&c.fullAssessed>0],['证据矩阵',c.included>0],['PRISMA核对',c.screened>0],['导出备份',c.total>0]].map(([x,done],i)=>`<div class="card"><span class="tag ${done?'':'amber'}">${done?'已就绪':'待完成'}</span><p><strong>${String(i+1).padStart(2,'0')} ${x}</strong></p></div>`).join('')}</div>`;
  }

  function renderImport(p) {
    const sources={}; p.records.forEach(r=>sources[r.source||'未知来源']=(sources[r.source||'未知来源']||0)+1);
    return `<div class="card dropzone" id="dropzone"><div class="empty-mark">⇧</div><h2>把数据库导出的文件拖到这里</h2><p>支持 PubMed NBIB、Embase / WOS CSV、RIS 和 BibTeX；可一次选择多个文件。</p><input class="file-input" id="fileInput" type="file" multiple accept=".csv,.ris,.nbib,.bib,.txt"><button class="btn" data-action="pick-files">选择文献文件</button></div>
      <div class="section-head"><h2>已经导入</h2><span class="muted tiny">共 ${p.records.length} 条原始记录</span></div><div class="card">${Object.keys(sources).length?`<div class="source-list">${Object.entries(sources).map(([s,n])=>`<div class="source-row"><span>${esc(s)}</span><strong>${n} 篇</strong></div>`).join('')}</div>`:`<div class="empty"><p>还没有记录。第一次可以先载入示例数据。</p><div class="btn-row" style="justify-content:center"><button class="btn secondary" data-action="load-demo-records">载入示例文献</button></div></div>`}</div>`;
  }

  function renderCriteria(p) {
    const c=p.criteria||{};
    return `<div class="card"><form class="form-grid" data-form="criteria"><div class="field full"><label>研究问题</label><textarea name="question" placeholder="建议写清研究对象、指标/暴露和结局">${esc(p.question||'')}</textarea></div><div class="field full"><label>纳入标准</label><textarea name="inclusion" placeholder="例如：成人 aSAH；检测脑脊液标志物；报告 DCI、脑积水或功能预后">${esc(c.inclusion||'')}</textarea></div><div class="field full"><label>排除标准</label><textarea name="exclusion" placeholder="例如：动物研究；病例报告；无脑脊液检测；非原始研究">${esc(c.exclusion||'')}</textarea></div><div class="field"><label>自定义初筛排除原因（逗号分隔）</label><input name="screenReasons" value="${esc(c.screenReasons||'')}"></div><div class="field"><label>自定义全文排除原因（逗号分隔）</label><input name="fullReasons" value="${esc(c.fullReasons||'')}"></div><div class="field full"><label>研究备注</label><textarea name="notes" placeholder="记录检索日期、方案变更、导师意见等">${esc(c.notes||'')}</textarea></div><div class="field full"><button class="btn" type="submit">保存项目方案</button></div></form></div>`;
  }

  function libraryRows(p) {
    const q=normalizeTitle(libraryQuery);
    const rows=p.records.filter(r=>{
      const hay=normalizeTitle(`${r.title} ${r.authors} ${r.doi} ${r.source}`);
      const matchesText=!q||hay.includes(q);
      const matchesStatus=libraryFilter==='all'||(libraryFilter==='duplicate'?r.isDuplicate:r.screening===libraryFilter);
      return matchesText&&matchesStatus;
    });
    if(!rows.length)return `<tr><td colspan="7" class="muted">没有符合条件的记录。</td></tr>`;
    return rows.map(r=>`<tr><td><strong>${esc(r.title||'无题名')}</strong><br><span class="tiny muted">${esc(r.doi||'无 DOI')}</span></td><td>${esc(r.authors||'—')}</td><td>${esc(r.year||'—')}</td><td>${esc(r.source||'—')}</td><td><span class="tag ${r.screening==='exclude'?'red':r.screening==='maybe'?'amber':''}">${r.isDuplicate?'疑似重复':statusLabel(r.screening)}</span></td><td>${statusLabel(r.fullText)}</td><td><button class="btn ghost small" data-action="edit-record" data-id="${r.id}">查看 / 修改</button></td></tr>`).join('');
  }

  function renderLibrary(p) {
    return `<div class="card library-tools"><div class="field"><label>搜索题名、作者、DOI 或来源</label><input id="librarySearch" value="${esc(libraryQuery)}" placeholder="输入关键词"></div><div class="field"><label>筛选状态</label><select id="libraryFilter"><option value="all">全部记录</option><option value="pending">未处理</option><option value="include">初筛纳入</option><option value="maybe">初筛待定</option><option value="exclude">初筛排除</option><option value="duplicate">疑似重复</option></select></div></div><div class="section-head"><h2>文献总表</h2><span class="tag">${p.records.length} 条记录</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>文献</th><th>作者</th><th>年份</th><th>来源</th><th>初筛状态</th><th>全文状态</th><th>操作</th></tr></thead><tbody id="libraryBody">${libraryRows(p)}</tbody></table></div>`;
  }

  function bindLibrary(){const q=document.querySelector('#librarySearch'),f=document.querySelector('#libraryFilter');if(!q||!f)return;f.value=libraryFilter;const update=()=>{libraryQuery=q.value;libraryFilter=f.value;document.querySelector('#libraryBody').innerHTML=libraryRows(activeProject())};q.addEventListener('input',update);f.addEventListener('change',update)}

  function renderDedup(p) {
    const dups=p.records.filter(r=>r.isDuplicate), c=counts(p);
    return `<div class="grid three"><div class="card stat-card"><span>原始记录</span><strong>${c.total}</strong></div><div class="card stat-card"><span>疑似重复</span><strong>${c.duplicates}</strong></div><div class="card stat-card"><span>当前保留</span><strong>${c.deduped}</strong></div></div><div class="section-head"><h2>重复文献人工复核</h2><span class="muted tiny">系统按 DOI 优先、标准化题名其次判断</span></div><div class="card">${dups.length?dups.map(r=>{const base=p.records.find(x=>x.id===r.duplicateOf);return `<div class="dup-row"><div><span class="tag red">疑似重复</span><p><strong>${esc(r.title||'无题名')}</strong></p><p class="tiny muted">与“${esc(base?.title||'另一条记录')}”重复 · ${esc(r.duplicateReason||'题名一致')}</p></div><button class="btn ghost small" data-action="keep-duplicate" data-id="${r.id}">两条都保留</button></div>`}).join(''):`<div class="empty"><div class="empty-mark">✓</div><h2>没有待复核的重复记录</h2><p>新导入的记录会自动在这里显示。</p></div>`}</div>`;
  }

  function renderScreen(p) {
    const items=p.records.filter(r=>!r.isDuplicate), current=items.find(r=>!r.screening||r.screening==='pending'), done=items.filter(r=>r.screening&&r.screening!=='pending').length;
    if(!items.length) return noRecords('还没有可筛选的文献','先导入文件或载入示例文献。','import');
    if(!current) return `<div class="card empty"><div class="empty-mark">✓</div><h2>题名摘要筛选已完成</h2><p>已处理 ${done} 篇。现在可以进入全文筛选。</p><div class="btn-row" style="justify-content:center"><button class="btn" data-route="fulltext">进入全文筛选</button>${p.history?.length?'<button class="btn secondary" data-action="undo">撤销上一步</button>':''}<button class="btn ghost" data-action="reset-screening">重新筛选</button></div></div>`;
    return `<div class="queue-head"><span class="tag">题名 / 摘要</span><div class="btn-row" style="margin:0"><span class="queue-progress">${done+1} / ${items.length}</span>${p.history?.length?'<button class="btn ghost small" data-action="undo">↶ 撤销</button>':''}</div></div><div class="progress" style="margin-bottom:14px"><i style="width:${Math.round(done*100/items.length)}%"></i></div><article class="card record-card"><div class="record-meta"><span>${esc(current.authors||'作者未知')}</span><span>${esc(current.year||'年份未知')}</span><span>${esc(current.source||'来源未知')}</span>${current.doi?`<span>DOI: ${esc(current.doi)}</span>`:''}</div><h2>${esc(current.title||'无题名记录')}</h2><div class="abstract">${esc(current.abstract||'这条记录没有摘要。可根据题名先标记为“待定”，全文阶段再判断。')}</div><div class="screen-actions"><button class="btn" data-action="screen" data-id="${current.id}" data-value="include">✓ 纳入</button><button class="btn amber" data-action="screen" data-id="${current.id}" data-value="maybe">? 待定</button><button class="btn danger" data-action="screen-exclude" data-id="${current.id}">× 排除</button></div></article>`;
  }

  function renderFulltext(p) {
    const items=p.records.filter(r=>!r.isDuplicate&&['include','maybe'].includes(r.screening)), current=items.find(r=>!r.fullText||r.fullText==='pending'), done=items.filter(r=>r.fullText&&r.fullText!=='pending').length;
    if(!items.length) return noRecords('暂时没有进入全文筛选的文献','先完成题名摘要筛选，并至少纳入或待定一篇。','screen');
    if(!current) return `<div class="card empty"><div class="empty-mark">✓</div><h2>全文筛选已完成</h2><p>共评估 ${items.length} 篇，最终纳入 ${items.filter(r=>r.fullText==='include').length} 篇。</p><div class="btn-row" style="justify-content:center"><button class="btn" data-route="evidence">填写证据矩阵</button>${p.history?.length?'<button class="btn secondary" data-action="undo">撤销上一步</button>':''}<button class="btn ghost" data-action="reset-fulltext">重新筛选</button></div></div>`;
    return `<div class="queue-head"><span class="tag">全文评估</span><div class="btn-row" style="margin:0"><span class="queue-progress">${done+1} / ${items.length}</span>${p.history?.length?'<button class="btn ghost small" data-action="undo">↶ 撤销</button>':''}</div></div><div class="progress" style="margin-bottom:14px"><i style="width:${Math.round(done*100/items.length)}%"></i></div><article class="card record-card"><div class="record-meta"><span>${esc(current.authors||'作者未知')}</span><span>${esc(current.year||'年份未知')}</span><span>${esc(current.source||'来源未知')}</span></div><h2>${esc(current.title||'无题名记录')}</h2><div class="abstract"><strong>初筛判断：</strong>${statusLabel(current.screening)}${current.screenReason?`（${esc(current.screenReason)}）`:''}<br><br>${esc(current.abstract||'无摘要。请查看你保存的论文全文后作出最终判断。')}</div><div class="screen-actions" style="grid-template-columns:1fr 1fr"><button class="btn" data-action="fulltext" data-id="${current.id}" data-value="include">✓ 最终纳入</button><button class="btn danger" data-action="fulltext-exclude" data-id="${current.id}">× 排除并记录原因</button></div></article>`;
  }

  function renderEvidence(p) {
    const items=p.records.filter(r=>!r.isDuplicate&&r.fullText==='include');
    if(!items.length) return noRecords('还没有最终纳入的研究','先完成全文筛选。','fulltext');
    return `<div class="section-head"><h2>最终纳入研究</h2><span class="tag">${items.length} 篇</span></div><div class="grid">${items.map(r=>{const e=r.evidence||{};return `<details class="card evidence-edit"><summary>${esc(r.authors||'作者未知')} ${esc(r.year||'')} · ${esc(r.title||'无题名')}</summary><form class="form-grid evidence-form" data-form="evidence" data-id="${r.id}"><div class="field"><label>国家 / 地区</label><input name="country" value="${esc(e.country||'')}"></div><div class="field"><label>研究设计</label><input name="design" value="${esc(e.design||'')}" placeholder="如：前瞻性队列研究"></div><div class="field"><label>样本量</label><input name="sample" value="${esc(e.sample||'')}"></div><div class="field"><label>研究对象</label><input name="population" value="${esc(e.population||'')}"></div><div class="field"><label>检测指标 / 标志物</label><input name="biomarker" value="${esc(e.biomarker||'')}"></div><div class="field"><label>主要结局</label><input name="outcome" value="${esc(e.outcome||'')}"></div><div class="field"><label>质量评价工具</label><input name="qualityTool" value="${esc(e.qualityTool||'')}" placeholder="如：QUIPS、NOS、RoB 2"></div><div class="field"><label>总体质量 / 偏倚风险</label><select name="qualityRating"><option value="">未评价</option><option ${e.qualityRating==='低风险/高质量'?'selected':''}>低风险/高质量</option><option ${e.qualityRating==='中等风险/一般质量'?'selected':''}>中等风险/一般质量</option><option ${e.qualityRating==='高风险/低质量'?'selected':''}>高风险/低质量</option><option ${e.qualityRating==='信息不足'?'selected':''}>信息不足</option></select></div><div class="field full"><label>质量评价备注</label><textarea name="qualityNotes">${esc(e.qualityNotes||'')}</textarea></div><div class="field full"><label>核心结果</label><textarea name="result">${esc(e.result||'')}</textarea></div><div class="field full"><label>研究局限</label><textarea name="limitations">${esc(e.limitations||'')}</textarea></div><div class="field full"><label>主题标签（用逗号分隔）</label><input name="tags" value="${esc(e.tags||'')}" placeholder="炎症, DCI, IL-6"></div><div class="field full"><button class="btn" type="submit">保存这篇证据</button></div></form></details>`}).join('')}</div>`;
  }

  function renderPrisma(p) {
    const c=counts(p), reasons={}; p.records.filter(r=>r.fullText==='exclude').forEach(r=>reasons[r.fullReason||'未记录']=(reasons[r.fullReason||'未记录']||0)+1); const max=Math.max(1,...Object.values(reasons));
    return `<div class="card"><div class="prisma-flow"><div class="prisma-node"><span>数据库检索</span><strong>${c.total}</strong></div><div class="prisma-arrow">→</div><div class="prisma-node"><span>去重后</span><strong>${c.deduped}</strong></div><div class="prisma-arrow">→</div><div class="prisma-node"><span>全文评估</span><strong>${c.fullAssessed}</strong></div><div class="prisma-arrow">→</div><div class="prisma-node"><span>最终纳入</span><strong>${c.included}</strong></div></div></div>
      <div class="section-head"><h2>数字核对</h2><span class="muted tiny">随筛选记录自动更新</span></div><div class="grid three"><div class="card stat-card"><span>删除重复</span><strong>−${c.duplicates}</strong></div><div class="card stat-card"><span>题名摘要排除</span><strong>−${c.screenExcluded}</strong></div><div class="card stat-card"><span>全文排除</span><strong>−${c.fullExcluded}</strong></div></div><div class="section-head"><h2>全文排除原因</h2></div><div class="card reason-bars">${Object.keys(reasons).length?Object.entries(reasons).map(([r,n])=>`<div><div class="reason-label"><span>${esc(r)}</span><strong>${n}</strong></div><div class="reason-bar"><i style="width:${Math.round(n*100/max)}%"></i></div></div>`).join(''):'<p class="muted">还没有全文排除记录。</p>'}</div>`;
  }

  function renderExport(p) {
    return `<div class="export-list"><div class="export-item"><div><h3>全部检索记录 CSV</h3><p>包含题名、DOI、来源与筛选状态</p></div><button class="btn small" data-action="export-records">导出</button></div><div class="export-item"><div><h3>证据矩阵 CSV</h3><p>Excel 可直接打开</p></div><button class="btn small" data-action="export-evidence">导出</button></div><div class="export-item"><div><h3>PRISMA 统计 CSV</h3><p>导出自动计算的数量链</p></div><button class="btn small" data-action="export-prisma">导出</button></div><div class="export-item"><div><h3>AI 分析材料 TXT</h3><p>整理最终纳入研究，便于粘贴分析</p></div><button class="btn small" data-action="export-ai">导出</button></div><div class="export-item"><div><h3>完整项目备份 JSON</h3><p>换电脑或清理浏览器前务必备份</p></div><button class="btn small" data-action="backup">备份</button></div><div class="export-item"><div><h3>恢复项目备份</h3><p>从研迹 JSON 文件恢复</p></div><button class="btn ghost small" data-action="restore">选择文件</button></div></div><div class="card" style="margin-top:16px"><span class="tag amber">重要</span><p class="muted">当前版本不使用账号和云端数据库。网页关闭后数据仍会保存在这个浏览器，但清除浏览器网站数据可能导致丢失。建议每次完成一批筛选后导出项目备份。</p></div>`;
  }
  function noRecords(title,msg,target){return `<div class="card empty"><div class="empty-mark">○</div><h2>${title}</h2><p>${msg}</p><div class="btn-row" style="justify-content:center"><button class="btn" data-route="${target}">前往下一步</button></div></div>`}

  function showModal(html) { const wrap=document.createElement('div'); wrap.className='modal-backdrop'; wrap.innerHTML=`<div class="modal">${html}</div>`; wrap.addEventListener('click',e=>{if(e.target===wrap||e.target.closest('[data-close]'))wrap.remove()}); document.body.append(wrap); return wrap; }
  function newProjectModal() {
    const m=showModal(`<h2>新建科研项目</h2><form data-form="new-project" class="form-grid"><div class="field full"><label>项目名称</label><input name="name" required autofocus placeholder="例如：aSAH 脑脊液标志物系统综述"></div><div class="field"><label>研究类型</label><select name="type"><option>系统综述</option><option>叙述性综述</option><option>Meta分析前期资料整理</option></select></div><div class="field"><label>项目阶段</label><select name="stage"><option>刚开始</option><option>已经检索文献</option><option>正在筛选</option></select></div><div class="field full"><label>研究问题</label><textarea name="question" placeholder="用一句话写清楚研究对象、指标和结局"></textarea></div><div class="field full modal-actions"><button class="btn ghost" type="button" data-close>取消</button><button class="btn" type="submit">创建并开始</button></div></form>`); m.querySelector('input').focus();
  }
  function reasonModal(kind,id) {
    const p=activeProject(), custom=(kind==='screen'?p.criteria?.screenReasons:p.criteria?.fullReasons)||'';
    const reasons=[...(kind==='screen'?SCREEN_REASONS:FULL_REASONS),...custom.split(/[,，]/).map(x=>x.trim()).filter(Boolean)].filter((x,i,a)=>a.indexOf(x)===i);
    showModal(`<h2>请选择排除原因</h2><p class="muted">这条记录会自动进入后续统计。</p><div class="grid">${reasons.map(r=>`<button class="btn ghost" data-action="choose-reason" data-kind="${kind}" data-id="${id}" data-reason="${esc(r)}">${esc(r)}</button>`).join('')}</div>`);
  }
  function recordModal(id) {
    const r=activeProject()?.records.find(x=>x.id===id); if(!r)return;
    showModal(`<h2>查看 / 修改文献</h2><form class="form-grid" data-form="record" data-id="${r.id}"><div class="field full"><label>题名</label><textarea name="title" required>${esc(r.title||'')}</textarea></div><div class="field"><label>作者</label><input name="authors" value="${esc(r.authors||'')}"></div><div class="field"><label>年份</label><input name="year" value="${esc(r.year||'')}"></div><div class="field"><label>DOI</label><input name="doi" value="${esc(r.doi||'')}"></div><div class="field"><label>来源</label><input name="source" value="${esc(r.source||'')}"></div><div class="field full"><label>摘要</label><textarea name="abstract">${esc(r.abstract||'')}</textarea></div><div class="field"><label>初筛结果</label><select name="screening"><option value="pending" ${r.screening==='pending'?'selected':''}>未处理</option><option value="include" ${r.screening==='include'?'selected':''}>纳入</option><option value="maybe" ${r.screening==='maybe'?'selected':''}>待定</option><option value="exclude" ${r.screening==='exclude'?'selected':''}>排除</option></select></div><div class="field"><label>初筛排除原因</label><input name="screenReason" value="${esc(r.screenReason||'')}"></div><div class="field"><label>全文结果</label><select name="fullText"><option value="pending" ${r.fullText==='pending'?'selected':''}>未处理</option><option value="include" ${r.fullText==='include'?'selected':''}>纳入</option><option value="exclude" ${r.fullText==='exclude'?'selected':''}>排除</option></select></div><div class="field"><label>全文排除原因</label><input name="fullReason" value="${esc(r.fullReason||'')}"></div><div class="field full modal-actions"><button class="btn ghost" type="button" data-close>取消</button><button class="btn" type="submit">保存修改</button></div></form>`);
  }
  function projectModal() {
    if(!state.projects.length){newProjectModal();return}
    showModal(`<h2>切换项目</h2><div class="grid">${state.projects.map(p=>`<button class="btn ${p.id===state.activeId?'':'ghost'}" data-action="switch-project" data-id="${p.id}">${esc(p.name)}</button>`).join('')}</div><div class="modal-actions"><button class="btn secondary" data-action="new-project">＋ 新建项目</button><button class="btn ghost" data-close>关闭</button></div>`);
  }

  function createProject(data) {
    const p={id:uid('project'),name:data.name.trim(),type:data.type,stage:data.stage,question:data.question.trim(),createdAt:new Date().toISOString(),criteria:{},history:[],records:[]}; state.projects.unshift(p); state.activeId=p.id; saveState(); document.querySelector('.modal-backdrop')?.remove(); go('import'); toast('项目已创建');
  }
  function remember(p,r){p.history=p.history||[];p.history.push({recordId:r.id,screening:r.screening,screenReason:r.screenReason,fullText:r.fullText,fullReason:r.fullReason});if(p.history.length>50)p.history.shift()}
  function undoLast(p){const h=p.history?.pop();if(!h){toast('没有可以撤销的操作');return}const r=p.records.find(x=>x.id===h.recordId);if(r){r.screening=h.screening;r.screenReason=h.screenReason;r.fullText=h.fullText;r.fullReason=h.fullReason;saveState();render();toast('已撤销上一步')}}
  function demoRecords() { return [
    {title:'Cerebrospinal fluid interleukin-6 after aneurysmal subarachnoid hemorrhage',authors:'Wostrack et al.',year:'2014',abstract:'This prospective cohort study examined serial cerebrospinal fluid interleukin-6 concentrations after aneurysmal subarachnoid hemorrhage and their relationship with delayed cerebral ischemia.',doi:'10.1000/demo.001',source:'示例数据'},
    {title:'Cerebrospinal fluid interleukin-6 after aneurysmal subarachnoid hemorrhage',authors:'Wostrack et al.',year:'2014',abstract:'Duplicate demonstration record exported from another database.',doi:'10.1000/demo.001',source:'示例数据（重复）'},
    {title:'CSF S100B as a marker of neurological injury in subarachnoid hemorrhage',authors:'Smith et al.',year:'2021',abstract:'Cerebrospinal fluid S100B was measured in patients with aneurysmal subarachnoid hemorrhage to explore associations with neurological outcome.',doi:'10.1000/demo.002',source:'示例数据'},
    {title:'Cerebrospinal fluid lactate and delayed cerebral ischemia following aSAH',authors:'Lee et al.',year:'2023',abstract:'The study evaluated whether early CSF lactate levels were associated with delayed cerebral ischemia and functional outcome.',doi:'10.1000/demo.003',source:'示例数据'},
    {title:'Inflammatory signaling after experimental subarachnoid hemorrhage in rats',authors:'Garcia et al.',year:'2020',abstract:'An experimental rat model was used to study inflammatory signaling after subarachnoid hemorrhage.',doi:'10.1000/demo.004',source:'示例数据'},
    {title:'Review of biomarkers after aneurysmal subarachnoid hemorrhage',authors:'Chen et al.',year:'2022',abstract:'A narrative review summarizing blood and cerebrospinal fluid biomarkers after aneurysmal subarachnoid hemorrhage.',doi:'10.1000/demo.005',source:'示例数据'}
  ]; }
  function ensureRecord(r) { return {id:uid('rec'),title:(r.title||'').trim(),authors:(r.authors||'').trim(),year:String(r.year||'').match(/\d{4}/)?.[0]||'',abstract:(r.abstract||'').trim(),doi:normalizeDoi(r.doi||''),source:r.source||'导入文件',screening:'pending',screenReason:'',fullText:'pending',fullReason:'',evidence:{}}; }
  function addRecords(records) {
    const p=activeProject(); if(!p)return; const seen=new Map(); p.records.filter(r=>!r.isDuplicate).forEach(r=>{const key=r.doi?`doi:${normalizeDoi(r.doi)}`:`title:${normalizeTitle(r.title)}`;if(key!=='title:')seen.set(key,r.id)});
    records.map(ensureRecord).forEach(r=>{const key=r.doi?`doi:${r.doi}`:`title:${normalizeTitle(r.title)}`;if(key!=='title:'&&seen.has(key)){r.isDuplicate=true;r.duplicateOf=seen.get(key);r.duplicateReason=r.doi?'DOI 完全一致':'题名一致'}else if(key!=='title:')seen.set(key,r.id);p.records.push(r)}); saveState(); render(); toast(`已加入 ${records.length} 条记录`);
  }
  function loadDemo(withProject=false) {
    if(withProject||!activeProject()) { const p={id:uid('project'),name:'aSAH 脑脊液标志物系统综述（示例）',type:'系统综述',stage:'正在筛选',question:'脑脊液标志物是否能够预测 aSAH 患者的 DCI 和不良预后？',createdAt:new Date().toISOString(),criteria:{inclusion:'aSAH 患者；检测脑脊液标志物；报告临床相关结局',exclusion:'动物研究；病例报告；综述；无脑脊液指标'},history:[],records:[]}; state.projects.unshift(p);state.activeId=p.id; }
    addRecords(demoRecords()); go('dedup');
  }

  function bindDropzone(){const z=document.querySelector('#dropzone');if(!z)return;['dragenter','dragover'].forEach(n=>z.addEventListener(n,e=>{e.preventDefault();z.classList.add('drag')}));['dragleave','drop'].forEach(n=>z.addEventListener(n,e=>{e.preventDefault();z.classList.remove('drag')}));z.addEventListener('drop',e=>importFiles([...e.dataTransfer.files]));document.querySelector('#fileInput')?.addEventListener('change',e=>importFiles([...e.target.files]));}
  async function importFiles(files){if(!files.length)return;let all=[];for(const file of files){const text=await file.text();const ext=file.name.toLowerCase().split('.').pop();let rows=[];if(ext==='csv'||ext==='txt'&&text.includes(','))rows=parseCSV(text);else if(ext==='ris')rows=parseRIS(text);else if(ext==='nbib'||/PMID-/.test(text))rows=parseNBIB(text);else if(ext==='bib')rows=parseBib(text);rows.forEach(r=>r.source=r.source||file.name);all=all.concat(rows)}if(all.length)addRecords(all);else toast('未识别到文献记录，请检查文件格式');}
  function parseCSV(text){const rows=[];let row=[],cell='',q=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'&&q&&text[i+1]==='"'){cell+='"';i++}else if(c==='"')q=!q;else if(c===','&&!q){row.push(cell);cell=''}else if((c==='\n'||c==='\r')&&!q){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell=''}else cell+=c}if(cell||row.length){row.push(cell);rows.push(row)}if(rows.length<2)return[];const h=rows[0].map(x=>x.trim().toLowerCase());const pick=(obj,names)=>{for(const n of names){const i=h.findIndex(x=>x===n||x.includes(n));if(i>=0&&obj[i])return obj[i]}return''};return rows.slice(1).map(r=>({title:pick(r,['title','article title','document title','题名']),authors:pick(r,['authors','author','作者']),year:pick(r,['year','publication year','date','年份']),abstract:pick(r,['abstract','摘要']),doi:pick(r,['doi']),source:pick(r,['database','source database','数据库来源'])})).filter(r=>r.title||r.doi)}
  function parseRIS(text){const out=[];let r={};for(const line of text.split(/\r?\n/)){const m=line.match(/^([A-Z0-9]{2})\s*-\s*(.*)$/);if(!m)continue;const [,tag,val]=m;if(tag==='TY'){if(r.title)out.push(r);r={authors:''}}else if(tag==='TI'||tag==='T1')r.title=val;else if(tag==='AU'||tag==='A1')r.authors+=(r.authors?'; ':'')+val;else if(tag==='AB')r.abstract=(r.abstract?r.abstract+' ':'')+val;else if(tag==='DO')r.doi=val;else if(tag==='PY'||tag==='Y1')r.year=val;else if(tag==='ER'){if(r.title||r.doi)out.push(r);r={authors:''}}}if(r.title||r.doi)out.push(r);return out}
  function parseNBIB(text){const chunks=text.split(/\n\s*\n(?=PMID-)/);return chunks.map(ch=>{const r={authors:''};let last='';for(const line of ch.split(/\r?\n/)){const m=line.match(/^([A-Z]{2,4})\s*-\s*(.*)$/);if(m){last=m[1];const v=m[2];if(last==='TI')r.title=v;else if(last==='AB')r.abstract=v;else if(last==='FAU'||last==='AU')r.authors+=(r.authors?'; ':'')+v;else if(last==='DP')r.year=v;else if(last==='AID'&&/\[doi\]/i.test(v))r.doi=v.replace(/\s*\[doi\].*/i,'')}else if(/^\s+/.test(line)){const v=line.trim();if(last==='TI')r.title=(r.title||'')+' '+v;else if(last==='AB')r.abstract=(r.abstract||'')+' '+v}}return r}).filter(r=>r.title||r.doi)}
  function parseBib(text){const out=[];const entry=/@\w+\s*\{[\s\S]*?\n\}/g;for(const block of text.match(entry)||[]){const val=n=>{const m=block.match(new RegExp(`${n}\\s*=\\s*[\\{\"]([\\s\\S]*?)[\\}\"]\\s*,?`,`i`));return m?m[1].replace(/[{}]/g,'').replace(/\s+/g,' ').trim():''};out.push({title:val('title'),authors:val('author').replace(/\s+and\s+/gi,'; '),year:val('year'),abstract:val('abstract'),doi:val('doi')})}return out.filter(r=>r.title||r.doi)}

  function download(name,content,type='text/plain;charset=utf-8'){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  function exportRecords(){const p=activeProject(),h=['题名','作者','年份','DOI','来源','是否重复','初筛结果','初筛排除原因','全文结果','全文排除原因'];const rows=p.records.map(r=>[r.title,r.authors,r.year,r.doi,r.source,r.isDuplicate?'是':'否',statusLabel(r.screening),r.screenReason,statusLabel(r.fullText),r.fullReason]);download(`${p.name}_全部记录.csv`,'\ufeff'+[h,...rows].map(x=>x.map(csvCell).join(',')).join('\n'),'text/csv;charset=utf-8')}
  function exportEvidence(){const p=activeProject(),h=['题名','作者','年份','国家地区','研究设计','样本量','研究对象','标志物','主要结局','质量评价工具','总体质量/偏倚风险','质量评价备注','核心结果','研究局限','标签'];const rows=p.records.filter(r=>r.fullText==='include'&&!r.isDuplicate).map(r=>{const e=r.evidence||{};return[r.title,r.authors,r.year,e.country,e.design,e.sample,e.population,e.biomarker,e.outcome,e.qualityTool,e.qualityRating,e.qualityNotes,e.result,e.limitations,e.tags]});download(`${p.name}_证据矩阵.csv`,'\ufeff'+[h,...rows].map(x=>x.map(csvCell).join(',')).join('\n'),'text/csv;charset=utf-8')}
  function exportPrisma(){const p=activeProject(),c=counts(p);const rows=[['阶段','数量'],['数据库检索记录',c.total],['删除重复',c.duplicates],['去重后记录',c.deduped],['题名摘要排除',c.screenExcluded],['全文评估',c.fullAssessed],['全文排除',c.fullExcluded],['最终纳入',c.included]];download(`${p.name}_PRISMA统计.csv`,'\ufeff'+rows.map(x=>x.map(csvCell).join(',')).join('\n'),'text/csv;charset=utf-8')}
  function exportAI(){const p=activeProject(),items=p.records.filter(r=>!r.isDuplicate&&r.fullText==='include');let t=`研究问题：\n${p.question}\n\n以下是已经人工筛选并提取的 ${items.length} 项研究。请比较结论的一致点和差异，分析可能原因，并且只使用下面提供的信息，不新增不存在的文献或数据。\n`;items.forEach((r,i)=>{const e=r.evidence||{};t+=`\n研究 ${i+1}\n题名：${r.title}\n作者/年份：${r.authors} ${r.year}\n研究设计：${e.design||'未填写'}\n样本量：${e.sample||'未填写'}\n研究对象：${e.population||'未填写'}\n指标：${e.biomarker||'未填写'}\n结局：${e.outcome||'未填写'}\n核心结果：${e.result||'未填写'}\n局限：${e.limitations||'未填写'}\n`});download(`${p.name}_AI分析材料.txt`,t)}

  document.addEventListener('click', e => {
    const r=e.target.closest('[data-route]'); if(r){go(r.dataset.route);return}
    const b=e.target.closest('[data-action]'); if(!b)return; const p=activeProject(),act=b.dataset.action,id=b.dataset.id;
    if(act==='new-project'){document.querySelector('.modal-backdrop')?.remove();newProjectModal()}
    else if(act==='load-demo')loadDemo(true); else if(act==='load-demo-records')loadDemo(false); else if(act==='pick-files')document.querySelector('#fileInput')?.click();
    else if(act==='keep-duplicate'){const rec=p.records.find(x=>x.id===id);if(rec){rec.isDuplicate=false;rec.duplicateOf='';saveState();render();toast('已保留两条记录')}}
    else if(act==='screen'){const rec=p.records.find(x=>x.id===id);remember(p,rec);rec.screening=b.dataset.value;rec.screenReason='';saveState();render()}
    else if(act==='screen-exclude')reasonModal('screen',id); else if(act==='fulltext'){const rec=p.records.find(x=>x.id===id);remember(p,rec);rec.fullText=b.dataset.value;rec.fullReason='';saveState();render()}
    else if(act==='fulltext-exclude')reasonModal('full',id);
    else if(act==='choose-reason'){const rec=p.records.find(x=>x.id===id);remember(p,rec);if(b.dataset.kind==='screen'){rec.screening='exclude';rec.screenReason=b.dataset.reason}else{rec.fullText='exclude';rec.fullReason=b.dataset.reason}saveState();document.querySelector('.modal-backdrop')?.remove();render()}
    else if(act==='undo')undoLast(p);
    else if(act==='edit-record')recordModal(id);
    else if(act==='print')window.print();
    else if(act==='reset-screening'){p.records.filter(x=>!x.isDuplicate).forEach(x=>{x.screening='pending';x.screenReason='';x.fullText='pending';x.fullReason=''});saveState();render()}
    else if(act==='reset-fulltext'){p.records.forEach(x=>{x.fullText='pending';x.fullReason=''});saveState();render()}
    else if(act==='switch-project'){state.activeId=id;saveState();document.querySelector('.modal-backdrop')?.remove();render()}
    else if(act==='export-records')exportRecords();else if(act==='export-evidence')exportEvidence();else if(act==='export-prisma')exportPrisma();else if(act==='export-ai')exportAI();
    else if(act==='backup')download(`${p.name}_研迹备份.json`,JSON.stringify({app:'研迹 MedResearch',exportedAt:new Date().toISOString(),project:p},null,2),'application/json');
    else if(act==='restore')restoreInput.click();
  });
  document.addEventListener('submit',e=>{e.preventDefault();const f=e.target,data=Object.fromEntries(new FormData(f));if(f.dataset.form==='new-project'){createProject(data)}else if(f.dataset.form==='evidence'){const p=activeProject(),r=p.records.find(x=>x.id===f.dataset.id);r.evidence=data;saveState();toast('证据已保存')}else if(f.dataset.form==='criteria'){const p=activeProject();p.question=data.question.trim();p.criteria={inclusion:data.inclusion.trim(),exclusion:data.exclusion.trim(),screenReasons:data.screenReasons.trim(),fullReasons:data.fullReasons.trim(),notes:data.notes.trim()};saveState();toast('项目方案已保存')}else if(f.dataset.form==='record'){const p=activeProject(),r=p.records.find(x=>x.id===f.dataset.id);remember(p,r);Object.assign(r,{title:data.title.trim(),authors:data.authors.trim(),year:data.year.trim(),doi:normalizeDoi(data.doi),source:data.source.trim(),abstract:data.abstract.trim(),screening:data.screening,screenReason:data.screenReason.trim(),fullText:data.fullText,fullReason:data.fullReason.trim()});saveState();document.querySelector('.modal-backdrop')?.remove();render();toast('文献记录已更新')}});
  switcher.addEventListener('click',projectModal);
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;installButton.hidden=false});
  installButton.addEventListener('click',async()=>{if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;installButton.hidden=true});
  window.addEventListener('appinstalled',()=>toast('研迹已安装到设备'));
  restoreInput.addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{const data=JSON.parse(await file.text()),p=data.project||data;if(!p.id||!Array.isArray(p.records))throw new Error();p.id=uid('project');p.name=`${p.name||'恢复项目'}（已恢复）`;state.projects.unshift(p);state.activeId=p.id;saveState();go('home');toast('项目恢复成功')}catch{toast('这个文件不是有效的研迹备份')}e.target.value=''});
  window.addEventListener('hashchange',()=>{route=(location.hash||'#home').slice(1);render()});
  if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  render();
})();
