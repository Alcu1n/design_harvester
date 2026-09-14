"use client";
import {useState} from 'react';
import {DownloadButton} from './download-button';
export function QualityDetails({url,imageSource}:{url:string;imageSource:boolean}){
 const [report,setReport]=useState<any>(),[error,setError]=useState('');
 const labels:Record<string,string>={evidenceAccuracy:'证据准确性',visualFidelity:'视觉还原',designAbstraction:'设计抽象',responsiveUnderstanding:imageSource?'跨页面一致性':'响应式理解',iosAdaptation:'iOS 适配'};
 return <details className="score-details" onToggle={async e=>{if(!e.currentTarget.open||report)return;try{const r=await fetch(url);if(!r.ok)throw Error('评分报告尚未生成。');setReport(await r.json());setError('');}catch(e){setError(e instanceof Error?e.message:'暂时无法读取评分。');}}}>
  <summary>质量评分说明</summary><p>评分仅供参考，不影响文档完成。单图不计跨页面一致性。</p>
  {report&&<><dl>{Object.entries(labels).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{report.notApplicable?.includes(key)?'不适用':report.subscores?.[key]??'未评估'}</dd></div>)}</dl>{report.issues?.map((i:any,index:number)=><p key={index}>{i.message}</p>)}</>}
  {error&&<p>{error}</p>}<DownloadButton variant="ghost" url={url+'?download'} filename="quality-score.json">下载评分报告</DownloadButton>
 </details>;
}
