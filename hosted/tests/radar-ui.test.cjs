// DOM workflow checks; the parent repository supplies jsdom.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.join(__dirname,'..');
const shell=JSON.parse(fs.readFileSync(path.join(root,'lib/shell.ts'),'utf8').trim().replace(/^export const shell = /,'').replace(/;$/,''));
const script=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
async function settle(check){for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,0));}assert.fail('Expected DOM state did not arrive.');}
async function setup(t){const {radar}=await import(pathToFileURL(path.join(root,'lib/sector-radar.mjs')).href);const {fresh}=await import(pathToFileURL(path.join(root,'lib/workspace.mjs')).href);const data=fresh();data.audit=[];data.summary={positions:[],gross_value:0,gross_pct:0,unrealized_pnl:0,stale_symbols:[],flags:[],themes:[]};const report=radar(null,{},Date.parse('2026-11-03T16:00:00Z'));const calls=[];const dom=new JSDOM('<!doctype html><html><body>'+shell+'</body></html>',{url:'https://research.example/#sectors',runScripts:'outside-only'});t.after(()=>dom.window.close());const win=dom.window;win.HTMLDialogElement.prototype.showModal=function(){this.open=true;};win.HTMLDialogElement.prototype.close=function(){this.open=false;};win.fetch=async(url,opts={})=>{const body=opts.body?JSON.parse(opts.body):null;calls.push({url,body});return {ok:true,status:200,json:async()=>url==='/api/session'?{authenticated:true}:url==='/api/workspace'?data:{connected:false,setup_required:true,revision:0,context:{},report,history_errors:[]}};};win.eval(script);await settle(()=>win.document.querySelector('#content h1')?.textContent==='Market first. Sector second.');return {win,doc:win.document,calls};}
const click=(doc,label)=>{const button=[...doc.querySelectorAll('button')].find(x=>x.textContent===label);assert.ok(button,label);button.click();};
test('missing data shows eleven panels without a fabricated bullish call',async t=>{const {doc}=await setup(t);assert.equal(doc.querySelectorAll('.sector-card').length,11);assert.match(doc.querySelector('#content').textContent,/No sector has met every signal requirement/);assert.match(doc.querySelector('#content').textContent,/FEED SETUP REQUIRED/);});
test('both horizons are interactive and distinguish completed sessions',async t=>{const {doc}=await setup(t);click(doc,'Next 2–5 sessions');assert.match(doc.querySelector('#content').textContent,/Next 2–5 trading days/);click(doc,'Today');assert.match(doc.querySelector('#content').textContent,/Current regular US session/);});
test('secure key form submits to private endpoint and clears the field',async t=>{const {doc,calls}=await setup(t);click(doc,'Connect market feed');const input=doc.querySelector('[name=api_key]');assert.equal(input.type,'password');input.value='SYNTHETIC_TEST_KEY';doc.querySelector('#modal form').requestSubmit();await settle(()=>calls.some(c=>c.body?.action==='connect'));await settle(()=>input.value==='');assert.equal(calls.find(c=>c.body?.action==='connect').url,'/api/sector-radar');});
test('major-driver checklist includes all six categories',async t=>{const {doc}=await setup(t);click(doc,'Review market drivers');assert.equal(doc.querySelector('[name=covered]').options.length,6);assert.equal(doc.querySelector('[name=stance]').value,'mixed');});

