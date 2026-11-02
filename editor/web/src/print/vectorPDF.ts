import { create } from 'fontkit'
import type { Font as OutlineFont } from '@pdf-lib/fontkit'
import { type PDFDocument, type PDFPage, type PDFImage, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix, rectangle, clip, endPath } from 'pdf-lib'
import type { Layer } from '../types'
import type { Renderer } from '../render/renderer'
import { contentMatrix, type Mat } from '../render/geometry'
import { numericWeight } from '../render/text'
export type NativePrintCache={images:Map<string,PDFImage>;fonts:Map<string,Promise<OutlineFont>>}
function color(value:unknown){if(typeof value!=='string')return undefined;const match=/^#([\da-f]{6})$/i.exec(value);if(!match)return undefined;return rgb(parseInt(match[1].slice(0,2),16)/255,parseInt(match[1].slice(2,4),16)/255,parseInt(match[1].slice(4,6),16)/255)}
function matrix(page:PDFPage,m:Mat){page.pushOperators(concatTransformationMatrix(...m))}
/** Returns false before painting when this element needs its raster effect renderer. */
export async function drawNativeLayer(pdf:PDFDocument,page:PDFPage,l:Layer,renderer:Renderer,cache:NativePrintCache):Promise<boolean>{
 if(!l.visible||(l.opacity??1)<=0)return true
 const style=l.style??{},frame=renderer.frame(l),opacity=l.opacity??1
 if(style.shadow||style.fillGradient||(style.warp&&style.warp!=='none'&&style.warpAmount)||style.filters&&Object.values(style.filters).some(v=>v!==0))return false
 if(l.type==='group')return false // group composition is handled by the caller as a whole until isolated transparency is supported
 if(l.type==='text'){
  const layout=renderer.layout(l),runs:{path:string;x:number;y:number;scale:number}[]=[]
  for(const [i,line]of layout.lines.entries()){
   let x=style.textAlign==='center'?(frame.cw-line.width)/2:style.textAlign==='right'?frame.cw-line.width:0
   for(const glyph of line.glyphs){
    if(!glyph.font||glyph.font.isEmbolden()||glyph.font.getSkewX()!==0)return false
    const family=glyph.font.getTypeface()?.getFamilyName();if(!family)return false
    const weight=numericWeight(style.fontWeight),italic=style.fontStyle==='italic',key=`${family}|${weight}|${italic}`
    let loading=cache.fonts.get(key)
    if(!loading){loading=(async()=>{const q=new URLSearchParams({family,weight:String(weight),italic:italic?'1':'0'});const r=await fetch(`/api/fonts/face?${q}`);if(!r.ok)throw new Error(`打印字体不可用：${family}`);return create(new Uint8Array(await r.arrayBuffer()))})();cache.fonts.set(key,loading)}
    let font:OutlineFont;try{font=await loading}catch{return false}
    const widths=glyph.font.getGlyphWidths(glyph.ids);let gx=x
    for(const [j,id]of Array.from(glyph.ids).entries()){
     let path:string;try{const outline=font.getGlyph(id);if(!outline?.path)return false;path=outline.path.toSVG()}catch{return false}
     runs.push({path,x:gx,y:layout.baseline(i),scale:layout.fontSize/font.unitsPerEm});gx+=widths[j]??0
    }
    x+=glyph.advance
   }
  }
  const fill=color(style.fill??'#000000');if(!fill)return false
  const strokeText=style.stroke??'',colon=strokeText.lastIndexOf(':'),stroke=colon>0?color(strokeText.slice(0,colon)):undefined,strokeWidth=colon>0?Number(strokeText.slice(colon+1)):0
  if(style.stroke&&!stroke)return false
  page.pushOperators(pushGraphicsState());matrix(page,contentMatrix(l,frame));matrix(page,[1,0,0,1,-frame.cw/2,-frame.ch/2])
  const background=color(style.textBackgroundColor)
  if(background)for(const [i,line]of layout.lines.entries()){const x=style.textAlign==='center'?(frame.cw-line.width)/2:style.textAlign==='right'?frame.cw-line.width:0;page.drawRectangle({x,y:layout.lineTop(i),width:line.boxWidth,height:layout.fontSize*1.13,color:background,opacity})}
  for(const run of runs){if(!run.path)continue
   // Font outlines use Y-up coordinates; drawSvgPath converts them to the editor's Y-down coordinates.
   page.pushOperators(pushGraphicsState());
   if(stroke&&strokeWidth>0&&style.paintFirst){page.drawSvgPath(run.path,{x:run.x,y:run.y,scale:run.scale,color:fill,borderColor:stroke,borderWidth:strokeWidth/run.scale,opacity,borderOpacity:opacity});page.drawSvgPath(run.path,{x:run.x,y:run.y,scale:run.scale,color:fill,opacity})}
   else page.drawSvgPath(run.path,{x:run.x,y:run.y,scale:run.scale,color:fill,borderColor:stroke,borderWidth:strokeWidth>0?strokeWidth/run.scale:0,opacity,borderOpacity:opacity})
   page.pushOperators(popGraphicsState())
  }
  if(style.underline||style.linethrough)for(const [i,line]of layout.lines.entries()){const x=style.textAlign==='center'?(frame.cw-line.width)/2:style.textAlign==='right'?frame.cw-line.width:0;for(const y of [style.underline?layout.baseline(i)+.1*layout.fontSize:undefined,style.linethrough?layout.baseline(i)-.28167*layout.fontSize-layout.fontSize/30:undefined])if(y!==undefined)page.drawRectangle({x,y,width:line.boxWidth,height:layout.fontSize/15,color:fill,opacity})}
  page.pushOperators(popGraphicsState());return true
 }
 if(l.type==='shape'){
  const fill=color(style.fill),stroke=color(style.stroke),strokeWidth=style.strokeWidth??0,w=frame.cw,h=frame.ch
  if((style.fill&&!fill)||(style.stroke&&!stroke)||style.cornerRadius||l.shape?.kind==='line')return false
  page.pushOperators(pushGraphicsState());matrix(page,contentMatrix(l,frame))
  const options={color:fill,borderColor:stroke,borderWidth:strokeWidth,opacity,borderOpacity:opacity}
  if(l.shape?.kind==='ellipse')page.drawEllipse({x:0,y:0,xScale:w/2,yScale:h/2,...options})
  else if(l.shape?.kind==='triangle'){
   // drawSvgPath itself flips Y; express the triangle in Y-up to get the desired Y-down triangle.
   page.drawSvgPath(`M ${-w/2} ${-h/2} L 0 ${h/2} L ${w/2} ${-h/2} Z`,{x:0,y:0,...options})
  }else page.drawRectangle({x:-w/2,y:-h/2,width:w,height:h,...options})
  page.pushOperators(popGraphicsState());return true
 }
 if(l.type==='image'&&l.image){
  if(style.cornerRadius||style.stroke)return false
  let embedded=cache.images.get(l.image.url)
  if(!embedded){const response=await fetch(l.image.url);if(!response.ok)throw new Error(`素材无法读取：${l.name}`);const bytes=new Uint8Array(await response.arrayBuffer());if(bytes[0]===255&&bytes[1]===216)embedded=await pdf.embedJpg(bytes);else if(bytes[0]===137&&bytes[1]===80)embedded=await pdf.embedPng(bytes);else return false;cache.images.set(l.image.url,embedded)}
  const crop=l.image.crop??{x:0,y:0,width:embedded.width,height:embedded.height}
  page.pushOperators(pushGraphicsState());matrix(page,contentMatrix(l,frame));page.pushOperators(rectangle(-frame.cw/2,-frame.ch/2,frame.cw,frame.ch),clip(),endPath())
  // The image XObject remains at its original pixel dimensions under an affine transform and crop.
  matrix(page,[1,0,0,-1,-frame.cw/2-crop.x,-frame.ch/2+embedded.height-crop.y])
  page.drawImage(embedded,{x:0,y:0,width:embedded.width,height:embedded.height,opacity})
  page.pushOperators(popGraphicsState());return true
 }
 return false
}
