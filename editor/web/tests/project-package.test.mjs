import test from 'node:test'
import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
const dest=join(mkdtempSync(join(tmpdir(),'davinci-package-')),'package.mjs')
buildSync({entryPoints:['src/print/projectPackage.ts'],bundle:true,platform:'node',format:'esm',outfile:dest,logLevel:'silent'})
const {packEditableProject,unpackEditableProject}=await import(pathToFileURL(dest).href)
test('portable editable package restores source bytes and native text into new boards',async()=>{
 const original=globalThis.fetch
 const bytes=new Uint8Array([137,80,78,71,13,10])
 const commands=[{type:'addBoard',name:'A3',width:594,height:840},{type:'setPhysicalCanvas',widthCm:29.7,heightCm:42,unitsPerCm:20},{type:'insertLayers',layers:[{id:'t',type:'text',text:'保持可编辑',style:{fill:'#000000'}},{id:'i',type:'image',image:{url:'/assets/test.png',original:'/assets/test.png',crop:{x:1,y:2,width:30,height:40}}}],offset:0}]
 let uploaded=0
 globalThis.fetch=async(url,opts)=>{
  if(url==='/assets/test.png')return new Response(bytes,{headers:{'content-type':'image/png'}})
  if(url==='/api/assets'){
   uploaded++;const blob=opts.body.get('file');assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),bytes)
   return Response.json({asset:{url:'/assets/restored.png'}})
  }
  throw new Error('Unexpected request '+url)
 }
 try{
  const zip=await packEditableProject(commands,[])
  const restored=await unpackEditableProject(new File([zip],'project.zip'))
  assert.equal(uploaded,1)
  assert.equal(restored[2].layers[0].text,'保持可编辑')
  assert.equal(restored[2].layers[1].image.url,'/assets/restored.png')
  assert.deepEqual(restored[2].layers[1].image.crop,commands[2].layers[1].image.crop)
  assert.equal(commands[2].layers[1].image.url,'/assets/test.png')
 }finally{globalThis.fetch=original}
})
test('missing source assets fail explicitly instead of creating placeholders',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('',{status:404})
 try{await assert.rejects(packEditableProject([{type:'insertLayers',layers:[{type:'image',image:{url:'/assets/missing.png'}}]}],[]),/缺少源素材/)}finally{globalThis.fetch=original}
})
