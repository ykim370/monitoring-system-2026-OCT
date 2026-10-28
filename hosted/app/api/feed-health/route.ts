import { env } from 'cloudflare:workers';
import { probeMarketFeed } from '../../../lib/radar-provider.mjs';
// The Site is owner-private. Sites dispatch enforces browser/service access.
// This endpoint exposes shared connection health only, never owner records.
export const dynamic='force-dynamic';
export async function GET(){return Response.json(await probeMarketFeed(env.ALPHA_VANTAGE_API_KEY),{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
