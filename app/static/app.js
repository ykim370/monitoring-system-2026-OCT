'use strict';

// All user content is inserted as text nodes, never parsed as HTML.
const $ = (selector) => document.querySelector(selector);
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (['value', 'checked', 'selected', 'disabled', 'required', 'multiple'].includes(key)) el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}
const money = (v) => new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 2}).format(v);
const pct = (v) => `${Number(v).toFixed(1)}%`;
const date = (v) => new Intl.DateTimeFormat('en-NZ', {timeZone: 'Pacific/Auckland', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'}).format(new Date(v));
const localTime = (v = new Date()) => { const d = new Date(v); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0,16); };
const iso = (v) => new Date(v).toISOString();
const tidy = (v) => String(v).replaceAll('_', ' ');
const state = {workspace: null, view: 'desk'};
const views = [['desk', '◫', 'Decision desk'], ['portfolio', '▥', 'Portfolio'], ['theses', '◇', 'Investment theses'], ['evidence', '≋', 'Evidence'], ['journal', '↗', 'Decision journal'], ['system', '⊞', 'System & roadmap']];
const content = $('#content');
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5500); }
async function api(path, method = 'GET', body) {
  const options = {method, credentials: 'same-origin', headers: {}};
  if (body !== undefined) { options.body = JSON.stringify(body); options.headers['Content-Type'] = 'application/json'; }
  const response = await fetch(`/api/${path}`, options);
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== 'login') showLogin();
    throw new Error(result.error || 'Request failed.');
  }
  return result;
}
function showLogin() { $('#application').hidden = true; $('#login').hidden = false; state.workspace = null; $('#modal').close(); }
async function refresh() {
  state.workspace = await api('workspace');
  $('#login').hidden = true; $('#application').hidden = false;
  $('#example-banner').hidden = state.workspace.dataset !== 'example';
  render();
}
const button = (label, action, cls = '', disabled = false) => h('button', {type:'button', class:`button ${cls}`, onclick:action, disabled}, label);
const tag = (label, cls = 'gray') => h('span', {class:`tag ${cls}`}, tidy(label));
function empty(title, description, action) { return h('div', {class:'empty'}, h('div', {class:'empty-symbol', 'aria-hidden':'true'}, '◇'), h('h3', {}, title), h('p', {}, description), action); }
function panel(title, subtitle, body, action) { return h('section', {class:'panel'}, h('div', {class:'panel-heading'}, h('div', {}, h('div', {class:'panel-kicker'}, subtitle), h('h3', {}, title)), action), body); }
function heading(title, description, actions = []) { return h('div', {class:'page-heading'}, h('div', {}, h('p', {class:'eyebrow'}, 'INVESTMENT INTELLIGENCE / PAPER WORKSPACE'), h('h1', {}, title), h('p', {}, description)), h('div', {class:'heading-actions'}, actions)); }
function notice(text) { return h('div', {class:'notice'}, h('span', {class:'notice-icon','aria-hidden':'true'}, '◇'), h('p', {}, text)); }
function detail(label, value) { return h('div', {}, h('p', {class:'label'}, label), h('p', {}, value || 'Not recorded')); }
function snapshot(value, title = 'Inspect recorded snapshot') { return h('details', {}, h('summary', {}, title), h('pre', {}, JSON.stringify(value, null, 2))); }
function metric(label, value, note, cls='') { return h('div', {class:'metric'}, h('div', {class:'metric-label'}, label, h('span', {'aria-hidden':'true'}, '↗')), h('div', {class:`metric-value ${cls}`}, value), h('div', {class:'metric-detail'}, note)); }
function navigate(view) { location.hash = view; }
function render() {
  if (!state.workspace) return;
  state.view = views.some(v => v[0] === location.hash.slice(1)) ? location.hash.slice(1) : 'desk';
  $('#page-name').textContent = views.find(v => v[0] === state.view)[2];
  $('#navigation').replaceChildren(...views.map(([id, icon, label]) => h('a', {href:`#${id}`, class:`nav-link ${id===state.view?'active':''}`, 'aria-current':id===state.view?'page':null}, h('span', {class:'nav-icon','aria-hidden':'true'}, icon), label)));
  content.replaceChildren(...({desk:desk,portfolio:portfolio,theses:theses,evidence:evidence,journal:journal,system:system}[state.view])());
}
function riskItems() {
  const flags = state.workspace.summary.flags;
  return flags.length ? h('div', {class:'panel-body'}, flags.map(flag => h('div', {class:'risk-item'}, h('span', {class:'risk-icon'}, '!'), h('div', {}, h('p', {}, flag), h('small', {}, 'Deterministic paper control · review source records'))))) : h('div', {class:'panel-body'}, h('p', {class:'positive'}, 'No configured exposure limits exceeded.'), h('p', {class:'fine-print'}, 'This checks recorded marks and configured limits. It does not establish a trading edge or protect against market gaps.'));
}
function thesisRow(t) {
  return h('div', {class:'research-row'}, h('span', {class:'ticker'}, t.symbol), h('div', {class:'research-content'}, h('h4', {}, t.title), h('p', {}, t.hypothesis), h('div', {class:'actions'}, tag(t.status), h('span', {class:'subtle-count'}, `${t.evidence_ids.length} evidence · ${t.horizon}`))), button('Open ↗', () => thesisDetail(t), 'small'));
}
function evidenceRow(e) {
  return h('article', {class:'evidence-row'}, h('p', {class:'eyebrow'}, `${e.symbol} / ${tidy(e.classification)} / ${date(e.published_at)}`), h('h4', {}, e.title), h('p', {}, e.summary), h('div', {class:'row-top'}, h('span', {class:'subtle-count'}, `${e.source} · ${e.verification}`), e.url ? h('a', {href:e.url, target:'_blank', rel:'noopener noreferrer', class:'quiet'}, 'Source ↗') : tag('No source link', 'amber')));
}
function themesBody() {
  const data=state.workspace.summary.themes;
  return data.length ? h('div', {class:'panel-body'}, data.map(t => h('div', {class:'theme-row'}, h('div', {class:'theme-label'}, t.name, h('span', {}, pct(t.weight_pct))), h('progress', {class:'bar-track', value:t.weight_pct, max:100, 'aria-label':`${t.name}: ${pct(t.weight_pct)} of paper equity`}), h('div', {class:'theme-footnote'}, `${money(t.value)} marked value`)))) : empty('No exposures yet', 'Import marked positions to see theme concentration.');
}
function desk() {
  const w=state.workspace, s=w.summary, open=w.theses.filter(t=>!['closed','invalidated'].includes(t.status));
  return [heading('Evidence before conviction.', 'A clear view of your exposure, changing assumptions and next research decision.', [button('+ New thesis',()=>thesisForm(), 'primary')]),
    !w.positions.length && !w.theses.length ? notice('Your workspace is empty. Add your own paper records, or load explicitly fictional examples to explore the workflow.') : notice('Manual research workspace. No live market feeds, predictive models or trading connection are active.'),
    h('div',{class:'metrics'},metric('MARKED EXPOSURE',money(s.gross_value),`${pct(s.gross_pct)} of configured paper equity`),metric('UNREALIZED MARK DIFFERENCE',money(s.unrealized_pnl),'Marked value less recorded cost; not a return history',s.unrealized_pnl<0?'negative':'positive'),metric('OPEN THESES',String(open.length),'Human-authored investment hypotheses'),metric('STALE MARKS',String(s.stale_symbols.length),`${w.positions.length} positions · ${w.settings.max_age_minutes} min freshness limit`,s.stale_symbols.length?'warning':'')),
    h('div',{class:'grid-two'},panel('Research queue','WHERE TO FOCUS',open.length?h('div',{},open.slice(0,4).map(thesisRow)):empty('Start with a hypothesis','Write what could change, why price may respond, and what would invalidate the idea.',button('Create a thesis',()=>thesisForm(),'small')),button('View all ↗',()=>navigate('theses'),'small')),panel('Portfolio attention','RISK BEFORE ALLOCATION',riskItems(),button('Portfolio ↗',()=>navigate('portfolio'),'small'))),
    h('div',{class:'grid-two'},panel('Latest evidence','WHAT HAS CHANGED',w.evidence.length?h('div',{},w.evidence.slice(0,3).map(evidenceRow)):empty('No evidence recorded','Capture a source and its publication and observation times.',button('+ Add evidence',()=>evidenceForm(),'small'))),panel('Theme concentration','SHARED ECONOMIC EXPOSURE',themesBody())),
    !w.positions.length && !w.theses.length ? panel('Explore the workflow','OPTIONAL FICTIONAL EXAMPLES',h('div',{class:'panel-body'},h('p',{class:'muted'},'Loads three fictional positions and a research thesis. Examples are clearly labeled and must be cleared before importing your portfolio.'),button('Load example workspace',loadExamples,'small'))) : h('div')];
}
function positionTable() {
  const positions=state.workspace.summary.positions;
  if(!positions.length) return empty('No portfolio imported','Add USD long equity positions. Quote timestamps are user-provided; the app never pretends to refresh a price.',button('+ Add position',()=>positionForm(),'small'));
  const headers=['SYMBOL / THEME','QUANTITY','COST','MARK','MARKED VALUE','WEIGHT','AS OF',''];
  return h('div',{class:'table-wrap'},h('table',{},h('thead',{},h('tr',{},headers.map(x=>h('th',{},x)))),h('tbody',{},positions.map(p=>h('tr',{},h('td',{},h('strong',{},p.symbol),h('small',{},p.theme)),h('td',{},p.quantity),h('td',{},money(p.average_cost)),h('td',{},money(p.price)),h('td',{},money(p.value)),h('td',{},pct(p.weight_pct)),h('td',{},date(p.as_of),h('small',{class:p.stale?'warning':'muted'},p.stale?'Stale mark':'Within configured window')),h('td',{},button('Edit',()=>positionForm(p),'small')))))));
}
function portfolio() {
  return [heading('Know your exposure.', 'USD long equity records, user-provided marks and conservative paper limits.',[button('Import CSV',importForm),button('Assess an entry',riskForm),button('+ Position',()=>positionForm(),'primary')]),
    notice('These are paper records. Quote timestamps are not refreshed automatically. CSV imports merge by symbol and retain other positions.'),
    panel('Marked portfolio','MANUAL RECORDS',positionTable()),h('br'),h('div',{class:'grid-two'},panel('Exposure checks','CONFIGURED LIMITS',riskItems()),panel('Theme concentration','PERCENT OF PAPER EQUITY',themesBody()))];
}
function theses() {
  const list=state.workspace.theses;
  return [heading('Make the thesis explicit.', 'Track the hypothesis, contrary evidence and conditions that would change your mind.',[button('+ New thesis',()=>thesisForm(),'primary')]),list.length?h('div',{class:'cards'},list.map(t=>h('article',{class:'panel thesis-card'},h('div',{class:'row-top'},tag(t.symbol),tag(t.status)),h('h3',{},t.title),h('p',{},t.hypothesis),detail('INVALIDATION',t.invalidation),h('div',{class:'card-footer'},h('span',{class:'subtle-count'},`${t.horizon} · ${t.evidence_ids.length} evidence · v${t.version}`),button('Open thesis ↗',()=>thesisDetail(t),'small'))))):panel('Investment theses','RESEARCH REGISTER',empty('Your first thesis starts here','Specific assumptions and invalidation conditions make the idea testable.',button('Create thesis',()=>thesisForm(),'small')))];
}
function evidence() {
  const list=state.workspace.evidence;
  return [heading('Follow the evidence.', 'Keep original sources, observation times and interpretation separate.',[button('+ Add evidence',()=>evidenceForm(),'primary')]),notice('“Reviewed” is your own review status. The application does not verify a source or infer that a claim is true.'),panel('Evidence timeline',`${list.length} RECORDS · NEWEST CAPTURE FIRST`,list.length?h('div',{},list.map(evidenceRow)):empty('No sources captured','Add the source, summarize the economic change, then link it to a thesis.'))];
}
function journal() {
  const w=state.workspace;
  return [heading('Decisions you can learn from.', 'Preserve the information available at the time. Acceptance records a paper decision only.',[button('+ Record decision',decisionForm,'primary',!w.theses.length)]),notice('Decisions are human-authored. “Accept” does not place an order, change holdings or simulate a fill.'),
    ...(!w.decisions.length?[panel('Decision journal','IMMUTABLE SNAPSHOTS',empty('No decisions recorded','Create a thesis, attach evidence and record the decision before its outcome is known.'))]:w.decisions.map(dec=>h('article',{class:'panel decision-card'},h('div',{class:'row-top'},h('div',{class:'actions'},tag(dec.symbol),tag(dec.action)),tag(dec.status,dec.status==='declined'?'red':dec.status==='accepted'?'':'amber')),h('div',{class:'decision-title'},dec.snapshot.thesis.title),h('p',{},dec.rationale),h('div',{class:'decision-meta'},h('span',{},`Recorded ${date(dec.created_at)}`),h('span',{},`Expires ${date(dec.expires_at)}`),h('span',{},'User-authored · Paper only')),dec.snapshot.risk?h('p',{class:dec.snapshot.risk.passed?'positive':'warning'},dec.snapshot.risk.passed?'Recorded paper checks passed. Rechecked on acceptance.':`Recorded checks blocked: ${dec.snapshot.risk.blocks.join(' ')}`):null,dec.review_note?h('p',{},`Review: ${dec.review_note}`):null,h('div',{class:'actions'},dec.status==='pending'?button('Accept paper decision',()=>reviewForm(dec,'accepted'),'small'):null,dec.status==='pending'?button('Decline',()=>reviewForm(dec,'declined'),'small'):null,button('+ Journal note',()=>journalForm(dec),'small')),w.journal.filter(n=>n.decision_id===dec.id).map(n=>h('div',{class:'journal-note'},tag(n.category),h('p',{},n.note),h('small',{},date(n.created_at)))),snapshot(dec.snapshot)) ))];
}
function system() {
  const w=state.workspace, cfg=w.settings;
  return [heading('A foundation you can inspect.', 'Operational truth first. Predictive features must earn their place through validation.',[button('Export records',exportRecords),button('Edit paper limits',settingsForm,'primary')]),
    h('div',{class:'grid-two'},panel('Current capabilities','HONEST SYSTEM STATE',h('div',{class:'panel-body'},[['Durable records & audit','Available'],['CSV imports & paper exposure','Available'],['Live market feeds','Not connected'],['Predictive models','Not implemented'],['Broker order execution','Disabled'],['Background notifications','Not configured']].map(([a,b])=>h('div',{class:'system-row'},a,tag(b,b==='Available'?'':'gray'))))),panel('Paper allocation limits','CONFIGURABLE EXPERIMENT SETTINGS',h('div',{class:'panel-body'},[['Paper equity',money(cfg.equity)],['Single-name cap',`${cfg.max_single_pct}%`],['Theme cap',`${cfg.max_theme_pct}%`],['Gross exposure cap',`${cfg.max_gross_pct}%`],['Planned risk per entry',`${cfg.risk_per_trade_pct}%`],['Mark freshness',`${cfg.max_age_minutes} minutes`]].map(([a,b])=>h('div',{class:'system-row'},a,h('strong',{},b)))))),
    panel('Research roadmap','NEXT CAPABILITIES · NO PERFORMANCE CLAIMS',h('div',{class:'panel-body'},[['01 / Data adapters','Point-in-time filings, prices and corporate actions, with cache and rate budgets.'],['02 / Strategy baseline','One predeclared hypothesis, realistic costs and risk-matched benchmarks.'],['03 / Advanced evidence','Expectations changes and verified business relationships, evaluated through ablation tests.'],['04 / Forward validation','Timestamped paper forecasts and decision attribution before any live execution.']].map(([a,b])=>h('div',{class:'roadmap-row'},h('h4',{},a),h('p',{},b))))),h('br'),panel('Recent audit events','APPEND-ONLY SERVER RECORDS',h('div',{class:'panel-body'},w.audit.slice(0,15).map(a=>h('details',{},h('summary',{},`#${a.sequence} · ${tidy(a.action)} · ${a.entity} · ${date(a.created_at)}`),h('pre',{},JSON.stringify(a.payload,null,2)))))),h('br'),w.dataset==='example'?button('Clear example workspace',clearExamples,'danger'):button('Load fictional examples',loadExamples,'',KINDS_PRESENT(w))];
}
function KINDS_PRESENT(w){return ['positions','theses','evidence','decisions','journal'].some(k=>w[k].length>0);}

function openModal(title, body) { $('#modal-title').textContent=title; $('#modal-content').replaceChildren(body); $('#modal').showModal(); }
function openForm(title, description, fields, save, options={}) {
  const error=h('p',{class:'form-error',role:'alert'}), result=h('div',{class:'form-result'}), grid=h('div',{class:'form-grid'});
  for(const f of fields){
    const id=`field-${f.name}`;
    let input;
    if(f.options){input=h('select',{id,name:f.name,multiple:f.multiple,required:f.required!==false},f.options.map(o=>{const value=Array.isArray(o)?o[0]:o;const label=Array.isArray(o)?o[1]:tidy(o);return h('option',{value,selected:f.multiple?(f.value||[]).includes(value):String(f.value)===String(value)},label);}));}
    else if(f.type==='textarea') input=h('textarea',{id,name:f.name,required:f.required!==false,maxlength:f.maxlength||4000,rows:f.rows||3},f.value||'');
    else input=h('input',{id,name:f.name,type:f.type||'text',value:f.value||'',required:f.required!==false,step:f.type==='number'?'any':null,min:f.type==='number'?0:null,maxlength:f.maxlength||200,readonly:f.readonly});
    grid.append(h('div',{class:`field ${f.wide?'wide':''}`,'data-field':f.name},h('label',{for:id},f.label),input,f.help?h('small',{},f.help):null));
  }
  const submit=h('button',{type:'submit',class:'button primary'},options.submit||'Save record');
  const form=h('form',{},grid,error,result,h('div',{class:'form-actions'},button('Cancel',()=>$('#modal').close()),submit));
  form.addEventListener('submit',async event=>{event.preventDefault();error.textContent='';submit.disabled=true;try{const values=Object.fromEntries(new FormData(form));for(const f of fields.filter(x=>x.multiple))values[f.name]=new FormData(form).getAll(f.name);await save(values,result);if(!options.keepOpen){$('#modal').close();await refresh();toast(options.success||'Record saved.');}}catch(exc){error.textContent=exc.message;}finally{submit.disabled=false;}});
  openModal(title,h('div',{},h('p',{class:'form-description'},description),form));
  if(options.setup)options.setup(form);
}
function positionForm(p={}) {
  openForm(p.id?`Edit ${p.symbol}`:'Add a marked position','USD long equity paper records. Enter the actual observation time for the marked price.',[
    {name:'symbol',label:'Symbol',value:p.symbol,readonly:!!p.id},{name:'quantity',label:'Quantity',type:'number',value:p.quantity},
    {name:'average_cost',label:'Average cost (USD)',type:'number',value:p.average_cost},{name:'price',label:'Marked price (USD)',type:'number',value:p.price},
    {name:'sector',label:'Sector',value:p.sector},{name:'theme',label:'Economic theme',value:p.theme,help:'Use consistent theme names across correlated positions.'},
    {name:'as_of',label:'Price observed at (your local time)',type:'datetime-local',value:localTime(p.as_of||new Date()),wide:true}
  ],async v=>api(p.id?`positions/${p.id}`:'positions',p.id?'PATCH':'POST',{...v,as_of:iso(v.as_of),version:p.version}));
  if(p.id)$('#modal-content form .form-actions').prepend(button('Remove position',()=>removePosition(p),'danger'));
}
function removePosition(p){openForm(`Remove ${p.symbol}?`,'Removes the paper holding and preserves its previous values in the audit ledger.',[{name:'confirmation',label:`Type ${p.symbol} to confirm`}],async v=>{if(v.confirmation!==p.symbol)throw new Error('Symbol does not match.');await api(`positions/${p.id}`,'DELETE',{version:p.version});},{submit:'Remove position'});}
function evidenceForm(){openForm('Capture evidence','Record what the source says separately from your interpretation. Review status is your own assessment.',[
  {name:'symbol',label:'Symbol'},{name:'classification',label:'Evidence classification',options:['primary','secondary','inference'],value:'primary'},
  {name:'title',label:'What changed?',wide:true},{name:'source',label:'Source / publisher'},{name:'url',label:'Original source URL',type:'url',required:false},
  {name:'summary',label:'Evidence summary',type:'textarea',wide:true},{name:'published_at',label:'Published at (local time)',type:'datetime-local',value:localTime()},
  {name:'observed_at',label:'Observed at (local time)',type:'datetime-local',value:localTime()},
  {name:'verification',label:'Your review status',options:['unreviewed','reviewed'],value:'unreviewed',wide:true}
],async v=>api('evidence','POST',{...v,published_at:iso(v.published_at),observed_at:iso(v.observed_at)}));}
function thesisForm(t={}){openForm(t.id?'Edit thesis':'Create a thesis','Make the price mechanism and invalidation explicit. Link evidence with the same symbol.',[
  {name:'symbol',label:'Symbol',value:t.symbol},{name:'horizon',label:'Research horizon',options:['5 days','20 days'],value:t.horizon||'20 days'},
  {name:'title',label:'Thesis title',value:t.title,wide:true},{name:'hypothesis',label:'What could change, and why could price respond?',type:'textarea',value:t.hypothesis,wide:true},
  {name:'invalidation',label:'What would invalidate this thesis?',type:'textarea',value:t.invalidation,wide:true},
  {name:'contradiction',label:'Contradictory evidence / unresolved questions',type:'textarea',value:t.contradiction,required:false,wide:true},
  {name:'catalyst',label:'Catalyst / expected timing',value:t.catalyst,required:false,wide:true},
  {name:'status',label:'Lifecycle status',options:['investigating','qualified','active','under_review','invalidated','closed'],value:t.status||'investigating'},
  {name:'evidence_ids',label:'Link evidence (multiple selection)',options:state.workspace.evidence.map(e=>[e.id,`${e.symbol} / ${e.title}`]),value:t.evidence_ids||[],multiple:true,required:false,wide:true,help:'Select only matching-symbol sources. Save a new thesis without evidence if research has just begun.'}
],async v=>api(t.id?`theses/${t.id}`:'theses',t.id?'PATCH':'POST',{...v,version:t.version}));}
function thesisDetail(t){const linked=state.workspace.evidence.filter(e=>t.evidence_ids.includes(e.id));openModal(t.title,h('div',{class:'thesis-card'},h('div',{class:'actions'},tag(t.symbol),tag(t.status),tag(t.horizon)),detail('HYPOTHESIS',t.hypothesis),detail('INVALIDATION',t.invalidation),detail('CONTRADICTORY EVIDENCE',t.contradiction),detail('CATALYST',t.catalyst),h('div',{class:'actions'},button('Edit thesis',()=>{$('#modal').close();thesisForm(t);},'primary'),button('Record decision',()=>{$('#modal').close();decisionForm(t.id);})),h('br'),h('h4',{},'Linked evidence'),linked.length?linked.map(evidenceRow):h('p',{class:'muted'},'No evidence linked. Entry acceptance requires a reviewed source.')));}
function settingsForm(){const cfg=state.workspace.settings;openForm('Paper allocation limits','Experiment settings for a paper portfolio. These controls do not guarantee losses or drawdown.',[
  ['equity','Paper equity (USD)'],['max_single_pct','Single-name maximum (%)'],['max_theme_pct','Theme maximum (%)'],['max_gross_pct','Gross exposure maximum (%)'],['risk_per_trade_pct','Planned entry risk maximum (%)'],['max_age_minutes','Mark freshness limit (minutes)']
].map(([name,label])=>({name,label,type:'number',value:cfg[name]})),async v=>api('settings','PATCH',{...v,version:cfg.version}));}
function importForm(){openForm('Import marked positions','Merge by symbol; positions absent from this file are retained. Required columns: symbol,quantity,average_cost,price,sector,theme,as_of. Optional: currency (USD). The whole import fails if any row is invalid.',[
  {name:'csv',label:'CSV contents',type:'textarea',wide:true,rows:9,maxlength:1000000}
],async v=>api('positions/import','POST',v),{submit:'Validate & merge',success:'CSV merged. Other positions were retained.'});
  const file=h('input',{type:'file',accept:'.csv,text/csv','aria-label':'Choose a CSV file'});file.addEventListener('change',async()=>{const f=file.files[0];if(!f)return;if(f.size>1000000){toast('CSV must be under 1 MB.');return;}$('#field-csv').value=await f.text();});$('#modal-content form').prepend(h('div',{class:'field wide'},h('label',{},'Or choose a file'),file,h('br')));
  $('#modal-content form .form-actions').prepend(button('Download template',()=>download('positions-template.csv',`symbol,quantity,average_cost,price,sector,theme,as_of,currency\nACME,10,40,42,Technology,Example theme,${new Date().toISOString()},USD\n`,'text/csv')));
}
function riskFields(){return [{name:'symbol',label:'Symbol'},{name:'theme',label:'Economic theme'},{name:'quantity',label:'Proposed quantity',type:'number'},{name:'entry',label:'Entry price (USD)',type:'number'},{name:'stop',label:'Invalidation price (USD)',type:'number'},{name:'as_of',label:'Entry quote observed at (local time)',type:'datetime-local',value:localTime()}];}
function riskForm(){openForm('Assess a paper entry','Checks recorded exposure and planned loss. This does not produce a forecast, reserve capital or authorize an order.',riskFields(),async(v,result)=>{const r=await api('risk/assess','POST',{...v,as_of:iso(v.as_of)});result.replaceChildren(notice(r.passed?'Within configured paper limits. This is not a buy recommendation.':r.blocks.join(' ')),h('div',{class:'metrics'},metric('NOTIONAL',money(r.metrics.notional),'Proposed addition'),metric('PLANNED LOSS',money(r.metrics.planned_loss),'A gap can cause a greater loss')),snapshot(r,'Full assessment'));},{keepOpen:true,submit:'Assess paper limits'});}
function decisionForm(thesisId){if(!state.workspace.theses.length){toast('Create a thesis first.');return;}const initial=thesisId||state.workspace.theses[0].id;const fields=[
  {name:'thesis_id',label:'Investment thesis',options:state.workspace.theses.map(t=>[t.id,`${t.symbol} / ${t.title}`]),value:initial,wide:true},
  {name:'action',label:'Paper action',options:['investigate','wait','enter','maintain','reduce','exit'],value:'investigate'},
  {name:'expires_at',label:'Decision expiry (local time)',type:'datetime-local',value:localTime(Date.now()+86400000)},
  {name:'rationale',label:'Decision rationale',type:'textarea',wide:true},...riskFields().filter(f=>f.name!=='symbol').map(f=>({...f,required:false}))];
  openForm('Record a paper decision','Creates an immutable snapshot of the thesis, evidence, portfolio and limits. No order is sent.',fields,async v=>{const t=state.workspace.theses.find(t=>t.id===v.thesis_id);await api('decisions','POST',{thesis_id:v.thesis_id,action:v.action,rationale:v.rationale,expires_at:iso(v.expires_at),risk_input:v.action==='enter'?{symbol:t.symbol,theme:v.theme,quantity:v.quantity,entry:v.entry,stop:v.stop,as_of:iso(v.as_of)}:undefined});},{setup:form=>{const action=form.elements.action;function toggle(){for(const name of ['theme','quantity','entry','stop','as_of']){const input=form.elements[name];input.closest('.field').hidden=action.value!=='enter';input.required=action.value==='enter';}}action.addEventListener('change',toggle);toggle();}});
}
function reviewForm(dec,status){openForm(status==='accepted'?'Accept this paper decision?':'Decline this decision','Your review is recorded. Entry acceptance rechecks expiry, thesis version, evidence and current portfolio limits. No trade is placed.',[{name:'note',label:'Reason for your review',type:'textarea',wide:true}],async v=>api(`decisions/${dec.id}/review`,'POST',{status,version:dec.version,note:v.note}),{submit:status==='accepted'?'Accept paper decision':'Decline decision'});}
function journalForm(dec){openForm('Add a journal observation','Append a note without modifying the original decision snapshot.',[{name:'category',label:'Category',options:['observation','override','outcome'],value:'observation'},{name:'note',label:'What did you observe or decide?',type:'textarea',wide:true}],async v=>api('journal','POST',{...v,decision_id:dec.id}));}
async function loadExamples(){try{await api('examples','POST',{});await refresh();toast('Fictional example workspace loaded.');}catch(exc){toast(exc.message);}}
function clearExamples(){openForm('Clear fictional examples','Removes all current example-workspace records, including edits and notes added while exploring it. Audit history is retained.',[{name:'confirmation',label:'Type CLEAR EXAMPLES'}],async v=>api('examples','DELETE',v),{submit:'Clear example workspace'});}
function download(name,text,type){const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const link=h('a',{href:url,download:name});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportRecords(){download(`axiom-records-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(state.workspace,null,2),'application/json');toast('Export contains private research records. Store it securely.');}
$('#close-modal').addEventListener('click',()=>$('#modal').close());
$('#refresh').addEventListener('click',()=>refresh().catch(exc=>toast(exc.message)));
$('#clear-examples').addEventListener('click',clearExamples);
$('#sign-out').addEventListener('click',async()=>{try{await api('logout','POST',{});showLogin();}catch(exc){toast(exc.message);}});
$('#login-form').addEventListener('submit',async event=>{event.preventDefault();$('#login-error').textContent='';const b=event.target.querySelector('button');b.disabled=true;try{await api('login','POST',{password:$('#password').value});$('#password').value='';await refresh();}catch(exc){$('#login-error').textContent=exc.message;}finally{b.disabled=false;}});
window.addEventListener('hashchange',render);
async function boot(){try{const session=await api('session');if(session.authenticated)await refresh();else showLogin();}catch(exc){showLogin();$('#login-error').textContent=exc.message;}}
boot();
