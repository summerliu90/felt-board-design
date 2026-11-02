# coding:utf-8
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('board_image_bridge',ROOT/'scripts/generate_asset.py')
bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
NODE=shutil.which('node')
if NODE is None:
 raise RuntimeError('Node.js is required for image bridge tests; add node to PATH')

class BridgeTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.base=Path(self.temp.name);self.project=self.base/'project';self.project.mkdir();self.lemon=self.base/'lemon';api=self.lemon/'02-images/api';api.mkdir(parents=True)
  (api/'package.json').write_text('{"type":"module"}')
  (api/'shared.js').write_text("export async function loadAmbientEnv(){};export function imageChannels(){return [{id:1,key:'fake-not-real',base:'https://mock.invalid',model:'mock-model'}]}")
  source="""import fs from 'node:fs';const a=process.argv.slice(2);const output=a[a.indexOf(a.includes('--output')?'--output':'--image')+1];fs.copyFileSync(process.env.FELT_TEST_IMAGE,output);fs.writeFileSync(output+'.routing.json',JSON.stringify({channel:2,model:'mock-image-model',attempts:[{channel:1,status:'failed',reason:'timeout'},{channel:2,status:'success'}]}));fs.appendFileSync(process.env.FELT_TEST_COUNT,'1');console.log(output);"""
  (api/'generate.js').write_text(source);(api/'edit.js').write_text(source)
  self.png=self.base/'mock.png';im=Image.new('RGBA',(160,230),(0,0,0,0));ImageDraw.Draw(im).rectangle((15,15,145,215),fill=(80,140,180,255));im.save(self.png)
  self.count=self.base/'calls';self.env=patch.dict(os.environ,{'FELT_TEST_IMAGE':str(self.png),'FELT_TEST_COUNT':str(self.count)});self.env.start()
  self.request={'asset_id':'M01-CHAR01','style_id':'paper_cut','kind':'character','subject':'一个微笑问好的小学生','width_cm':16,'height_cm':23}
 def tearDown(self):self.env.stop();self.temp.cleanup()
 def plan(self):return bridge.compile_request(self.request,self.project)
 def test_preflight_never_sends_generation(self):
  result=bridge.preflight(self.lemon,NODE);self.assertTrue(result['local_config_ready']);self.assertFalse(result['paid_request_sent']);self.assertNotIn('fake-not-real',json.dumps(result));self.assertFalse(self.count.exists())
 def test_dry_run_compiles_style_and_calls_nothing(self):
  out=bridge.generate(self.plan(),self.project,self.lemon,NODE,dry_run=True);self.assertEqual(out['status'],'dry_run');self.assertIn('彩纸',out['compiled_prompt']);self.assertIn('--background',out['command']);self.assertFalse(self.count.exists());self.assertFalse((self.project/'assets').exists())
 def test_generation_metadata_and_idempotent_reuse(self):
  first=bridge.generate(self.plan(),self.project,self.lemon,NODE);self.assertEqual(first['generation_status'],'succeeded');self.assertEqual(first['qa_status'],'needs_visual_review');self.assertTrue(first['qa']['low_resolution_warning']);self.assertEqual(first['routing']['channel'],2)
  second=bridge.generate(self.plan(),self.project,self.lemon,NODE);self.assertTrue(second['reused']);self.assertFalse(second['paid_request_sent']);self.assertEqual(self.count.read_text(),'1')
 def test_reference_routes_to_edit(self):
  shutil.copy2(self.png,self.project/'reference.png');self.request['reference']='reference.png';out=bridge.generate(self.plan(),self.project,self.lemon,NODE,dry_run=True);self.assertTrue(out['command'][1].endswith('edit.js'));self.assertIn('--output',out['command'])
 def test_opaque_result_is_failed_not_ready(self):
  Image.new('RGB',(160,230),'white').save(self.png)
  with self.assertRaisesRegex(ValueError,'alpha PNG'):bridge.generate(self.plan(),self.project,self.lemon,NODE)
  meta=next((self.project/'assets').rglob('*.asset.json'));self.assertEqual(json.loads(meta.read_text())['generation_status'],'failed')
 def test_force_creates_version_without_overwrite(self):
  first=bridge.generate(self.plan(),self.project,self.lemon,NODE);second=bridge.generate(self.plan(),self.project,self.lemon,NODE,force=True);self.assertNotEqual(first['output'],second['output']);self.assertTrue(Path(first['output']).exists())
 def test_locked_style_cannot_silently_change(self):
  (self.project/'style-lock.json').write_text('{"style_id":"felt"}')
  with self.assertRaisesRegex(ValueError,'style-lock'):self.plan()
 def test_invalid_inputs_and_unsupported_provider(self):
  for field,value in [('asset_id','../outside'),('width_cm',0),('style_id','unknown'),('provider','builtin_imagegen'),('n',2),('references',['a.png','b.png'])]:
   request={**self.request,field:value}
   with self.assertRaises(ValueError):bridge.compile_request(request,self.project)
 def test_eight_styles_have_readable_body_palette(self):
  styles=json.loads((ROOT/'assets/style-presets.json').read_text())['styles'];self.assertEqual(len(styles),8);self.assertEqual(len({s['id']for s in styles}),8)
  def lum(hexcolor):
   values=[int(hexcolor[i:i+2],16)/255 for i in (1,3,5)];linear=[x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in values];return sum(x*w for x,w in zip(linear,[.2126,.7152,.0722]))
  for style in styles:
   a,b=sorted([lum(style['palette']['bg']),lum(style['palette']['text'])]);self.assertGreaterEqual((b+.05)/(a+.05),4.5,style['id'])

if __name__=='__main__':unittest.main()
