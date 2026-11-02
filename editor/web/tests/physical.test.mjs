import { test } from 'node:test'
import assert from 'node:assert/strict'
import { physicalCanvas, tileMaterial, transferPhysicalSize, effectiveDPI, validatePrintPages } from '../src/print/physical.mjs'
test('400×104 cm remains 400×104 independent of editor resolution', () => {
  assert.deepEqual(physicalCanvas(400,104), { width:8000,height:2080,physical:{widthCm:400,heightCm:104,unitsPerCm:20} })
  assert.equal(physicalCanvas(400,104,10).width / 10,400)
})
test('oversize material is tiled rather than scaled, with continuous overlap', () => {
  const result = tileMaterial({widthCm:60,heightCm:70})
  assert.equal(result.columns,3); assert.equal(result.rows,2)
  for (const p of result.pages) {
    assert.equal(p.scale,1)
    assert.ok(p.widthCm + p.targetXcm <= p.pageWidthCm - 0.5 + 1e-9)
    assert.ok(p.heightCm + p.targetYcm <= p.pageHeightCm - 0.5 + 1e-9)
  }
  const [a,b] = result.pages
  assert.ok(Math.abs(a.sourceXcm+a.widthCm-b.sourceXcm-0.5)<1e-9)
  const last=result.pages.at(-1)
  assert.ok(Math.abs(last.sourceXcm+last.widthCm-60)<1e-9)
  assert.ok(Math.abs(last.sourceYcm+last.heightCm-70)<1e-9)
})
test('A4 exact printable size does not create extra pages',()=>assert.equal(tileMaterial({paper:'A4',widthCm:20,heightCm:28.7}).pages.length,1))
test('dragging between canvases preserves centimeters',()=>assert.deepEqual(transferPhysicalSize({width:400,height:600},20,10),{width:200,height:300}))
test('DPI reflects original pixels, not an export DPI label',()=>assert.equal(effectiveDPI(1200,600,10.16,5.08),300))
test('invalid physical geometry is rejected',()=>{
  for (const widthCm of [0,-1,NaN,Infinity]) assert.throws(()=>physicalCanvas(widthCm,104))
  assert.throws(()=>tileMaterial({widthCm:10,heightCm:10,overlapCm:50}))
})

test('small materials share paper, larger pieces add tiled pages at unchanged size',async()=>{
 const {packMaterials}=await import('../src/print/physical.mjs')
 const pages=packMaterials([{id:'a',widthCm:10,heightCm:10},{id:'b',widthCm:10,heightCm:10},{id:'large',widthCm:60,heightCm:70}],{paper:'A3'})
 assert.ok(pages.length<=7)
 validatePrintPages(pages)
 assert.equal(pages.flatMap(p=>p.placements).filter(x=>x.id==='large').length,6)
 for(const id of ['a','b'])assert.equal(pages.flatMap(p=>p.placements).filter(x=>x.id===id).length,1)
 for(const page of pages)for(const x of page.placements){assert.equal(x.scale,1);assert.ok(x.targetXcm+x.widthCm<=page.widthCm-0.5+1e-9)}
})

test('manual print placement rejects overlap and out-of-paper geometry',()=>{
 const base={widthCm:29.7,heightCm:42,placements:[
  {id:'a',targetXcm:1,targetYcm:1,widthCm:10,heightCm:10,sourceXcm:0,sourceYcm:0,scale:1},
  {id:'b',targetXcm:12,targetYcm:1,widthCm:10,heightCm:10,sourceXcm:0,sourceYcm:0,scale:1}
 ]}
 assert.doesNotThrow(()=>validatePrintPages([base]))
 assert.throws(()=>validatePrintPages([{...base,placements:[base.placements[0],{...base.placements[1],targetXcm:5}]}]),/重叠/)
 assert.throws(()=>validatePrintPages([{...base,placements:[{...base.placements[0],targetXcm:25},base.placements[1]]}]),/paper|范围/i)
})


test('rotation fits a wide material on one A3 sheet without shrinking',async()=>{
 const {packMaterials}=await import('../src/print/physical.mjs')
 const materials=[{id:'wide',widthCm:35,heightCm:20}]
 const pages=packMaterials(materials)
 assert.equal(pages.length,1)
 assert.equal(pages[0].placements[0].rotation,90)
 assert.equal(pages[0].placements[0].widthCm,20)
 assert.equal(pages[0].placements[0].heightCm,35)
 assert.equal(packMaterials(materials,{allowRotation:false}).flatMap(p=>p.placements).length,2)
 validatePrintPages(pages)
})
test('multi-start packing is deterministic, respects spacing and never loses materials',async()=>{
 const {packMaterials}=await import('../src/print/physical.mjs')
 for(let seed=1;seed<=20;seed++){
  const materials=Array.from({length:25},(_,i)=>({id:String(i),widthCm:2+(i*seed*7%24),heightCm:2+(i*seed*11%35)}))
  const pages=packMaterials(materials)
  validatePrintPages(pages)
  assert.deepEqual(pages,packMaterials(materials))
  assert.equal(pages.flatMap(p=>p.placements).length,materials.length)
  for(const p of pages)for(const a of p.placements){
   assert.equal(a.scale,1)
   assert.ok(a.targetYcm+a.heightCm<=p.heightCm-.5+1e-8)
   for(const b of p.placements)if(a!==b)assert.ok(a.targetXcm+a.widthCm+.3<=b.targetXcm+1e-8||b.targetXcm+b.widthCm+.3<=a.targetXcm+1e-8||a.targetYcm+a.heightCm+.3<=b.targetYcm+1e-8||b.targetYcm+b.heightCm+.3<=a.targetYcm+1e-8)
  }
 }
})
