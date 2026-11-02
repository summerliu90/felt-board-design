import { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath, concatTransformationMatrix } from 'pdf-lib'
import { drawNativeLayer, type NativePrintCache } from './vectorPDF'
import type { Document, Layer } from '../types'
import type { Renderer } from '../render/renderer'
import { validatePrintPages } from './physical.mjs'
import type { PrintPage } from './physical.mjs'
export interface PrintMaterial {id:string;name:string;ids:string[];left:number;top:number;width:number;height:number;widthCm:number;heightCm:number}
const PT=72/2.54
/** Embed ordinary image originals byte-for-byte. Render complex native layers page-by-page. */
export async function exportPrintPDF(doc:Document,materials:PrintMaterial[],pages:PrintPage[],renderer:Renderer,onProgress:(text:string)=>void):Promise<Uint8Array>{
 validatePrintPages(pages)
 const physical=doc.canvas.physical;if(!physical)throw new Error('请先设置厘米画布')
 const snapshot=structuredClone(doc),pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica)
 pdf.setTitle('Actual-size print');pdf.setSubject('Print at actual size / 100%. Do not fit to page.')
 const first=pages[0];if(!first)throw new Error('请先添加素材')
 const calibration=pdf.addPage([first.widthCm*PT,first.heightCm*PT])
 calibration.drawText('ACTUAL SIZE / 100% - disable fit to page',{x:PT,y:calibration.getHeight()-2*PT,size:12,font})
 calibration.drawLine({start:{x:2*PT,y:calibration.getHeight()-4*PT},end:{x:12*PT,y:calibration.getHeight()-4*PT},thickness:1})
 calibration.drawText('Measure this line: 10 cm',{x:2*PT,y:calibration.getHeight()-5*PT,size:12,font})
 const cache:NativePrintCache={images:new Map(),fonts:new Map()}
 await renderer.prepare(snapshot)
 for(const [index,plan]of pages.entries()){
  onProgress(`导出打印页 ${index+1}/${pages.length}`)
  const page=pdf.addPage([plan.widthCm*PT,plan.heightCm*PT])
  for(const placement of plan.placements){
   const material=materials.find(m=>m.id===placement.id);if(!material)throw new Error('素材清单不完整')
   const rotated=placement.rotation===90
   const sourceWidth=rotated?placement.heightCm:placement.widthCm,sourceHeight=rotated?placement.widthCm:placement.heightCm
   const x=placement.targetXcm*PT,topY=(plan.heightCm-placement.targetYcm)*PT,y=topY-sourceHeight*PT
   page.pushOperators(pushGraphicsState())
   if(rotated)page.pushOperators(concatTransformationMatrix(0,-1,1,0,x+sourceHeight*PT-topY,topY+x))
   const sourceLeft=material.left+placement.sourceXcm*physical.unitsPerCm,sourceTop=material.top+placement.sourceYcm*physical.unitsPerCm
   const scale=PT/physical.unitsPerCm
   for(const layer of snapshot.layers.filter(l=>material.ids.includes(l.id))){
    page.pushOperators(pushGraphicsState(),rectangle(x,y,sourceWidth*PT,sourceHeight*PT),clip(),endPath(),concatTransformationMatrix(scale,0,0,-scale,x-sourceLeft*scale,plan.heightCm*PT-placement.targetYcm*PT+sourceTop*scale))
    const native=await drawNativeLayer(pdf,page,layer,renderer,cache)
    page.pushOperators(popGraphicsState())
    if(native)continue
    const bounds=renderer.bounds(layer)
    const left=Math.max(sourceLeft,bounds.left),top=Math.max(sourceTop,bounds.top)
    const right=Math.min(sourceLeft+sourceWidth*physical.unitsPerCm,bounds.left+bounds.width),bottom=Math.min(sourceTop+sourceHeight*physical.unitsPerCm,bounds.top+bounds.height)
    if(right<=left||bottom<=top)continue
    const area={left,top,width:right-left,height:bottom-top}
    // Effects are rendered at least at original image density, never at a lower 300-DPI cap.
    const rasterScale=Math.max(300/2.54/physical.unitsPerCm,originalImageScale(layer))
    if(area.width*rasterScale*area.height*rasterScale>64_000_000)throw new Error(`素材 ${layer.name} 的特效渲染超过安全像素上限，请将组合拆开打印以保留原始分辨率`)
    const png=renderer.encode({...snapshot,layers:[layer]},{format:'png',transparent:true,ids:[layer.id],area,scale:rasterScale})
    const embedded=await pdf.embedPng(png)
    page.drawImage(embedded,{x:x+(left-sourceLeft)*scale,y:plan.heightCm*PT-placement.targetYcm*PT-(bottom-sourceTop)*scale,width:area.width*scale,height:area.height*scale})
   }
   page.pushOperators(popGraphicsState())
   page.drawRectangle({x,y:topY-placement.heightCm*PT,width:placement.widthCm*PT,height:placement.heightCm*PT,borderColor:rgb(.75,.75,.75),borderWidth:.25})
   const code=`CUT${String(materials.indexOf(material)+1).padStart(3,'0')}`
   page.drawText(`${code} R${placement.row+1} C${placement.column+1}`,{x:placement.targetXcm*PT,y:Math.max(14,topY-placement.heightCm*PT-7),size:5.5,font})
  }
  page.drawText(`Page ${index+1}/${pages.length} | ACTUAL SIZE 100%`,{x:PT,y:.5*PT,size:6,font})
  await new Promise(resolve=>setTimeout(resolve,0))
 }
 return pdf.save()
}

function originalImageScale(layer:Layer,ancestorScale=1):number {
 if(layer.type==='image'&&layer.image){const crop=layer.image.crop;return Math.max((crop?.width??layer.image.originalWidth??layer.width)/Math.max(layer.width,1e-9),(crop?.height??layer.image.originalHeight??layer.height)/Math.max(layer.height,1e-9))/ancestorScale}
 if(layer.type==='group'&&layer.children?.length){const maxX=Math.max(...layer.children.map(l=>l.x+l.width)),minX=Math.min(...layer.children.map(l=>l.x)),maxY=Math.max(...layer.children.map(l=>l.y+l.height)),minY=Math.min(...layer.children.map(l=>l.y));const groupScale=Math.min(layer.width/Math.max(maxX-minX,1e-9),layer.height/Math.max(maxY-minY,1e-9));return Math.max(0,...layer.children.map(child=>originalImageScale(child,ancestorScale*groupScale)))}
 return 0
}
