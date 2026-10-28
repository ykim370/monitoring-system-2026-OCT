import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { Invalid } from '../../../lib/domain.mjs';
import { radar, validateContext } from '../../../lib/sector-radar.mjs';
import { encryptAPIKey, decryptAPIKey, fetchSnapshot } from '../../../lib/radar-provider.mjs';

export const dynamic='force-dynamic';
type Row={encrypted_secret:string|null,snapshot:string|null,context:string,last_refresh:number,revision:number};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function handle(req:Request){try{
 const user=await getChatGPTUser();if(!user)return json({error:'Sign in with ChatGPT.'},401);
 if(!env.DB)throw new Invalid('The database is unavailable.',503);const db=env.DB.withSession('first-primary');
 let row=await db.prepare('SELECT encrypted_secret,snapshot,context,last_refresh,revision FROM radar_connections WHERE owner=?').bind(user.userId).first<Row>();
 if(req.method!=='GET'){
  if(req.headers.get('Origin')!==new URL(req.url).origin||req.headers.get('X-Workspace-Intent')!=='write')throw new Invalid('Same-origin writes are required.',403);
  if(req.headers.get('Content-Type')?.split(';')[0]!=='application/json')throw new Invalid('Use JSON.',415);
  const raw=await req.text();if(new TextEncoder().encode(raw).length>100000)throw new Invalid('Request is too large.',413);
  let data;try{data=JSON.parse(raw);}catch{throw new Invalid('Invalid JSON.');}if(!data||typeof data!=='object'||Array.isArray(data))throw new Invalid('Use a JSON object.');
  if(req.method==='POST'&&data.action==='connect'){
   if(row?.encrypted_secret)throw new Invalid('A data feed is already connected. Disconnect it before replacing the key.',409);
   const encrypted=await encryptAPIKey(data.api_key,env.DATA_ENCRYPTION_KEY,user.userId);
   // A valid quote response proves entitlement; there is no provider-demo fallback.
   const snapshot=await fetchSnapshot(data.api_key);
   const changed=await db.prepare("INSERT INTO radar_connections(owner,encrypted_secret,snapshot,context,last_refresh,revision,updated_at) VALUES(?,?,?,'{}',?,1,?) ON CONFLICT(owner) DO UPDATE SET encrypted_secret=excluded.encrypted_secret,snapshot=excluded.snapshot,last_refresh=excluded.last_refresh,revision=radar_connections.revision+1,updated_at=excluded.updated_at WHERE radar_connections.encrypted_secret IS NULL").bind(user.userId,encrypted,JSON.stringify(snapshot),Date.now(),new Date().toISOString()).run();
   if(changed.meta.changes!==1)throw new Invalid('Connection changed on another device. Refresh.',409);
  }else if(req.method==='POST'&&data.action==='refresh'){
   if(!row?.encrypted_secret&&!env.ALPHA_VANTAGE_API_KEY)throw new Invalid('Connect your Alpha Vantage market-data key first.',409);
   if(!row){await db.prepare("INSERT OR IGNORE INTO radar_connections(owner,context,last_refresh,revision,updated_at) VALUES(?,'{}',0,1,?)").bind(user.userId,new Date().toISOString()).run();row=await db.prepare('SELECT encrypted_secret,snapshot,context,last_refresh,revision FROM radar_connections WHERE owner=?').bind(user.userId).first<Row>();}
   if(!row)throw new Invalid('The data connection is unavailable.',503);
   const started=Date.now(),lease=await db.prepare('UPDATE radar_connections SET last_refresh=? WHERE owner=? AND last_refresh<?').bind(started,user.userId,started-300000).run();
   if(lease.meta.changes!==1)throw new Invalid('Refresh requests are limited to once every five minutes. Cached source timestamps remain visible.',429);
   const key=row.encrypted_secret?await decryptAPIKey(row.encrypted_secret,env.DATA_ENCRYPTION_KEY,user.userId):env.ALPHA_VANTAGE_API_KEY;
   let snapshot;
   try{snapshot=await fetchSnapshot(key,row.snapshot?JSON.parse(row.snapshot):{});}
   catch(error){const message=error instanceof Invalid?error.message:'Market data refresh failed.';
    const previous=row.snapshot?JSON.parse(row.snapshot):{};
    await db.prepare('UPDATE radar_connections SET snapshot=?,last_refresh=?,updated_at=? WHERE owner=? AND encrypted_secret IS ? AND last_refresh=?').bind(JSON.stringify({...previous,refresh_error:message,refresh_failed_at:new Date().toISOString()}),started-240000,new Date().toISOString(),user.userId,row.encrypted_secret,started).run();
    throw error;
   }
   const updated=await db.prepare('UPDATE radar_connections SET snapshot=?,updated_at=? WHERE owner=? AND encrypted_secret IS ? AND last_refresh=?').bind(JSON.stringify(snapshot),new Date().toISOString(),user.userId,row.encrypted_secret,started).run();
   if(updated.meta.changes!==1)throw new Invalid('Connection changed during refresh. Refresh the page.',409);
  }else if(req.method==='POST'&&data.action==='context'){
   const context=validateContext(data.context);
   if(row&&data.revision!==row.revision)throw new Invalid('Context changed on another device. Refresh before editing.',409);
   if(!row){const inserted=await db.prepare('INSERT OR IGNORE INTO radar_connections(owner,context,last_refresh,revision,updated_at) VALUES(?,?,0,1,?)').bind(user.userId,JSON.stringify(context),new Date().toISOString()).run();if(inserted.meta.changes!==1)throw new Invalid('Context changed. Refresh.',409);}
   else{const updated=await db.prepare('UPDATE radar_connections SET context=?,revision=revision+1,updated_at=? WHERE owner=? AND revision=?').bind(JSON.stringify(context),new Date().toISOString(),user.userId,row.revision).run();if(updated.meta.changes!==1)throw new Invalid('Context changed. Refresh.',409);}
  }else if(req.method==='DELETE'){
   if(!row?.encrypted_secret&&env.ALPHA_VANTAGE_API_KEY)throw new Invalid('This feed uses a managed server secret. Remove it through server settings to disconnect.',409);
   if(data.confirmation!=='DISCONNECT')throw new Invalid('Type DISCONNECT to remove the saved API credential.');
   await db.prepare('UPDATE radar_connections SET encrypted_secret=NULL,snapshot=NULL,last_refresh=0,revision=revision+1,updated_at=? WHERE owner=?').bind(new Date().toISOString(),user.userId).run();
  }else throw new Invalid('Unknown operation.',404);
  row=await db.prepare('SELECT encrypted_secret,snapshot,context,last_refresh,revision FROM radar_connections WHERE owner=?').bind(user.userId).first<Row>();
 }
 const snapshot=row?.snapshot?JSON.parse(row.snapshot):null,context=row?.context?JSON.parse(row.context):{};
 const hasKey=!!row?.encrypted_secret||!!env.ALPHA_VANTAGE_API_KEY;
 return json({connected:hasKey,managed_key:!row?.encrypted_secret&&!!env.ALPHA_VANTAGE_API_KEY,refresh_due:hasKey&&Date.now()-(row?.last_refresh??0)>=300000,data_mode:snapshot?.data_mode??'configured',realtime_status:snapshot?.realtime_status??'not_checked',feed_notice:snapshot?.refresh_error??snapshot?.realtime_error??null,feed_error:snapshot?.refresh_error??null,history_as_of:snapshot?.history?.SPY?.[0]?.date??null,revision:row?.revision??0,last_refresh:row?.last_refresh??null,context,report:radar(snapshot,context),history_errors:snapshot?.history_errors??[],provider:hasKey?'Alpha Vantage':null,setup_required:!hasKey,automatic_notifications:false});
 }catch(error){if(error instanceof Invalid)return json({error:error.message},error.status);return json({error:'The radar could not complete this request. Existing records were retained.'},500);}}
export {handle as GET,handle as POST,handle as DELETE};
