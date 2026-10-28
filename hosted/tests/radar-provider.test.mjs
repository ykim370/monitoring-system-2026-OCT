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
