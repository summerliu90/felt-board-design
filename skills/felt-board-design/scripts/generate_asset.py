#!/usr/bin/env python3
# coding:utf-8
"""Reuse Lemon's existing image CLI; no credentials copied, no video workflow imported."""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

SKILL = Path(__file__).resolve().parents[1]
DEFAULT_LEMON = str(Path.home()/'.cursor/skills/lemon-card-cut')

def dump(value):
    print(json.dumps(value, ensure_ascii=False, indent=2))

def positive(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise ValueError(name + ' must be positive and finite')
    return value

def root_path(arg=None):
    root = Path(arg or os.getenv('FELT_BOARD_LEMON_ROOT') or DEFAULT_LEMON).expanduser().resolve()
    for name in ('generate.js', 'edit.js', 'shared.js'):
        if not (root/'02-images/api'/name).is_file():
            raise ValueError('Lemon image entry missing; set --lemon-root or FELT_BOARD_LEMON_ROOT')
    return root

def node_path(arg=None):
    node = arg or os.getenv('FELT_BOARD_NODE') or shutil.which('node')
    if not node or not Path(node).is_file():
        raise ValueError('Node.js missing; set --node or FELT_BOARD_NODE')
    return str(Path(node).resolve())

def preflight(root, node):
    # Only presence booleans leave the child process. Never print credentials or URLs.
    js = '''import {pathToFileURL} from 'node:url';
const mod=await import(pathToFileURL(process.argv[1]).href);await mod.loadAmbientEnv();
try {const channels=mod.imageChannels();const safe=channels.map(c=>({index:c.id,key_configured:!!c.key,endpoint_configured:!!c.base,model_configured:!!c.model}));console.log(JSON.stringify({local_config_ready:safe.length>0&&safe.every(c=>c.key_configured&&c.endpoint_configured&&c.model_configured),channels:safe,remote_api_verified:false,paid_request_sent:false}));}
catch {console.log(JSON.stringify({local_config_ready:false,remote_api_verified:false,paid_request_sent:false,issue:'missing_or_invalid_image_channel_configuration'}));}'''
    result = subprocess.run([node, '--input-type=module', '-e', js, str(root/'02-images/api/shared.js')], capture_output=True, text=True, timeout=20)
    if result.returncode:
        raise ValueError('Local image preflight failed; check Node.js and Lemon image configuration')
    status=json.loads(result.stdout)
    status['pillow_available']=importlib.util.find_spec('PIL') is not None
    status['local_config_ready']=status['local_config_ready'] and status['pillow_available']
    return status

def compile_request(request, project):
    if request.get('provider','lemon_api')!='lemon_api':
        raise ValueError('This bridge only executes lemon_api; use the built-in image tool for builtin_imagegen')
    lock=project/'style-lock.json'
    if lock.is_file():
        locked=json.loads(lock.read_text(encoding='utf-8')).get('style_id')
        if locked and locked!=request.get('style_id'):raise ValueError('style_id conflicts with project style-lock; create an explicit style revision')
    catalog = json.loads((SKILL/'assets/style-presets.json').read_text(encoding='utf-8'))
    styles = {s['id']: s for s in catalog['styles']}
    style_id = request.get('style_id')
    if style_id not in styles:
        raise ValueError('Unknown style_id: ' + str(style_id))
    asset_id = request.get('asset_id', '')
    if not isinstance(asset_id, str) or not re.fullmatch(r'[\w-]{1,80}', asset_id):
        raise ValueError('asset_id must be 1-80 letters, numbers, underscores or hyphens')
    kind = request.get('kind', 'scene')
    if kind not in ('character', 'scene', 'blank_backing', 'decoration'):
        raise ValueError('kind must be character, scene, blank_backing or decoration')
    subject = request.get('subject', '')
    if not isinstance(subject, str) or not subject.strip() or len(subject)>12000:
        raise ValueError('A concrete subject is required')
    width = positive(request.get('width_cm'), 'width_cm')
    height = positive(request.get('height_cm'), 'height_cm')
    target = positive(request.get('target_dpi', 300), 'target_dpi')
    minimum = positive(request.get('min_dpi', 200), 'min_dpi')
    if minimum > target:
        raise ValueError('min_dpi must not exceed target_dpi')
    if request.get('n', 1) != 1:
        raise ValueError('One request produces one independent asset; use separate asset IDs')
    quality=request.get('quality','high')
    if quality not in ('auto','high','medium','low'):
        raise ValueError('Invalid quality')
    size=request.get('size')
    if size and not re.fullmatch(r'(auto|[1-9]\d{1,4}x[1-9]\d{1,4})',size):
        raise ValueError('Invalid size')
    reference = None
    if request.get('references'):
        raise ValueError('This Lemon edit CLI accepts one reference; provide a single approved style board via reference')
    if request.get('reference'):
        reference = (project/Path(request['reference'])).resolve()
        if not reference.is_file():
            raise ValueError('Reference image does not exist')
    if request.get('mask') and not reference:
        raise ValueError('Mask requires a reference image')
    mask=(project/Path(request['mask'])).resolve() if request.get('mask') else None
    if mask and not mask.is_file():
        raise ValueError('Mask image does not exist')
    special = {'character':'身体、双手、脚和道具完整，写清朝向与动作，人物需分别编辑时每人单独制作。',
               'scene':'完整自成一件的小场景，场景内部仍为位图；不要附带其他模块。',
               'blank_backing':'空白底板必须无字、无人、无插画，内部文字区平整，形状和边缘便于裁剪。',
               'decoration':'少量完整大块装饰，闭合外轮廓和宽厚连接，不做细碎散点。'}[kind]
    prompt = '\n'.join([f"素材编号：{asset_id}。主体：{subject.strip()}。用途：{request.get('purpose','低年级展示型黑板报的独立素材')}。",
                        styles[style_id]['prompt'],special,
                        '只生成这一件独立素材，外部必须是真实透明 alpha，四周留少量透明余量，主体和道具不被画布裁断。不要白色、黑色、棋盘格或其他矩形底色，不要环境投影、文字、字母、页码、水印或Logo。准确中文另用原生文字排版。不要从整板效果图切块。',
                        '若使用参考，保持参考的风格与主体特征，按本次要求制作完整独立对象，不带走旧背景、旧字或邻件。' if reference else '',
                        f'版面预留框为 {width}×{height} 厘米，后期等比放置；尺寸元数据和放大像素不能替代真实源清晰度。'])
    dependencies={}
    for key,path in [('reference',reference),('mask',mask)]:
        if path:dependencies[key]=hashlib.sha256(path.read_bytes()).hexdigest()
    fingerprint=hashlib.sha256(json.dumps({'request':request,'prompt':prompt,'dependencies':dependencies},ensure_ascii=False,sort_keys=True).encode()).hexdigest()
    return {'asset_id':asset_id,'style_id':style_id,'kind':kind,'prompt':prompt,'fingerprint':fingerprint,
            'reference':str(reference) if reference else None,'mask':str(mask) if mask else None,
            'quality':quality,'size':size,'width_cm':width,'height_cm':height,'target_dpi':target,'min_dpi':minimum,
            'target_pixels':[math.ceil(width/2.54*target),math.ceil(height/2.54*target)]}

def inspect_image(path, plan):
    from PIL import Image
    with Image.open(path) as image:
        if image.format != 'PNG' or 'A' not in image.getbands():
            raise ValueError('Independent material must be a real alpha PNG')
        alpha=image.getchannel('A');hist=alpha.histogram();box=alpha.point(lambda v:255 if v>24 else 0).getbbox()
        corners=[alpha.getpixel(p) for p in [(0,0),(image.width-1,0),(0,image.height-1),(image.width-1,image.height-1)]]
        if box is None or hist[0]/(image.width*image.height)<.01 or max(corners)>24:
            raise ValueError('Transparent exterior failed; do not deliver an opaque rectangle as a cutout')
        tight=[box[2]-box[0],box[3]-box[1]]
        dpi=[tight[0]/plan['width_cm']*2.54,tight[1]/plan['height_cm']*2.54]
        return {'pixel_size':[image.width,image.height],'visible_alpha_bounds':list(box),'tight_pixels':tight,
                'effective_dpi_if_fitted_to_planned_size':dpi,'transparent_exterior_checked':True,
                'low_resolution_warning':min(dpi)<plan['min_dpi'],'visual_review_passed':False,
                'fit_policy':'contain_no_distortion','sha256':hashlib.sha256(path.read_bytes()).hexdigest()}

def generate(plan,project,root,node,dry_run=False,force=False):
    suffix=plan['fingerprint'][:12]
    if force:suffix+='-'+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%f')
    output=project/'assets'/plan['asset_id']/(suffix+'.png')
    prompt=project/'prompts'/plan['asset_id']/(suffix+'.md')
    meta=output.with_suffix('.asset.json')
    script=root/'02-images/api'/('edit.js' if plan['reference'] else 'generate.js')
    command=[node,str(script),'--promptfile',str(prompt),'--prompt-output',str(prompt),'--quality',plan['quality'],
             '--background','transparent','--output-format','png','--n','1']
    if plan['reference']:
        command+=['--image',plan['reference'],'--output',str(output)]
        if plan['mask']:command+=['--mask',plan['mask']]
    else:command+=['--image',str(output)]
    if plan['size']:command+=['--size',plan['size']]
    base={k:v for k,v in plan.items() if k!='prompt'}
    base.update(provider='lemon_api',output=str(output),prompt_file=str(prompt),model_selection='Lemon configured channel binding; no model override',paid_request_sent=False)
    if dry_run:return {**base,'status':'dry_run','command':command,'compiled_prompt':plan['prompt']}
    if output.exists() or meta.exists():
        if output.exists() and meta.exists():
            old=json.loads(meta.read_text(encoding='utf-8'))
            if old.get('fingerprint')==plan['fingerprint'] and old.get('generation_status')=='succeeded':
                qa=inspect_image(output,plan)
                if qa['sha256']==old.get('qa',{}).get('sha256'):
                    return {**old,'reused':True,'paid_request_sent':False}
        raise ValueError('Existing output lacks matching successful metadata; use --force to create a new version')
    if not preflight(root,node)['local_config_ready']:
        raise ValueError('Image configuration is incomplete; run preflight first')
    output.parent.mkdir(parents=True,exist_ok=True);prompt.parent.mkdir(parents=True,exist_ok=True)
    prompt.write_text(plan['prompt']+'\n',encoding='utf-8')
    report={**base,'generation_status':'running','qa_status':'pending','paid_request_sent':True}
    meta.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    try:
        # Channel order and per-channel timeout live in Lemon; never add another retry loop here.
        result=subprocess.run(command,cwd=project,capture_output=True,text=True)
        if result.returncode:raise ValueError(f'Lemon image command failed (exit {result.returncode}); inspect configured channels; no automatic extra retry')
        qa=inspect_image(output,plan)
        routing=output.with_name(output.name+'.routing.json')
        raw=json.loads(routing.read_text(encoding='utf-8')) if routing.exists() else {}
        report.update(generation_status='succeeded',qa_status='needs_visual_review',qa=qa,
                      routing={k:raw[k] for k in ('channel','model','attempts') if k in raw})
        meta.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        return report
    except Exception as error:
        report.update(generation_status='failed',qa_status='not_accepted',error=str(error))
        meta.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        raise

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['preflight','generate'])
    parser.add_argument('--lemon-root');parser.add_argument('--node');parser.add_argument('--request');parser.add_argument('--project-dir')
    parser.add_argument('--dry-run',action='store_true');parser.add_argument('--force',action='store_true')
    args=parser.parse_args(argv)
    root=root_path(args.lemon_root);node=node_path(args.node)
    if args.action=='preflight':
        status=preflight(root,node);dump(status);return 0 if status['local_config_ready'] else 2
    if not args.request or not args.project_dir:parser.error('generate requires --request and --project-dir')
    project=Path(args.project_dir).expanduser().resolve()
    plan=compile_request(json.loads(Path(args.request).read_text(encoding='utf-8')),project)
    dump(generate(plan,project,root,node,args.dry_run,args.force));return 0

if __name__=='__main__':
    try:sys.exit(main())
    except Exception as exc:
        dump({'status':'failed','error':str(exc),'remote_quality_verified':False});sys.exit(1)
