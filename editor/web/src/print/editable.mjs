import { validatePrintPages } from './physical.mjs'
/** Preserve actual objects, including text, on new print boards. No rasterization. */
export function editablePrintCommands(doc, materials, pages, prefix='A3可编辑排版') {
 validatePrintPages(pages)
 const u=doc.canvas.physical?.unitsPerCm
 if(!u||!Number.isFinite(u))throw new Error('需要厘米画布')
 const commands=[],mapping=[]
 for(const [index,page] of pages.entries()){
  const layers=[]
  for(const placement of page.placements){
   const m=materials.find(m=>m.id===placement.id)
   if(!m)throw new Error('素材映射缺失')
   const source=doc.layers.filter(l=>m.ids.includes(l.id))
   if(source.length!==m.ids.length)throw new Error('源图层已改变，请重新选择')
   for(const layer of source){
    const copy=structuredClone(layer),dx=layer.x-m.left-placement.sourceXcm*u,dy=layer.y-m.top-placement.sourceYcm*u
    copy.x=placement.targetXcm*u+(placement.rotation===90?placement.widthCm*u-dy:dx)
    copy.y=placement.targetYcm*u+(placement.rotation===90?dx:dy)
    copy.rotation=(layer.rotation??0)+(placement.rotation??0)
    // Keep native dimensions/styles/children unchanged. Board edges clip tile overflow.
    layers.push(copy)
    mapping.push({page:index+1,materialId:m.id,sourceLayerId:layer.id,name:layer.name,row:placement.row,column:placement.column})
   }
  }
  commands.push({type:'addBoard',name:`${prefix} ${index+1}`,width:page.widthCm*u,height:page.heightCm*u,background:'#ffffff'},
   {type:'setPhysicalCanvas',widthCm:page.widthCm,heightCm:page.heightCm,unitsPerCm:u})
  if(layers.length)commands.push({type:'insertLayers',layers,offset:0})
 }
 return {commands,mapping}
}
export function imageEditability(layer,u=20){
 if(layer.type==='text')return {label:'原生文字：可改字、字体、颜色',low:false}
 if(layer.type==='shape')return {label:'原生图形：可改形状与颜色',low:false}
 if(layer.type!=='image'||!layer.image)return {label:'组合：内部编辑能力取决于子图层',low:false}
 const i=layer.image,w=i.crop?.width??i.originalWidth,h=i.crop?.height??i.originalHeight
 const dpi=w&&h?Math.min(w/Math.max(layer.width,1e-9),h/Math.max(layer.height,1e-9))*u*2.54:undefined
 return {label:`${i.crop?'裁切位图':'位图'}：可移位/替换，内部不可拆层${dpi?` · 源 ${Math.floor(dpi)} DPI`:''}`,low:!!dpi&&dpi<150}
}
