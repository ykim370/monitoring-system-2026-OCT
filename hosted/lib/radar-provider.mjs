import { Invalid } from './domain.mjs';
import { SYMBOLS, SECTORS, parseBulk, parseHistory, completedSessionDate } from './sector-radar.mjs';

const bytes64=b=>btoa(String.fromCharCode(...b));
const from64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function encryptionKey(secret){if(typeof secret!=='string'||!/^[a-f0-9]{64}$/.test(secret))throw new Invalid('Secure feed configuration is unavailable.',503);return crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/../g),s=>parseInt(s,16)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
export async function encryptAPIKey(value,secret,owner){if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(value)||value.toLowerCase()==='demo')throw new Invalid('Enter your own Alpha Vantage API key. Demo keys are not accepted.');const key=await encryptionKey(secret),iv=crypto.getRandomValues(new Uint8Array(12));const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(owner)},key,new TextEncoder().encode(value));return JSON.stringify({v:1,iv:bytes64(iv),ciphertext:bytes64(new Uint8Array(ciphertext))});}
export async function decryptAPIKey(value,secret,owner){const data=JSON.parse(value),key=await encryptionKey(secret);if(data.v!==1)throw new Invalid('Unsupported encrypted connection.',503);try{return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:from64(data.iv),additionalData:new TextEncoder().encode(owner)},key,from64(data.ciphertext)));}catch{throw new Invalid('The data connection needs to be reconnected.',503);}}
export async function query(key,params,fetcher=fetch){const url=new URL('https://www.alphavantage.co/query');for(const [name,value] of Object.entries({...params,apikey:key}))url.searchParams.set(name,value);let response;try{response=await fetcher(url.toString(),{signal:AbortSignal.timeout(12000),redirect:'manual'});}catch(error){const hint=/redirect/i.test(String(error?.message))?' Unsupported redirect mode.':/timeout|abort/i.test(String(error?.name))?' Request timed out.':/url/i.test(String(error?.message))?' URL handling failed.':'';throw new Invalid(`Provider connection failed.${hint} Existing data remains timestamped.`,502);}if(!response.ok)throw new Invalid(`Provider HTTP ${response.status}. Existing data remains timestamped.`,502);let data;try{data=await response.json();}catch{throw new Invalid('The provider returned an unsupported response.',502);}if(data.Information||data.Note||data['Error Message']){const info=String(data.Information||data.Note||data['Error Message']).toLowerCase();const reason=/rate|limit|frequency|requests per|calls per/.test(info)?'Provider request allowance reached. Retry after the provider quota resets.':/premium|subscription|entitlement/.test(info)?'Provider subscription does not permit this endpoint.':/apikey|api key|invalid key/.test(info)?'Provider rejected the API credential.':'Provider rejected the data request.';throw new Invalid(reason,422);}return data;}
export async function fetchSnapshot(key,previous={},fetcher=fetch){
 const snapshot={quotes:{},history:previous.history??{},history_session:previous.history_session??null,history_fetched_at:previous.history_fetched_at??null,history_errors:previous.history_errors??[],fetched_at:new Date().toISOString(),provider:'Alpha Vantage',realtime_status:'unavailable',realtime_error:null,timestamp_timezone_assumption:'America/New_York when the provider omits an explicit offset'};
 try{snapshot.quotes=parseBulk(await query(key,{function:'REALTIME_BULK_QUOTES',symbol:SYMBOLS.join(',')},fetcher));snapshot.realtime_status='verified_response';}
 catch(error){snapshot.realtime_error=`Realtime unavailable: ${error instanceof Invalid?error.message:'Request failed.'} Completed history is used when available.`;}
 const historySymbols=['SPY','QQQ','RSP','IWM',...SECTORS.map(s=>s.symbol)];
 if(snapshot.history_session!==completedSessionDate()||!historySymbols.every(symbol=>(snapshot.history[symbol]??[]).some(p=>p.date===completedSessionDate()))){
  const symbols=historySymbols;snapshot.history={...snapshot.history};snapshot.history_errors=[];
  for(let i=0;i<symbols.length;i+=3){await Promise.all(symbols.slice(i,i+3).map(async symbol=>{try{snapshot.history[symbol]=parseHistory(await query(key,{function:'TIME_SERIES_DAILY_ADJUSTED',symbol,outputsize:'compact'},fetcher));}catch(error){snapshot.history_errors.push(`${symbol}: ${error instanceof Invalid?error.message:'Adjusted daily history unavailable.'}`);}}));}
  snapshot.history_session=completedSessionDate();snapshot.history_fetched_at=new Date().toISOString();
 }
 if(!snapshot.quotes.SPY&&!snapshot.history.SPY?.length)throw new Invalid(`No usable market data returned. ${snapshot.history_errors.find(x=>x.startsWith('SPY:'))||snapshot.realtime_error}`,422);
 snapshot.data_mode=snapshot.realtime_status==='verified_response'?'realtime_and_daily':'daily_only';
 return snapshot;
}

// Shared feed diagnostics: contains no user records, keys or provider payloads.
export async function probeMarketFeed(key,fetcher=fetch){
 if(!key)return {configured:false,status:'missing_key'};
 const checks=[];for(const symbol of ['SPY','XLK']){try{const bars=parseHistory(await query(key,{function:'TIME_SERIES_DAILY_ADJUSTED',symbol,outputsize:'compact'},fetcher));checks.push({symbol,status:bars.length>=21?'ok':'insufficient_history',bars:bars.length,latest_session:bars[0]?.date??null});}catch(error){checks.push({symbol,status:'failed',error:error instanceof Invalid?error.message:'Provider request failed.'});}}
 return {configured:true,status:checks.every(x=>x.status==='ok')?'ok':'failed',checks,checked_at:new Date().toISOString()};
}
