import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
if (process.argv[2]==='child') {
 let db;
 process.on('message', input=>{
  if(input.release){db?.close();db=null;process.send({released:true});return;}
  const at=BigInt(input.at);while(process.hrtime.bigint()<at){}
  let stage='open';const events=[];
  try {
   db=new DatabaseSync(input.path);
   if(input.batch){stage='batch';db.exec(input.sql.join(';'));}
   else for(const sql of input.sql){stage=sql;events.push({stage,at:process.hrtime.bigint().toString()});db.exec(sql);}
   process.send({ok:true,stage,events});
  }catch(error){process.send({ok:false,stage,events,message:error.message,code:error.code,errcode:error.errcode});db?.close();db=null;}
 });
 process.send({ready:true});
} else {
 const root=await mkdtemp(join(tmpdir(),'legion-native-lock-'));const rounds=Number(process.argv[2]??500);const output=process.argv[3];
 const peers=[0,1].map(()=>{const p=fork(new URL(import.meta.url),['child'],{stdio:['ignore','ignore','ignore','ipc']});return {p,ready:once(p,'message')};});await Promise.all(peers.map(p=>p.ready));
 const cases=[
 ['baseline-batch',true,['PRAGMA journal_mode=DELETE','PRAGMA synchronous=FULL','PRAGMA busy_timeout=0','CREATE TABLE IF NOT EXISTS owner(id INTEGER)','BEGIN EXCLUSIVE']],
 ['baseline-stepped',false,['PRAGMA journal_mode=DELETE','PRAGMA synchronous=FULL','PRAGMA busy_timeout=0','CREATE TABLE IF NOT EXISTS owner(id INTEGER)','BEGIN EXCLUSIVE']],
 ['no-create',false,['PRAGMA journal_mode=DELETE','PRAGMA synchronous=FULL','PRAGMA busy_timeout=0','BEGIN EXCLUSIVE']],
 ['begin-only',false,['BEGIN EXCLUSIVE']],
 ['immediate-only',false,['BEGIN IMMEDIATE']]
 ];const results=[];
 for (const [name,batch,sql] of cases){const records=[];let zeros=0,twos=0,winners=[0,0];const failures={};
  for(let r=0;r<rounds;r++){
   const path=join(root,`${name}-${r}.lock`),at=(process.hrtime.bigint()+1000000n).toString();
   const rs=await Promise.all(peers.map(({p})=>{const result=once(p,'message').then(([x])=>x);p.send({path,at,sql,batch});return result;}));
   const count=rs.filter(x=>x.ok).length;if(count===0)zeros++;if(count===2)twos++;
   rs.forEach((x,i)=>{if(x.ok)winners[i]++;else failures[x.stage]=(failures[x.stage]??0)+1;});
   if(count!==1)records.push({r,path,rs});
   await Promise.all(peers.map(({p})=>{const result=once(p,'message');p.send({release:true});return result;}));
  }
  const result={name,rounds,zeros,twos,winners,failures,records};results.push(result);console.log(JSON.stringify({...result,records:result.records.length}));
 }
 for(const {p} of peers){const exit=once(p,'exit');p.kill('SIGKILL');await exit;}
 if(output)await writeFile(output,JSON.stringify({root,results},null,2)+'\n');
}
