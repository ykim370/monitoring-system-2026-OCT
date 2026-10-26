// DOM-level workflow tests; these do not replace rendered browser/device QA.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app/static/index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'app/static/app.js'), 'utf8');
const at = new Date().toISOString();
function workspace() {
  return {positions:[],theses:[],evidence:[],decisions:[],journal:[],audit:[],dataset:'user',generated_at:at,
    settings:{id:'account',version:1,equity:'10000',max_single_pct:'10',max_theme_pct:'25',max_gross_pct:'60',risk_per_trade_pct:'0.25',max_age_minutes:'60'},
    summary:{gross_value:0,gross_pct:0,unrealized_pnl:0,stale_symbols:[],positions:[],flags:[],themes:[],sectors:[]}};
}
function thesis() {
  return {id:'thesis-1',version:1,symbol:'ACME',title:'Test the demand thesis',hypothesis:'Demand may improve margins.',
    invalidation:'Margins fail to improve.',contradiction:'Capacity costs could rise.',catalyst:'Operating update',horizon:'20 days',status:'qualified',evidence_ids:[],created_at:at,updated_at:at};
}
async function settle(check) {
  for (let i=0;i<100;i++) { if (check()) return; await new Promise(resolve=>setTimeout(resolve,0)); }
  assert.fail('Expected DOM state did not arrive.');
}
async function setup(t, data=workspace(), handler) {
  const dom = new JSDOM(html,{url:'http://127.0.0.1:8000',runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  const win=dom.window, calls=[];
  win.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  win.HTMLDialogElement.prototype.close=function(){this.open=false;};
  win.fetch=async(url,options={})=>{
    const body=options.body?JSON.parse(options.body):null;
    calls.push({url,method:options.method||'GET',body});
    let result;
    if(url==='/api/session')result={authenticated:true};
    else if(url==='/api/workspace')result=data;
    else result=handler?await handler(url,body,options):{};
    const status=result?.__status||200;
    const payload=result?.__status?{error:result.error}:result;
    return {ok:status<400,status,json:async()=>JSON.parse(JSON.stringify(payload))};
  };
  win.eval(script);
  await settle(()=>win.document.querySelector('#application').hidden===false);
  return {win,doc:win.document,calls,data};
}
async function nav(ctx,view,title){ctx.doc.querySelector(`#navigation a[href="#${view}"]`).click();await settle(()=>ctx.doc.querySelector('#page-name').textContent===title);}
const clickText=(doc,label)=>{const b=[...doc.querySelectorAll('button')].find(x=>x.textContent===label);assert.ok(b,`Missing button ${label}`);b.click();};
const set=(doc,name,value)=>{doc.querySelector(`#modal [name="${name}"]`).value=value;};

test('empty desk explains scope without fabricated opportunities',async t=>{
  const {doc}=await setup(t);
  assert.match(doc.querySelector('#content').textContent,/Your workspace is empty/);
  assert.match(doc.querySelector('#content').textContent,/No live market feeds, predictive models or trading connection|Add your own paper records/);
  assert.equal(doc.querySelectorAll('#content .metric').length,4);
});

test('stale data attention is visible in the portfolio',async t=>{
  const data=workspace();data.summary.flags=['1 marked price(s) are stale. New entry acceptance is blocked.'];
  data.summary.stale_symbols=['ACME'];
  const ctx=await setup(t,data);
  await nav(ctx,'portfolio','Portfolio');
  assert.match(ctx.doc.querySelector('#content').textContent,/New entry acceptance is blocked/);
});

test('source content is rendered as text rather than executable markup',async t=>{
  const data=workspace();data.evidence=[{id:'e1',symbol:'ACME',title:'<img src=x onerror=alert(1)>',summary:'<script>attack()</script>',source:'Fixture',classification:'primary',verification:'reviewed',published_at:at,url:'https://example.com'}];
  const ctx=await setup(t,data);await nav(ctx,'evidence','Evidence');
  assert.match(ctx.doc.querySelector('#content').textContent,/<img src=x onerror=alert\(1\)>/);
  assert.equal(ctx.doc.querySelectorAll('#content img,#content script').length,0);
});

test('new thesis form saves an auditable human-authored record',async t=>{
  const data=workspace();const ctx=await setup(t,data,(url,body)=>{if(url==='/api/theses'){const row={...body,id:'saved',version:1,created_at:at,updated_at:at};data.theses.push(row);return row;}return {};});
  clickText(ctx.doc,'+ New thesis');
  set(ctx.doc,'symbol','ACME');set(ctx.doc,'title','Test demand');set(ctx.doc,'hypothesis','Margins may improve.');set(ctx.doc,'invalidation','Margins worsen.');
  ctx.doc.querySelector('#modal form').requestSubmit();
  await settle(()=>ctx.calls.some(c=>c.url==='/api/theses'));
  await settle(()=>ctx.doc.querySelector('#modal').open===false);
  const request=ctx.calls.find(c=>c.url==='/api/theses');
  assert.equal(request.body.invalidation,'Margins worsen.');assert.deepEqual(request.body.evidence_ids,[]);
  assert.match(ctx.doc.querySelector('#content').textContent,/Test demand/);
});

test('entry decision includes risk inputs matching the selected thesis',async t=>{
  const data=workspace();data.theses=[thesis()];const ctx=await setup(t,data);
  await nav(ctx,'journal','Decision journal');clickText(ctx.doc,'+ Record decision');
  const action=ctx.doc.querySelector('[name="action"]');action.value='enter';action.dispatchEvent(new ctx.win.Event('change'));
  assert.equal(ctx.doc.querySelector('[name="entry"]').required,true);
  assert.equal(ctx.doc.querySelector('[name="entry"]').closest('.field').hidden,false);
  set(ctx.doc,'rationale','Test the complete paper decision.');set(ctx.doc,'theme','Compute');set(ctx.doc,'quantity','5');set(ctx.doc,'entry','50');set(ctx.doc,'stop','48');
  ctx.doc.querySelector('#modal form').requestSubmit();
  await settle(()=>ctx.calls.some(c=>c.url==='/api/decisions'));
  assert.equal(ctx.calls.find(c=>c.url==='/api/decisions').body.risk_input.symbol,'ACME');
});

test('non-entry decisions hide and disable required risk fields',async t=>{
  const data=workspace();data.theses=[thesis()];const ctx=await setup(t,data);
  await nav(ctx,'journal','Decision journal');clickText(ctx.doc,'+ Record decision');
  assert.equal(ctx.doc.querySelector('[name="entry"]').required,false);
  assert.equal(ctx.doc.querySelector('[name="entry"]').closest('.field').hidden,true);
  set(ctx.doc,'rationale','Investigate customer concentration.');ctx.doc.querySelector('#modal form').requestSubmit();
  await settle(()=>ctx.calls.some(c=>c.url==='/api/decisions'));
  assert.equal(ctx.calls.find(c=>c.url==='/api/decisions').body.risk_input,undefined);
});

test('server-side conflict leaves the edit visible and explains the failure',async t=>{
  const ctx=await setup(t,workspace(),()=>({__status:409,error:'Record changed. Refresh and try again.'}));
  clickText(ctx.doc,'+ New thesis');
  set(ctx.doc,'symbol','ACME');set(ctx.doc,'title','Test demand');set(ctx.doc,'hypothesis','Margins may improve.');set(ctx.doc,'invalidation','Margins worsen.');
  ctx.doc.querySelector('#modal form').requestSubmit();
  await settle(()=>ctx.doc.querySelector('#modal .form-error').textContent.includes('Record changed'));
  assert.equal(ctx.doc.querySelector('#modal').open,true);
});

test('example workspace is conspicuous and cannot look like live data',async t=>{
  const data=workspace();data.dataset='example';const ctx=await setup(t,data);
  assert.equal(ctx.doc.querySelector('#example-banner').hidden,false);
  assert.match(ctx.doc.querySelector('#example-banner').textContent,/fictional/);
});
