import { database } from './d1.ts';
import { dispatch } from '../packages/gate/dispatch.ts';
import { upstreamIO } from '../packages/gate/upstream.ts';
import type { Hold } from '../packages/gate/holds.ts';
const [path,id,boundary]=process.argv.slice(2),{db}=database(path);
const h=await db.prepare('SELECT * FROM holds WHERE id=?').bind(id).first<Hold>();
if(!h)throw new Error('Missing test hold');
await dispatch(db,h,upstreamIO('http://127.0.0.1:18081',process.env.ORIGIN_SIGNING_SECRET!,h.epoch),{
 boundary:async name=>{if(name===boundary){process.send?.({boundary:name});await new Promise(()=>{});}},
});
process.exit(0);
