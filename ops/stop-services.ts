// Reuse the verified process ownership checks, while leaving supervised Postgres up.
import { readFile,rm,realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const root=await realpath(process.cwd());
for(const name of ['origin','teller']){
 const path=`.data/${name}.pid`;if(!existsSync(path))continue;const pid=Number(await readFile(path,'utf8'));
 if(!Number.isInteger(pid)||pid<2)throw new Error('Invalid PID');
 let command:string;try{command=execFileSync('ps',['-p',String(pid),'-o','command='],{encoding:'utf8'});}catch{await rm(path);continue;}
 if(!command.includes(name==='teller'?`${root}/vendor/teller/target/teller-0.0.1-SNAPSHOT.jar`:`${root}/origin/server.ts`))throw new Error('Process ownership mismatch');
 process.kill(pid,'SIGTERM');let stopped=false;for(let i=0;i<150;i++){try{process.kill(pid,0);}catch{stopped=true;break;}await new Promise(r=>setTimeout(r,100));}
 if(!stopped)throw new Error('Process did not stop');await rm(path,{force:true});
}
