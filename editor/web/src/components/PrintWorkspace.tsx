import { useEffect, useMemo, useState, useRef } from 'react'
import type { Document } from '../types'
import type { Renderer } from '../render/renderer'
import { packMaterials, type PrintPage } from '../print/physical.mjs'
import { exportPrintPDF, type PrintMaterial } from '../print/exportPDF'
import { editablePrintCommands, imageEditability } from '../print/editable.mjs'
import { packEditableProject, unpackEditableProject } from '../print/projectPackage'
import { Modal } from './Dialog'
export function PrintWorkspace({doc,renderer,selected,projectID,boardID,onRun,onClose}:{projectID:string;boardID:string;doc:Document;renderer:Renderer;selected:string[];onRun:(cmd:unknown)=>Promise<{ok:boolean;error?:string}|undefined>;onClose:()=>void}){
 const storageKey=`dv-print-${projectID}-${boardID}`
 const signature=JSON.stringify(doc)
 const [saved]=useState(()=>{try{return JSON.parse(localStorage.getItem(storageKey)??'{}')}catch{return {}}})
 const [paper,setPaper]=useState<string>(['A3','A4'].includes(saved.paper)?saved.paper:'A3'),[landscape,setLandscape]=useState(saved.landscape===true),[queue,setQueue]=useState<{id:string;ids:string[];name:string}[]>(Array.isArray(saved.queue)?saved.queue:[])
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[progress,setProgress]=useState(''),[override,setOverride]=useState<PrintPage[]|null>(saved.signature===signature&&Array.isArray(saved.layout)?saved.layout:null)
 const [marked,setMarked]=useState<string[]>([])
 const [allowRotation,setAllowRotation]=useState(saved.allowRotation!==false)
 const [thumbnails,setThumbnails]=useState<Record<string,string>>({})
 const physical=doc.canvas.physical
 const previous=useRef(signature)
 useEffect(()=>{if(previous.current!==signature){setOverride(null);previous.current=signature}},[signature])
 useEffect(()=>{localStorage.setItem(storageKey,JSON.stringify({queue,paper,landscape,allowRotation,layout:override,signature}))},[queue,paper,landscape,allowRotation,override,signature,storageKey])
 const materials=useMemo(()=>queue.flatMap(item=>{
  if(!physical)return []
  const layers=doc.layers.filter(l=>item.ids.includes(l.id)&&l.visible);if(!layers.length||layers.length!==item.ids.length)return []
  const boxes=layers.map(l=>renderer.bounds(l)),left=Math.min(...boxes.map(b=>b.left)),top=Math.min(...boxes.map(b=>b.top))
  const width=Math.max(...boxes.map(b=>b.left+b.width))-left,height=Math.max(...boxes.map(b=>b.top+b.height))-top
  return [{...item,left,top,width,height,widthCm:width/physical.unitsPerCm,heightCm:height/physical.unitsPerCm}]
 }),[queue,doc,renderer,physical])
 useEffect(()=>{let alive=true;void(async()=>{await renderer.prepare(doc);const next:Record<string,string>={};for(const m of materials){const bytes=renderer.encode(doc,{format:'png',transparent:true,ids:m.ids,area:{left:m.left,top:m.top,width:m.width,height:m.height},scale:Math.min(1,400/Math.max(m.width,m.height))});next[m.id]=URL.createObjectURL(new Blob([bytes as BlobPart],{type:'image/png'}))}if(alive)setThumbnails(next);else Object.values(next).forEach(URL.revokeObjectURL)})().catch(e=>{if(alive)setError(e.message)});return()=>{alive=false}},[materials,doc,renderer])
 useEffect(()=>()=>{Object.values(thumbnails).forEach(URL.revokeObjectURL)},[thumbnails])
 const automatic=useMemo(()=>packMaterials(materials,{paper,landscape,allowRotation}),[materials,paper,landscape,allowRotation])
 const pages=override??automatic
 const markedInQueue=marked.filter(id=>queue.some(item=>item.id===id))
 function removeFromPrint(ids:string[]){
  const removing=new Set(ids),count=queue.filter(item=>removing.has(item.id)).length
  if(!count)return
  setQueue(previous=>previous.filter(item=>!removing.has(item.id)))
  setMarked(previous=>previous.filter(id=>!removing.has(id)))
  setOverride(null);setError('');setNotice(`已从打印区移除 ${count} 件素材，原画板图层保留。`)
 }

 const queuedIDs=new Set(queue.flatMap(item=>item.ids))
 const remaining=doc.layers.filter(layer=>layer.visible&&!queuedIDs.has(layer.id))
 function addAll(){
  if(!physical){setError('请先设置厘米画布');return}
  if(!remaining.length){setNotice('全部可见图层已加入打印');return}
  const additions=remaining.map(layer=>({id:`M-${crypto.randomUUID()}`,ids:[layer.id],name:layer.name}))
  setQueue(previous=>{const existing=new Set(previous.flatMap(item=>item.ids));return [...previous,...additions.filter(item=>!existing.has(item.ids[0]))]})
  setOverride(null);setError('');setNotice(`已加入 ${additions.length} 个可见图层，每层作为一件独立打印素材，已加入的素材不会重复。`)
 }

 function add(ids:string[]){if(!physical){setError('请先在生成工作室设置厘米画布');return}const layers=doc.layers.filter(l=>ids.includes(l.id)&&l.visible);if(!layers.length)return;if(queue.some(q=>q.ids.some(id=>layers.some(l=>l.id===id)))){setError('这些图层已在打印队列，请先移除旧打印件再重新组合');return;}setQueue(v=>[...v,{id:`M-${crypto.randomUUID()}`,ids:layers.map(l=>l.id),name:layers.map(l=>l.name).join(' + ')}]);setOverride(null)}
 async function download(){setNotice('');setError('');setProgress('准备原始素材……');try{const bytes=await exportPrintPDF(doc,materials as PrintMaterial[],pages,renderer,setProgress);const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:'application/pdf'}));const a=document.createElement('a');a.href=url;a.download=`${paper}-实际尺寸打印.pdf`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000)}catch(e:any){setError(e.message)}finally{setProgress('')}}
 async function createBoards(){setError('');setProgress('创建可编辑画板……');try{const plan=editablePrintCommands(doc,materials,pages,`${paper}可编辑排版`);const r=await onRun(plan.commands);if(!r?.ok)throw new Error(r?.error??'创建失败');onClose()}catch(e:any){setError(e.message)}finally{setProgress('')}}
 async function downloadProject(){setError('');setProgress('打包原生图层与素材……');try{
  const plan=pages.length?editablePrintCommands(doc,materials,pages,`${paper}可编辑排版`):{commands:[{type:'addBoard',name:'分层源稿恢复',width:doc.canvas.width,height:doc.canvas.height,background:doc.canvas.background??'#ffffff'},...(physical?[{type:'setPhysicalCanvas',...physical}]:[]),{type:'insertLayers',layers:structuredClone(doc.layers),offset:0}],mapping:[]}
  const bytes=await packEditableProject(plan.commands,plan.mapping),url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:'application/zip'}));const a=document.createElement('a');a.href=url;a.download=`${pages.length?paper+'-可编辑排版':'分层源稿'}-工程包.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000)
 }catch(e:any){setError(e.message)}finally{setProgress('')}}
 async function importProject(file:File|undefined){if(!file)return;setError('');setProgress('恢复图层与素材……');try{const commands=await unpackEditableProject(file);const r=await onRun(commands);if(!r?.ok)throw new Error(r?.error??'恢复失败');onClose()}catch(e:any){setError(e.message)}finally{setProgress('')}}
 const imageWarnings=doc.layers.filter(l=>l.visible&&l.type==='image').map(l=>({name:l.name,...imageEditability(l,physical?.unitsPerCm)})).filter(l=>l.low)
 return <Modal onClose={onClose} width="w-[1120px]" label="实际尺寸打印工作区"><div className="p-5 flex flex-col gap-3 max-h-[90vh] overflow-hidden">
  <div className="flex items-center gap-3"><h2 className="text-xl font-bold">实际尺寸打印工作区</h2><select aria-label="打印纸型" value={paper} onChange={e=>{setPaper(e.target.value);setOverride(null)}}><option>A3</option><option>A4</option></select><label><input type="checkbox" checked={landscape} onChange={e=>{setLandscape(e.target.checked);setOverride(null)}}/>横向</label><label><input type="checkbox" checked={allowRotation} onChange={e=>{setAllowRotation(e.target.checked);setOverride(null)}}/>允许旋转90°</label><button className="btn-primary" onClick={()=>{setOverride(null);setError('')}}>一键省纸排版</button><button className="btn-ghost" onClick={onClose}>返回编辑</button></div>
  <p className="text-sm">按独立素材排版，保持原厘米尺寸。生成可编辑画板后可继续改字、换图、调整位置。超大件使用5毫米重叠拼接；拼接不等于拆层。PDF仅用于打印，选择“实际大小 / 100%”。</p>
  <div className="flex gap-2 flex-wrap"><button className="btn-primary" disabled={!pages.length||!!progress} onClick={()=>void createBoards()}>生成可编辑 {paper} 画板</button><button className="btn-ghost" disabled={!!progress} onClick={()=>void downloadProject()}>下载分层编辑工程包</button><label className="btn-ghost cursor-pointer">导入编辑工程包<input type="file" accept=".zip" className="sr-only" disabled={!!progress} onChange={e=>{void importProject(e.target.files?.[0]);e.target.value=''}}/></label></div>
  {imageWarnings.length>0&&<p role="status" className="text-sm text-amber-800">{imageWarnings.length} 个图片层的源清晰度不足150 DPI，需重制或检查后再正式打印。位图能移动/替换，不代表内部可改字或拆人物。示例：{imageWarnings.slice(0,3).map(l=>l.name).join('、')}。</p>}
  {notice&&<p role="status">{notice}</p>}
  {error&&<p role="alert" className="text-red-700">{error}</p>}
  <div className="flex gap-4 min-h-0 overflow-hidden">
   <aside className="w-64 shrink-0 overflow-y-auto flex flex-col gap-2">
    <button className="btn-primary" disabled={!physical||!remaining.length||!!progress} onClick={addAll}>全选加入打印{remaining.length>0?`（${remaining.length}）`:'（已全部加入）'}</button>
    <p className="text-xs text-muted">一键加入当前画板全部可见图层，各自保持独立，自动跳过已加入的素材。需要合为一件时，使用下方的多选组合功能。</p>

    {queue.length>0&&<div className="border rounded p-2 flex flex-col gap-2"><p className="text-xs font-bold">已加入打印（{queue.length}）</p><div className="flex flex-wrap items-center gap-2 text-xs"><label className="flex items-center gap-1"><input type="checkbox" aria-label="全选已加入的打印素材" disabled={!!progress} checked={markedInQueue.length===queue.length} ref={el=>{if(el)el.indeterminate=markedInQueue.length>0&&markedInQueue.length<queue.length}} onChange={e=>setMarked(e.target.checked?queue.map(item=>item.id):[])}/>全选</label><button className="btn-ghost" disabled={!markedInQueue.length||!!progress} onClick={()=>removeFromPrint(markedInQueue)}>移除选中（{markedInQueue.length}）</button><button className="btn-ghost" disabled={!!progress} onClick={()=>removeFromPrint(queue.map(item=>item.id))}>清空全部</button></div><div className="max-h-48 overflow-y-auto">{queue.map(item=><div key={item.id} className="flex text-xs items-center gap-2"><input type="checkbox" aria-label={`选择打印素材 ${item.name}`} disabled={!!progress} checked={marked.includes(item.id)} onChange={e=>setMarked(previous=>e.target.checked?[...new Set([...previous,item.id])]:previous.filter(id=>id!==item.id))}/><span className="truncate flex-1" title={item.name}>{item.name}</span><button disabled={!!progress} title={`移除打印素材 ${item.name}`} onClick={()=>removeFromPrint([item.id])}>移除</button></div>)}</div></div>}<button className="btn-primary" disabled={!selected.length||!physical} onClick={()=>add(selected)}>选中图层合为一件打印素材</button>{doc.layers.filter(l=>l.visible).map(l=><div key={l.id} draggable onDragStart={e=>e.dataTransfer.setData('application/davinci-print',JSON.stringify([l.id]))} className="border rounded p-2 text-sm cursor-grab"><span>{l.name}</span><button className="float-right" title="加入打印" onClick={()=>add([l.id])}>＋</button><div className="text-xs text-muted">{physical?`${(l.width/physical.unitsPerCm).toFixed(1)} × ${(l.height/physical.unitsPerCm).toFixed(1)} cm`:'尚无厘米比例'}</div><p className="text-xs text-muted">{imageEditability(l,physical?.unitsPerCm).label}</p></div>)}</aside>
   <main className="flex-1 overflow-y-auto bg-paper p-4" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();try{const ids=JSON.parse(e.dataTransfer.getData('application/davinci-print'));if(Array.isArray(ids))add(ids)}catch{setError('请从左侧拖入素材')}}}>
    {!pages.length&&<div className="border-2 border-dashed rounded p-16 text-center">拖入素材，自动创建 {paper} 打印页</div>}
    <div className="flex flex-wrap gap-4">{pages.map((p,i)=><div key={i}><p className="text-xs">第 {i+1} 页 · {p.widthCm}×{p.heightCm} cm</p><div className="relative bg-white border shadow" style={{width:p.widthCm*7,height:p.heightCm*7}}>{p.placements.map((place,j)=>{const m=materials.find(x=>x.id===place.id)!;return <div key={`${place.id}-${j}`} className="absolute border border-teal-700 bg-teal-50/70 overflow-hidden text-[10px] cursor-move select-none" title={m?.name} style={{left:place.targetXcm*7,top:place.targetYcm*7,width:place.widthCm*7,height:place.heightCm*7}} onPointerDown={e=>{
      if(!m||Math.abs(m.widthCm-(place.rotation===90?place.heightCm:place.widthCm))>1e-6||Math.abs(m.heightCm-(place.rotation===90?place.widthCm:place.heightCm))>1e-6)return
      e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);const sx=e.clientX,sy=e.clientY,initial=structuredClone(pages)
      const move=(event:PointerEvent)=>{const updated=structuredClone(initial),dest=updated[i].placements[j];dest.targetXcm=Math.max(.5,Math.min(p.widthCm-.5-dest.widthCm,place.targetXcm+(event.clientX-sx)/7));dest.targetYcm=Math.max(.5,Math.min(p.heightCm-.5-dest.heightCm,place.targetYcm+(event.clientY-sy)/7));setOverride(updated)}
      const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up,{once:true})
     }}>{thumbnails[place.id]&&<img src={thumbnails[place.id]} alt={m?.name} draggable={false} className="absolute max-w-none pointer-events-none" style={{left:-place.sourceXcm*7,top:-place.sourceYcm*7,width:m.widthCm*7,height:m.heightCm*7,transform:place.rotation===90?`translateX(${place.widthCm*7}px) rotate(90deg)`:undefined,transformOrigin:'top left'}}/>}<span className="relative bg-white/80">{m?.name}</span><br/>{place.widthCm.toFixed(1)}×{place.heightCm.toFixed(1)} cm{place.row||place.column?` R${place.row+1} C${place.column+1}`:''}</div>})}</div></div>)}</div>
   </main>
  </div>
  <div className="flex gap-3 items-center"><span>{materials.length} 件素材，{pages.length} 张打印页＋1张10厘米校准页 · 纸面利用率 {pages.length?Math.round(pages.reduce((a,p)=>a+p.placements.reduce((n,t)=>n+t.widthCm*t.heightCm,0),0)/pages.reduce((a,p)=>a+p.widthCm*p.heightCm,0)*100):0}%</span><button className="btn-ghost" disabled={!queue.length||!!progress} onClick={()=>removeFromPrint(queue.map(item=>item.id))}>清空全部</button><button className="btn-primary ml-auto" disabled={!pages.length||!!progress} onClick={()=>void download()}>{progress||'下载实际尺寸 PDF'}</button></div>
  <p className="text-xs text-muted">普通 PNG/JPEG 图片直接嵌入 PDF，不重采样；可保留的文字和基础形状以矢量路径输出，带阴影、渐变或复杂组合的图层按不低于原图密度渲染。低像素原图不会因打印设置获得更多细节。</p>
 </div></Modal>
}
