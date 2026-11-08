import { readFileSync,writeFileSync,mkdirSync,readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const serviceUser=process.argv[2],root=resolve('.');
if(!/^[a-z_][a-z0-9_-]*$/.test(serviceUser??'')||/[<>&"']/.test(root))throw new Error('Supply a macOS short user name and a plain checkout path');
mkdirSync('.data/launchd',{recursive:true});
for(const name of readdirSync('ops/launchd'))writeFileSync('.data/launchd/'+name,readFileSync('ops/launchd/'+name,'utf8').replaceAll('@ROOT@',root).replaceAll('@SERVICE_USER@',serviceUser),{mode:0o600});
writeFileSync('.data/tunnel.yml',readFileSync('ops/tunnel.yml','utf8').replaceAll('@ROOT@',root),{mode:0o600});
console.log('Rendered files in .data. Replace tunnel UUID and hostname. Nothing installed or loaded.');
