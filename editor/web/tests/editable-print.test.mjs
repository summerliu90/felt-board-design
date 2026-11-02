import test from 'node:test'
import assert from 'node:assert/strict'
import {editablePrintCommands,imageEditability} from '../src/print/editable.mjs'
import {packMaterials} from '../src/print/physical.mjs'
const doc={canvas:{physical:{unitsPerCm:20}},layers:[{id:'t',name:'文字',type:'text',text:'可以修改',x:100,y:200,width:200,height:100,rotation:0,visible:true,style:{fill:'#123456',fontSize:30}},{id:'i',name:'图片',type:'image',x:100,y:300,width:200,height:100,rotation:0,visible:true,image:{url:'/assets/a.png',originalWidth:800,originalHeight:400}}]}
const material={id:'m',ids:['t','i'],left:100,top:200,widthCm:10,heightCm:10}
test('editable boards retain native text, styles, image bytes reference and physical size',()=>{
 const before=structuredClone(doc),plan=editablePrintCommands(doc,[material],packMaterials([material]))
 assert.deepEqual(doc,before)
 assert.equal(plan.commands[0].type,'addBoard')
 assert.equal(plan.commands[1].widthCm,29.7)
 const layers=plan.commands[2].layers
 assert.equal(layers[0].text,'可以修改');assert.deepEqual(layers[0].style,doc.layers[0].style)
 assert.deepEqual(layers[1].image,doc.layers[1].image)
 assert.equal(layers[0].width,200);assert.equal(layers[0].x,10);assert.equal(layers[0].y,10)
 assert.equal(layers[1].y,110);assert.equal(plan.mapping.length,2)
})
test('rotation retains layer dimensions and rotates native objects together',()=>{
 const m={...material,widthCm:35,heightCm:20}
 const plan=editablePrintCommands(doc,[m],packMaterials([m]))
 const layers=plan.commands[2].layers
 assert.equal(layers[0].rotation,90);assert.equal(layers[0].width,200)
 assert.equal(layers[0].x,410);assert.equal(layers[0].y,10)
 assert.equal(layers[1].x,310)
})
test('tiling keeps full native text and source layers, never turns them into screenshots',()=>{
 const m={...material,widthCm:60,heightCm:70}
 const plan=editablePrintCommands(doc,[m],packMaterials([m]))
 const inserts=plan.commands.filter(c=>c.type==='insertLayers')
 assert.ok(inserts.length>1)
 for(const cmd of inserts)assert.equal(cmd.layers[0].text,'可以修改')
 assert.throws(()=>editablePrintCommands(doc,[{...m,ids:['missing']}],packMaterials([m])),/源图层/)
})
test('quality and editing boundaries distinguish native text from cropped low resolution bitmap',()=>{
 assert.equal(imageEditability(doc.layers[0]).low,false)
 const cropped={...doc.layers[1],image:{...doc.layers[1].image,crop:{width:100,height:50}}}
 const info=imageEditability(cropped)
 assert.equal(info.low,true);assert.match(info.label,/裁切位图/);assert.match(info.label,/内部不可拆层/)
})
