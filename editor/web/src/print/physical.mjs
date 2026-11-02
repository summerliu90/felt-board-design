/** Physical dimensions are independent of bitmap resolution. Never fit-to-page. */
export const UNITS_PER_CM = 20
export const PAPERS = { A3: [29.7, 42], A4: [21, 29.7] }
function positive(n, label) {
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} must be positive and finite`)
  return n
}
export function physicalCanvas(widthCm, heightCm, unitsPerCm = UNITS_PER_CM) {
  positive(widthCm, 'width'); positive(heightCm, 'height'); positive(unitsPerCm, 'scale')
  const width = widthCm * unitsPerCm, height = heightCm * unitsPerCm
  if (width > 20000 || height > 20000) throw new Error('Canvas exceeds 20000 editor units; choose a lower editor scale')
  return { width, height, physical: { widthCm, heightCm, unitsPerCm } }
}
export function effectiveDPI(pixelWidth, pixelHeight, widthCm, heightCm) {
  return Math.min(positive(pixelWidth, 'pixels') / positive(widthCm, 'width'), positive(pixelHeight, 'pixels') / positive(heightCm, 'height')) * 2.54
}
/** Tiles refer to source centimeters, retaining exact scale and original pixels. */
export function tileMaterial({ widthCm, heightCm, paper = 'A3', landscape = false, marginCm = 0.5, overlapCm = 0.5 }) {
  positive(widthCm, 'width'); positive(heightCm, 'height')
  if (!PAPERS[paper]) throw new Error('Unsupported paper')
  let [pageWidthCm, pageHeightCm] = PAPERS[paper]
  if (landscape) [pageWidthCm, pageHeightCm] = [pageHeightCm, pageWidthCm]
  if (!Number.isFinite(marginCm) || marginCm < 0 || !Number.isFinite(overlapCm) || overlapCm < 0) throw new Error('Invalid margin or overlap')
  const usableWidth = pageWidthCm - 2 * marginCm, usableHeight = pageHeightCm - 2 * marginCm
  if (usableWidth <= overlapCm || usableHeight <= overlapCm) throw new Error('Margins/overlap leave no printable area')
  const count = (size, usable) => Math.max(1, Math.ceil((size - overlapCm - 1e-9) / (usable - overlapCm)))
  const columns = count(widthCm, usableWidth), rows = count(heightCm, usableHeight)
  if (rows * columns > 10000) throw new Error('Too many print pages')
  const pages = []
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const sourceXcm = column * (usableWidth - overlapCm), sourceYcm = row * (usableHeight - overlapCm)
    pages.push({ row, column, pageWidthCm, pageHeightCm, sourceXcm, sourceYcm,
      widthCm: Math.min(usableWidth, widthCm - sourceXcm), heightCm: Math.min(usableHeight, heightCm - sourceYcm),
      targetXcm: marginCm, targetYcm: marginCm, scale: 1 })
  }
  return { columns, rows, pages }
}
/** Transfer a layer between differently sized canvases without changing its printed size. */
export function transferPhysicalSize(layer, sourceUnitsPerCm, targetUnitsPerCm) {
  positive(sourceUnitsPerCm, 'source scale'); positive(targetUnitsPerCm, 'target scale')
  const ratio = targetUnitsPerCm / sourceUnitsPerCm
  return { width: layer.width * ratio, height: layer.height * ratio }
}

/** Multi-start MaxRects packing, in centimeters. Rotation never changes scale. */
export function packMaterials(materials, options = {}) {
 const paper=options.paper??'A3',landscape=options.landscape??false,margin=options.marginCm??.5,gap=options.gapCm??.3
 if(!PAPERS[paper])throw new Error('Unsupported paper')
 if(!Number.isFinite(gap)||gap<0)throw new Error('Invalid spacing')
 let [widthCm,heightCm]=PAPERS[paper];if(landscape)[widthCm,heightCm]=[heightCm,widthCm]
 const W=widthCm-2*margin,H=heightCm-2*margin,eps=1e-8,items=[]
 for(const material of materials){
  const tiles=tileMaterial({...material,...options,paper,landscape})
  const fits=(material.widthCm<=W+eps&&material.heightCm<=H+eps)||(options.allowRotation!==false&&material.heightCm<=W+eps&&material.widthCm<=H+eps)
  for(const tile of fits?[{...tiles.pages[0],widthCm:material.widthCm,heightCm:material.heightCm}]:tiles.pages)items.push({...tile,id:material.id,canRotate:fits})
 }
 const orders=[x=>x.widthCm*x.heightCm,x=>Math.max(x.widthCm,x.heightCm),x=>x.heightCm,x=>x.widthCm]
 let best=null
 for(const order of orders){
  const bins=[]
  for(const item of [...items].sort((a,b)=>order(b)-order(a)||a.id.localeCompare(b.id)||a.row-b.row||a.column-b.column)){
   let choice=null
   for(let bi=0;bi<=bins.length;bi++){
    const free=bi===bins.length?[{x:margin,y:margin,w:W+gap,h:H+gap}]:bins[bi].free
    for(const f of free)for(const rotation of options.allowRotation===false||!item.canRotate?[0]:[0,90]){
     const w=(rotation?item.heightCm:item.widthCm)+gap,h=(rotation?item.widthCm:item.heightCm)+gap
     if(w>f.w+eps||h>f.h+eps)continue
     const score=[bi===bins.length?1:0,Math.min(f.w-w,f.h-h),Math.max(f.w-w,f.h-h),f.y,f.x]
     if(!choice||score.some((n,i)=>n<choice.score[i]&&score.slice(0,i).every((v,j)=>v===choice.score[j])))choice={bi,x:f.x,y:f.y,w,h,rotation,score}
    }
   }
   if(!choice)throw new Error('Material cannot fit printable area')
   const {bi,x,y,w,h,rotation}=choice
   if(bi===bins.length)bins.push({free:[{x:margin,y:margin,w:W+gap,h:H+gap}],placements:[]})
   const bin=bins[bi],next=[]
   for(const f of bin.free){
    if(x>=f.x+f.w-eps||x+w<=f.x+eps||y>=f.y+f.h-eps||y+h<=f.y+eps){next.push(f);continue}
    if(x>f.x+eps)next.push({...f,w:x-f.x})
    if(x+w<f.x+f.w-eps)next.push({...f,x:x+w,w:f.x+f.w-x-w})
    if(y>f.y+eps)next.push({...f,h:y-f.y})
    if(y+h<f.y+f.h-eps)next.push({...f,y:y+h,h:f.y+f.h-y-h})
   }
   bin.free=next.filter((f,i)=>!next.some((g,j)=>i!==j&&g.x<=f.x+eps&&g.y<=f.y+eps&&g.x+g.w>=f.x+f.w-eps&&g.y+g.h>=f.y+f.h-eps&&(j<i||g.w*g.h>f.w*f.h+eps)))
   bin.placements.push({...item,rotation,widthCm:w-gap,heightCm:h-gap,targetXcm:x,targetYcm:y})
  }
  const pages=bins.map(b=>({widthCm,heightCm,placements:b.placements}))
  const extent=pages.reduce((sum,p)=>sum+Math.max(0,...p.placements.map(t=>t.targetYcm+t.heightCm)),0)
  if(!best||pages.length<best.pages.length||(pages.length===best.pages.length&&extent<best.extent))best={pages,extent}
 }
 return best?.pages??[]
}

export function validatePrintPages(pages) {
 for(const page of pages){
  positive(page.widthCm,'page width');positive(page.heightCm,'page height')
  for(const place of page.placements){
   if(place.rotation!==undefined&&![0,90].includes(place.rotation))throw new Error('Invalid print rotation')
   positive(place.widthCm,'print width');positive(place.heightCm,'print height')
   for(const n of [place.targetXcm,place.targetYcm,place.sourceXcm,place.sourceYcm])if(!Number.isFinite(n)||n<0)throw new Error('Invalid print position')
   if(place.scale!==1)throw new Error('Print materials must retain actual scale')
   if(place.targetXcm+place.widthCm>page.widthCm+1e-8||place.targetYcm+place.heightCm>page.heightCm+1e-8)throw new Error('Material extends beyond the paper')
  }
  for(let i=0;i<page.placements.length;i++)for(let j=i+1;j<page.placements.length;j++){
   const a=page.placements[i],b=page.placements[j]
   if(Math.min(a.targetXcm+a.widthCm,b.targetXcm+b.widthCm)-Math.max(a.targetXcm,b.targetXcm)>1e-8&&Math.min(a.targetYcm+a.heightCm,b.targetYcm+b.heightCm)-Math.max(a.targetYcm,b.targetYcm)>1e-8)throw new Error('打印素材重叠，请移动素材或重新自动排版')
  }
 }
 return true
}
