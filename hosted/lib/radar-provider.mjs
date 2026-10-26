import { Invalid } from './domain.mjs';
import { SYMBOLS, SECTORS, parseBulk, parseHistory, completedSessionDate } from './sector-radar.mjs';

const bytes64=b=>btoa(String.fromCharCode(...b));
const from64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function encryptionKey(secret){if(typeof secret!=='string'||!/^[a-f0-9]{64}$/.test(secret))throw new Invalid('Secure feed configuration is unavailable.',503);return crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/../g),s=>parseInt(s,16)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
export async function encryptAPIKey(value,secret,owner){if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(value)||value.toLowerCase()==='demo')throw new Invalid('Enter your own Alpha Vantage API key. Demo keys are not accepted.');const key=await encryptionKey(secret),iv=crypto.getRandomValues(new Uint8Array(12));const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(owner)},key,new TextEncoder().encode(value));return JSON.stringify({v:1,iv:bytes64(iv),ciphertext:bytes64(new Uint8Array(ciphertext))});}
export async function decryptAPIKey(value,secret,owner){const data=JSON.parse(value),key=await encryptionKey(secret);if(data.v!==1)throw new Invalid('Unsupported encrypted connection.',503);try{return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:from64(data.iv),additionalData:new TextEncoder().encode(owner)},key,from64(data.ciphertext)));}catch{throw new Invalid('The data connection needs to be reconnected.',503);}}
async function query(key,params,fetcher=fetch){const url=new URL('https://www.alphavantage.co/query');for(const [name,value] of Object.entries({...params,apikey:key}))url.searchParams.set(name,value);let response;try{response=await fetcher(url,{signal:AbortSignal.timeout(12000),redirect:'error'});}catch{throw new Invalid('The market-data provider did not respond. Existing data remains timestamped.',502);}if(!response.ok)throw new Invalid('The market-data provider returned an error. Check service availability.',502);let data;try{data=await response.json();}catch{throw new Invalid('The provider returned an unsupported response.',502);}if(data.Information||data.Note||data['Error Message'])throw new Invalid('The provider rejected the request. Check your API key, rate allowance and required market-data entitlement.',422);return data;}
export async function fetchSnapshot(key,previous={},fetcher=fetch){
 const snapshot={quotes:{},history:previous.history??{},history_session:previous.history_session??null,history_fetched_at:previous.history_fetched_at??null,history_errors:previous.history_errors??[],fetched_at:new Date().toISOString(),provider:'Alpha Vantage',realtime_status:'unavailable',realtime_error:null,timestamp_timezone_assumption:'America/New_York when the provider omits an explicit offset'};
 try{snapshot.quotes=parseBulk(await query(key,{function:'REALTIME_BULK_QUOTES',symbol:SYMBOLS.join(',')},fetcher));snapshot.realtime_status='verified_response';}
 catch{snapshot.realtime_error='Genuine realtime quotes were not returned. Intraday outlooks remain blocked; completed daily history is used when available.';}
 const historySymbols=['SPY','QQQ','RSP','IWM',...SECTORS.map(s=>s.symbol)];
 if(snapshot.history_session!==completedSessionDate()||!historySymbols.every(symbol=>(snapshot.history[symbol]??[]).some(p=>p.date===completedSessionDate()))){
  const symbols=historySymbols;snapshot.history={};snapshot.history_errors=[];
  for(let i=0;i<symbols.length;i+=3){await Promise.all(symbols.slice(i,i+3).map(async symbol=>{try{snapshot.history[symbol]=parseHistory(await query(key,{function:'TIME_SERIES_DAILY_ADJUSTED',symbol,outputsize:'compact'},fetcher));}catch{snapshot.history_errors.push(`${symbol}: adjusted daily history unavailable; few-day outlook remains unconfirmed.`);}}));}
  snapshot.history_session=completedSessionDate();snapshot.history_fetched_at=new Date().toISOString();
 }
 if(!snapshot.quotes.SPY&&!snapshot.history.SPY?.length)throw new Invalid('No usable market data returned. Check the API key, subscription permissions and rate allowance.',422);
 snapshot.data_mode=snapshot.realtime_status==='verified_response'?'realtime_and_daily':'daily_only';
 return snapshot;
}
