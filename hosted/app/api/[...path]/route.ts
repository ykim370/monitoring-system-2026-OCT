import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { fresh, operate } from '../../../lib/workspace.mjs';
import { portfolio, Invalid } from '../../../lib/domain.mjs';

export const dynamic='force-dynamic';
function json(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});}
async function handle(req:Request,context:{params:Promise<{path:string[]}>}){
 try{
  const user=await getChatGPTUser(),path=(await context.params).path.join('/');
  if(path==='session'&&req.method==='GET')return json({authenticated:!!user,mode:'paper',execution_enabled:false});
  if(!user)return json({error:'Sign in with ChatGPT to open your private workspace.'},401);
  const database=env.DB;if(!database)throw new Error('Database binding unavailable.');
  const db=database.withSession('first-primary');
  const init=JSON.stringify(fresh());
  await db.prepare('INSERT OR IGNORE INTO workspaces(owner,revision,data,updated_at) VALUES(?,0,?,?)').bind(user.userId,init,new Date().toISOString()).run();
  const stored=await db.prepare('SELECT revision,data FROM workspaces WHERE owner=?').bind(user.userId).first<{revision:number,data:string}>();
  if(!stored)throw new Error('Workspace unavailable.');
  const state=JSON.parse(stored.data);
  if(req.method==='GET'&&path==='workspace'){
   const history=await db.prepare('SELECT id,payload FROM audit_events WHERE owner=? ORDER BY id DESC LIMIT 100').bind(user.userId).all<{id:number,payload:string}>();
   const audit=history.results.flatMap(row=>JSON.parse(row.payload).map((event:Record<string,unknown>,i:number)=>({...event,sequence:row.id*10000+i})).reverse()).slice(0,100);
   const feed=await db.prepare('SELECT encrypted_secret IS NOT NULL AS connected FROM radar_connections WHERE owner=?').bind(user.userId).first<{connected:number}>();
   return json({...state,summary:portfolio(state.positions,state.settings),audit,generated_at:new Date().toISOString(),capabilities:{mode:'paper',feeds_connected:!!feed?.connected||!!env.ALPHA_VANTAGE_API_KEY,forecasting_enabled:false,execution_enabled:false,monitoring_scope:'Manual records and deterministic paper risk checks'},storage:'cloud'});
  }
  if(!['POST','PATCH','DELETE'].includes(req.method))throw new Invalid('Not found.',404);
  if(req.headers.get('Origin')!==new URL(req.url).origin||req.headers.get('X-Workspace-Intent')!=='write')throw new Invalid('Write requests require the same origin.',403);
  if(req.headers.get('Content-Type')?.split(';')[0]!=='application/json')throw new Invalid('Use application/json.',415);
  const raw=await req.text();if(new TextEncoder().encode(raw).length>1100000)throw new Invalid('Request exceeds 1.1 MB.',413);
  let input;try{input=JSON.parse(raw);}catch{throw new Invalid('Invalid JSON.');}
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Invalid('JSON body must be an object.');
  const {result,events,status}=operate(state,path,req.method,input);
  if(events.length){
   const next=stored.revision+1,at=new Date().toISOString();
   const payload=JSON.stringify(state);if(new TextEncoder().encode(payload).length>1500000)throw new Invalid('Workspace exceeds the current 1.5 MB limit. Export records before adding more.',413);
   const results=await db.batch([
    db.prepare('UPDATE workspaces SET data=?,revision=?,updated_at=? WHERE owner=? AND revision=?').bind(payload,next,at,user.userId,stored.revision),
    db.prepare('INSERT INTO audit_events(owner,revision,payload,created_at) SELECT ?,?,?,? WHERE changes()=1').bind(user.userId,next,JSON.stringify(events),at)
   ]);
   if(results[0].meta.changes!==1)throw new Invalid('Workspace changed on another device. Refresh and try again.',409);
  }
  return json(result,status);
 }catch(error){if(error instanceof Invalid)return json({error:error.message},error.status);console.error('Workspace request failed',error instanceof Error?error.message:'unknown');return json({error:'The workspace could not complete this request. No partial change was saved.'},500);}
}
export {handle as GET,handle as POST,handle as PATCH,handle as DELETE};
