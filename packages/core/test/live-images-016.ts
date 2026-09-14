// Explicit release acceptance fixture. Not part of automated tests; subscription provider only.
import sharp from 'sharp';
import {mkdir,writeFile} from 'node:fs/promises';
import {createImageRun} from '../src/image-import.ts';
import {processTask} from '../src/pipeline.ts';
import {detail} from '../src/service.ts';
import {AntigravityProvider} from '../src/antigravity.ts';
import {pool,sql} from '../src/db.ts';
import {get} from '../src/storage.ts';
const svg=`<svg width="780" height="1400" xmlns="http://www.w3.org/2000/svg"><rect width="780" height="1400" fill="#f4efdf"/><text x="56" y="110" font-family="Georgia" font-size="58" fill="#253e32">Field Notes</text><text x="56" y="163" font-family="Arial" font-size="25" fill="#697467">A small space for careful observation.</text><rect x="56" y="220" width="668" height="370" rx="16" fill="#253e32"/><text x="94" y="280" fill="#f4efdf" font-family="Arial" font-size="20">TODAY · SEPTEMBER 14</text><text x="94" y="355" fill="#f4efdf" font-family="Georgia" font-size="45">Leave room to notice.</text><text x="94" y="418" fill="#d8e2d0" font-family="Arial" font-size="25">Capture one thought before it disappears.</text><rect x="94" y="475" width="220" height="64" rx="32" fill="#e4bb70"/><text x="130" y="517" font-family="Arial" font-size="24" fill="#253e32">Write a note</text><text x="56" y="681" font-family="Georgia" font-size="38" fill="#253e32">Recent pages</text><rect x="56" y="720" width="668" height="160" rx="12" fill="#fffdf5" stroke="#d9d6c7"/><text x="86" y="780" font-family="Georgia" font-size="31" fill="#253e32">Morning by the window</text><text x="86" y="832" font-family="Arial" font-size="23" fill="#697467">A warm cup, a quiet street, a fresh page.</text><rect x="56" y="904" width="668" height="160" rx="12" fill="#fffdf5" stroke="#d9d6c7"/><text x="86" y="964" font-family="Georgia" font-size="31" fill="#253e32">Things worth keeping</text><text x="86" y="1016" font-family="Arial" font-size="23" fill="#697467">Collect the details that feel like home.</text><path d="M56 1225H724" stroke="#d9d6c7"/><text x="102" y="1303" font-family="Arial" font-size="26" fill="#253e32">Journal</text><text x="324" y="1303" font-family="Arial" font-size="26" fill="#697467">Collections</text><text x="587" y="1303" font-family="Arial" font-size="26" fill="#697467">Settings</text></svg>`;
const bytes=await sharp(Buffer.from(svg)).png().toBuffer();
const out=process.env.ACCEPTANCE_PATH!;await mkdir(out,{recursive:true});await writeFile(out+'/sample.png',bytes);
const run=await createImageRun([new File([new Uint8Array(bytes)],'field-notes.png',{type:'image/png'})],'Field Notes acceptance','A single mobile journaling interface; image observations only.');
try{
 console.log(JSON.stringify({run}));await processTask(run.runId,new AntigravityProvider());
 const result=await detail(run.designId);const v=result.versions[0];
 await writeFile(out+'/result.json',JSON.stringify(result,null,2));
 for(const name of ['DESIGN.md','IOS_design.md','critic.json','display-zh.json']){
  const file=await get(`${run.designId}/versions/${v.id}/${name}`).catch(()=>null);if(file)await writeFile(out+'/'+name,file);
 }
 console.log(JSON.stringify({status:result.tasks[0].status,error:result.tasks[0].error,score:v.score,dna:!!v.display_zh}));
}finally{await pool.end();}
