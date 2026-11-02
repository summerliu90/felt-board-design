import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Document } from '../types'
import { Modal } from './Dialog'
type Job={mode:string;targetId?:string;targetSignature?:string;boardId:string;unitsPerCm:number;prompt:string;id:string;status:string;error?:string;url?:string;pixelWidth?:number;pixelHeight?:number;widthCm:number;heightCm:number;commands?:Record<string,unknown>[]}
async function request<T>(path:string,method='GET',body?:unknown):Promise<T>{
 const r=await fetch(`/api/studio/${path}`,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw new Error(data.error??'请求失败');return data
}
export function StudioPanel({doc,boardID,projectID,onRun,onClose}:{boardID:string;projectID:string;doc:Document;selected?:string[];onRun:(cmd:unknown)=>Promise<{ok:boolean;error?:string}|undefined>;onClose:()=>void}){
 const [mode,setMode]=useState('asset')
 const [prompt,setPrompt]=useState(''),[refs,setRefs]=useState<{url:string;name:string}[]>([])
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[job,setJob]=useState<Job|null>(null),[replace,setReplace]=useState(false)
 const jobKey=`dv-generation-${projectID}-${boardID}`
 const physical=doc.canvas.physical
 useEffect(()=>{const saved=sessionStorage.getItem(jobKey);if(saved)request<Job>(`jobs/${saved}`).then(setJob).catch(()=>sessionStorage.removeItem(jobKey))},[jobKey])
 useEffect(()=>{if(job)sessionStorage.setItem(jobKey,job.id)},[job?.id,jobKey])
 useEffect(()=>{if(!job||job.status!=='running')return;let alive=true;const timer=setInterval(()=>{request<Job>(`jobs/${job.id}`).then(v=>{if(alive)setJob(v)}).catch(e=>{if(alive)setError(e.message)})},1500);return()=>{alive=false;clearInterval(timer)}},[job?.id,job?.status])
 async function action(fn:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await fn()}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 async function upload(files:FileList|null){if(!files)return;await action(async()=>{if(files.length+refs.length>8)throw new Error('最多8张参考图');const added:{url:string;name:string}[]=[];for(const file of Array.from(files)){if(!['image/png','image/jpeg'].includes(file.type)||file.size>20*1024*1024)throw new Error('请上传20MB以内的 PNG 或 JPEG');added.push({url:await api.uploadAsset(file),name:file.name})}setRefs(v=>[...v,...added])})}
 async function importPlan(file:File|null){if(!file)return;await action(async()=>{const raw=JSON.parse(await file.text());const source=Array.isArray(raw)?raw:(Array.isArray(raw.commands)?raw.commands:Array.isArray(raw.layers)?raw.layers:[]);if(!source.length)throw new Error('JSON 中没有可导入的分层命令');if(source.some((c:any)=>c.type==='addImage'&&!c.url))throw new Error('图片命令缺少可用素材地址；请使用完整编辑工程包，不能以占位框代替素材');const commands=source;const result=await onRun(commands);if(!result?.ok)throw new Error(result?.error??'导入方案失败');setNotice(`已导入 ${commands.length} 个 Codex 分层元素，可继续拖拽编辑。`);})}
 async function importLatestCodex(){await action(async()=>{const r=await request<{url:string;name:string}>('import-latest-codex','POST');const w=physical?.unitsPerCm??20;const result=await onRun({type:'addImage',url:r.url,name:r.name,x:0,y:0,width:(physical?.widthCm??40)*w,height:(physical?.heightCm??20)*w});if(!result?.ok)throw new Error(result?.error??'导入失败');setNotice('已将最近的 Codex 图片导入为独立图层；如需文字和插画分别编辑，请继续导入分层 JSON。')})}
 async function apply(){await action(async()=>{
  if(!physical||!job)return
  if(job.boardId!==boardID)throw new Error('当前画板与生成时不同，请切回原画板再应用')
  const original=job.targetId?doc.layers.find(l=>l.id===job.targetId):undefined
  if(job.targetId&&(!original||JSON.stringify(original)!==job.targetSignature))throw new Error('目标图层在生成期间已修改，请重新生成，避免覆盖你的编辑')
  if(job.commands){
   if(job.mode==='textstyle'&&job.unitsPerCm!==physical.unitsPerCm)throw new Error('画布厘米比例已改变，请重新分析文字样式')
   const commands=job.mode==='textstyle'?job.commands:[{type:'addBoard',name:'生成方案',width:job.widthCm*job.unitsPerCm,height:job.heightCm*job.unitsPerCm},{type:'setPhysicalCanvas',widthCm:job.widthCm,heightCm:job.heightCm,unitsPerCm:job.unitsPerCm},...job.commands]
   const result=await onRun(commands);if(!result?.ok)throw new Error(result?.error??'应用方案失败');setNotice(job.mode==='textstyle'?'已更新原生文字样式，文字内容保留，可撤销。':'已在新画板添加分层方案，原画板保留。');return
  }
  if(!job.url)return
  const result=await onRun(job.targetId?{type:'replaceImage',id:job.targetId,url:job.url}:{type:'addImage',url:job.url,name:job.prompt.slice(0,24)||'生成插画',x:0,y:0,width:job.widthCm*physical.unitsPerCm,height:job.heightCm*physical.unitsPerCm})
  if(!result?.ok)throw new Error(result?.error??'应用失败');setNotice('已应用为独立图片图层，可拖拽或撤销。')
 })}
 const input='w-full border rounded p-2'
 return <Modal onClose={onClose} width="w-[520px]" placement="left-bottom" label="生成工作室"><div className="max-h-[78vh] overflow-y-auto p-5 flex flex-col gap-3">
  <div className="flex gap-3 items-center"><h2 className="font-bold text-xl">生成素材</h2><span className="text-xs text-muted">Codex 负责理解设计，图片 API 负责出图</span><button className="btn-ghost ml-auto" onClick={onClose}>关闭</button></div>
  {error&&<p role="alert" className="text-red-700">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <>
   <p>画布：{physical?`${physical.widthCm} × ${physical.heightCm} 厘米`:'未设置厘米尺寸'}。生成图片作为独立素材；正文使用可编辑文字图层。</p>
   {!physical&&<button className="btn-ghost" onClick={()=>void action(async()=>{const r=await onRun({type:'setPhysicalCanvas',widthCm:doc.canvas.width/20,heightCm:doc.canvas.height/20,unitsPerCm:20});if(!r?.ok)throw new Error(r?.error??'设置失败')})}>当前画布设为20编辑单位/厘米</button>}
   <label>生成方式<select aria-label="生成方式" value={mode} onChange={e=>setMode(e.target.value)}><option value="asset">单件插画 / 卡片素材</option><option value="poster">整板分层海报（按当前厘米画布）</option><option value="textstyle">参考图修改选中文字样式</option></select></label>
   {mode==='textstyle'&&<p className="text-sm">上传字体外观参考图，选择本机最接近的可用字体并匹配颜色、描边与字距。原文保留可编辑；不会将图片中的字体当成已安装字体。</p>}
   {mode==='poster'&&<p className="text-sm">Codex 会先理解你的主题、内容分区和设计要求，再生成原生标题、正文、底板与独立插画图层。应用时新建画板，文字和图片分别可编辑。</p>}
   <label>Codex 设计描述<textarea aria-label="Codex 设计描述" className={input} rows={5} value={prompt} onChange={e=>setPrompt(e.target.value)} onPaste={e=>{const files=Array.from(e.clipboardData.files).filter(f=>['image/png','image/jpeg','image/webp'].includes(f.type));if(files.length){e.preventDefault();const dt=new DataTransfer();files.forEach(f=>dt.items.add(f));void upload(dt.files)}}} placeholder="在当前对话中让 Codex 生成分层 JSON；这里可记录本次方案说明。也可以直接粘贴截图或参考图。"/></label>
   <div className="flex items-center gap-3 flex-wrap"><label className="btn-primary cursor-pointer"><input className="sr-only" type="file" accept="application/json,.json" onChange={e=>void importPlan(e.target.files?.[0]??null)}/>导入 Codex JSON</label><button className="btn-ghost" disabled={busy} onClick={()=>void importLatestCodex()}>导入最近 Codex 图片</button><span className="text-xs text-muted">Codex 负责方案；编辑器负责分层编辑</span></div>
   <div className="flex flex-col gap-2">
    <span className="font-semibold">参考附件</span>
    <label className="flex items-center gap-3">
     <input aria-label="上传参考附件" className="sr-only" type="file" accept="image/png,image/jpeg" multiple disabled={busy} onChange={e=>void upload(e.target.files)}/>
     <span className="btn-ghost cursor-pointer rounded-full px-4 py-2 font-semibold">选择参考文件</span>
     <span className="text-sm text-muted">{refs.length?`已选择 ${refs.length} 个文件`:'未选择文件'}</span>
    </label>
    <p className="text-xs text-muted">支持 PNG/JPG，可多选，单个文件不超过 20MB。</p>
   </div>
   <div className="flex gap-2 flex-wrap">{refs.map(r=><div className="flex items-center gap-2 rounded-xl border border-line px-2 py-1" key={r.url}><img className="h-12 w-12 rounded object-contain" src={r.url} alt={r.name}/><span className="max-w-48 truncate text-xs" title={r.name}>{r.name}</span><button className="text-xs text-accent" onClick={()=>setRefs(v=>v.filter(x=>x.url!==r.url))}>移除</button></div>)}</div>
   {mode==='asset'&&<label><input type="checkbox" checked={replace} onChange={e=>setReplace(e.target.checked)}/> 修改选中插画（生成后预览，再替换）</label>}
   <p className="text-sm text-muted">请先在 Codex 中生成分层 JSON，再点击“导入 Codex JSON”。导入后所有文字、底板和图片占位均可单独编辑。</p>
   {job?.status==='running'&&<div role="status">正在生成……<button className="btn-ghost" onClick={()=>void request<Job>(`jobs/${job.id}`,'DELETE').then(setJob).catch(e=>setError(e.message))}>取消</button></div>}
   {job?.status==='failed'&&<p role="alert">{job.error}</p>}
   {job?.commands&&<div className="border rounded p-3"><p>分层方案共 {job.commands.filter(c=>c.type!=='setBackground').length} 个独立元素：</p><ul>{job.commands.filter(c=>c.type!=='setBackground').map((c,i)=><li key={i}>{String(c.name)} · {String(c.type)}{c.type==='addText'?`：${String(c.text)}`:''}</li>)}</ul><button className="btn-primary" disabled={busy} onClick={()=>void apply()}>{job.mode==='textstyle'?'应用到原文字图层':'应用到新画板'}</button></div>}
   {job?.url&&<><img className="max-h-64 object-contain" src={job.url} alt="生成预览"/><p>成品图片 {job.pixelWidth}×{job.pixelHeight} 像素，对应 {job.widthCm}×{job.heightCm} 厘米。比例不同会透明补边，原始像素保留，不拉伸、不裁掉内容。</p><button className="btn-primary" disabled={busy} onClick={()=>void apply()}>{job.targetId?'替换生成时选定的插画':'按厘米尺寸加入画布'}</button></>}
  </>
 </div></Modal>
}
