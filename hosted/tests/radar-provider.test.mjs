import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchSnapshot} from '../lib/radar-provider.mjs';
import {completedSessionDate} from '../lib/sector-radar.mjs';

const daily=()=>({'Time Series (Daily)':{[completedSessionDate()]:{'5. adjusted close':'100'}}});
test('unsupported realtime access falls back to real daily history without demo quotes',async()=>{
 const calls=[];const fetcher=async url=>{const u=new URL(url);calls.push(u.searchParams.get('function'));return {ok:true,json:async()=>u.searchParams.get('function')==='REALTIME_BULK_QUOTES'?{message:'ARTIFICIAL SAMPLE DATA',data:[{symbol:'MSFT',close:'1'}]}:daily()};};
 const result=await fetchSnapshot('SYNTHETIC_FIXTURE_KEY',{},fetcher);
 assert.equal(result.data_mode,'daily_only');assert.equal(result.realtime_status,'unavailable');assert.deepEqual(result.quotes,{});assert.equal(result.history.SPY[0].date,completedSessionDate());assert.equal(calls.length,16);
});
test('entitlement errors can still permit licensed daily history',async()=>{
 const fetcher=async url=>({ok:true,json:async()=>new URL(url).searchParams.get('function')==='REALTIME_BULK_QUOTES'?{Information:'Realtime entitlement required'}:daily()});
 const result=await fetchSnapshot('SYNTHETIC_FIXTURE_KEY',{},fetcher);assert.equal(result.data_mode,'daily_only');
});
test('invalid key or no usable market data never becomes a connected snapshot',async()=>{
 await assert.rejects(()=>fetchSnapshot('SYNTHETIC_INVALID',{},async()=>({ok:true,json:async()=>({Information:'Invalid key'})})),/No usable market data/);
});
test('completed cached histories avoid repeated history requests',async()=>{
 const symbols=['SPY','QQQ','RSP','IWM','XLK','XLC','XLY','XLP','XLE','XLF','XLV','XLI','XLB','XLRE','XLU'];
 const history=Object.fromEntries(symbols.map(symbol=>[symbol,[{date:completedSessionDate(),close:100}]]));let calls=0;
 const result=await fetchSnapshot('SYNTHETIC_FIXTURE_KEY',{history,history_session:completedSessionDate()},async()=>{calls++;return {ok:true,json:async()=>({Information:'Realtime unavailable'})};});
 assert.equal(calls,1);assert.equal(result.data_mode,'daily_only');assert.deepEqual(result.history,history);
});
test('a failed refresh retains dated history for descriptive rotation',async()=>{const old=[{date:'2026-01-02',close:100},{date:'2025-12-31',close:99}];const result=await fetchSnapshot('SYNTHETIC_FIXTURE_KEY',{history:{SPY:old,XLK:old}},async()=>({ok:true,json:async()=>({Information:'Rate limited'})}));assert.deepEqual(result.history.XLK,old);assert.ok(result.history_errors.length);assert.equal(result.data_mode,'daily_only');});
test('provider requests use the Worker-supported manual redirect mode and never follow redirects',async()=>{const {query}=await import('../lib/radar-provider.mjs');let received;await assert.rejects(()=>query('SYNTHETIC_FIXTURE_KEY',{function:'TIME_SERIES_DAILY_ADJUSTED',symbol:'SPY'},async(url,options)=>{received=options;assert.equal(typeof url,'string');assert.equal(options.redirect,'manual');return {ok:false,status:302,json:async()=>assert.fail('Redirect payload must not be parsed')};}),/HTTP 302/);assert.equal(received.redirect,'manual');});
test('provider rejection errors are actionable and do not expose provider text or credentials',async()=>{const {query}=await import('../lib/radar-provider.mjs');await assert.rejects(()=>query('SYNTHETIC_FIXTURE_KEY',{},async()=>({ok:true,json:async()=>({Information:'API rate limit reached SYNTHETIC_FIXTURE_KEY'})})),e=>/allowance reached/.test(e.message)&&!e.message.includes('SYNTHETIC_FIXTURE_KEY'));});
test('standard daily endpoint supplies all sector rankings when adjusted access is rejected',async()=>{const {radar}=await import('../lib/sector-radar.mjs');const latest=completedSessionDate();let d=new Date(latest+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);while([0,6].includes(d.getUTCDay()))d.setUTCDate(d.getUTCDate()-1);const previous=d.toISOString().slice(0,10);const calls=[];const result=await fetchSnapshot('SYNTHETIC_FIXTURE_KEY',{},async url=>{const f=new URL(url).searchParams.get('function');calls.push(f);return {ok:true,json:async()=>f==='TIME_SERIES_DAILY'?{'Time Series (Daily)':{[latest]:{'4. close':'101'},[previous]:{'4. close':'100'}}}:{Information:'Premium endpoint requires subscription'}};});assert.equal(result.rotation_basis,'unadjusted_close');assert.equal(result.history.SPY,undefined);assert.equal(Object.keys(result.rotation_history).length,15);assert.equal(calls.filter(x=>x==='TIME_SERIES_DAILY_ADJUSTED').length,1);const ranking=radar(result).ranking;assert.equal(ranking.coverage,11);assert.equal(ranking.price_basis,'unadjusted_close');assert.equal(radar(result).signal_count,0);});
test('unadjusted fallback parser uses closing prices and ignores invalid observations',async()=>{const {parseDailyPrices}=await import('../lib/radar-provider.mjs');assert.deepEqual(parseDailyPrices({'Time Series (Daily)':{'2026-10-28':{'4. close':'100'},'2026-10-27':{'4. close':'0'}}}),[{date:'2026-10-28',close:100}]);});
