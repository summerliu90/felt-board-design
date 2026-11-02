import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate'
import type {Layer} from '../types'
import {api} from '../api'
function visit(value:unknown,fn:(layer:Layer)=>void){if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(v=>visit(v,fn));return}const o=value as Record<string,unknown>;if(o.type==='image'&&o.image)fn(o as unknown as Layer);Object.values(o).forEach(v=>visit(v,fn))}
/** Save asset bytes with native layer JSON; never substitute missing images with placeholders. */
export async function packEditableProject(commands:Record<string,unknown>[],mapping:Record<string,unknown>[]){
 const snapshot=structuredClone(commands),urls=new Set<string>();visit(snapshot,l=>{urls.add(l.image!.url);if(l.image!.original)urls.add(l.image!.original)})
 const files:Record<string,Uint8Array>={},paths=new Map<string,string>()
 for(const [index,url]of [...urls].entries()){
  if(!url.startsWith('/assets/')&&!url.startsWith('/asset/')&&!url.startsWith('data:image/'))throw new Error('素材不在本地资源库，请先导入图片')
  const response=await fetch(url);if(!response.ok)throw new Error('缺少源素材，不能导出完整工程')
  const type=response.headers.get('content-type')??'';const ext=type.includes('jpeg')?'jpg':type.includes('svg')?'svg':type.includes('webp')?'webp':'png'
  const path=`assets/${index+1}.${ext}`;files[path]=new Uint8Array(await response.arrayBuffer());paths.set(url,path)
 }
 visit(snapshot,l=>{l.image!.url=paths.get(l.image!.url)!;if(l.image!.original)l.image!.original=paths.get(l.image!.original)!})
 files['project.json']=strToU8(JSON.stringify({format:'davinci-editable-print',version:1,commands:snapshot,mapping},null,2))
 files['README.txt']=strToU8('在编辑器的 A3/A4 打印工作区中点击「导入编辑工程包」恢复为新画板。原生文字保持可编辑；位图内部不会自动拆层。字体需在本机安装。跨页大件保留完整源图层，纸张外区域在打印时裁掉。')
 return zipSync(files,{level:0})
}
export async function unpackEditableProject(file:File){
 if(file.size>150*1024*1024)throw new Error('工程包超过150MB')
 let expanded=0
 const files=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:entry=>{expanded+=entry.originalSize;if(expanded>300*1024*1024)throw new Error('工程包展开过大');return true}})
 if(!files['project.json'])throw new Error('缺少工程描述')
 const project=JSON.parse(strFromU8(files['project.json']))
 if(project.format!=='davinci-editable-print'||project.version!==1||!Array.isArray(project.commands))throw new Error('不是可编辑打印工程包')
 if(project.commands.length>2000||project.commands.some((c:any)=>!['addBoard','setPhysicalCanvas','insertLayers'].includes(c.type)))throw new Error('工程包含不支持的命令')
 const paths=new Set<string>();visit(project.commands,l=>{paths.add(l.image!.url);if(l.image!.original)paths.add(l.image!.original)})
 for(const path of paths)if(!/^assets\/[\w.-]+$/.test(path)||!files[path])throw new Error('工程包素材缺失')
 const urls=new Map<string,string>()
 for(const path of paths)urls.set(path,await api.uploadAsset(new Blob([files[path] as BlobPart]),path.split('/').pop()))
 visit(project.commands,l=>{l.image!.url=urls.get(l.image!.url)!;if(l.image!.original)l.image!.original=urls.get(l.image!.original)!})
 return project.commands as Record<string,unknown>[]
}
