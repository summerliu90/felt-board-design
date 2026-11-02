#!/usr/bin/env python3
"""Render a proportional board planning diagram, not finished artwork.
Requires Pillow for PNG; SVG/CSV/report are generated from the same geometry.
"""
import argparse
import csv
import html
import json
import math
from pathlib import Path


def number(obj, key, positive=False):
    value = obj.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f'{key} must be a finite number')
    if positive and value <= 0:
        raise ValueError(f'{key} must be positive')
    return float(value)


def box(obj):
    return tuple(number(obj, k, k in ('width_cm', 'height_cm')) for k in
                 ('x_cm', 'y_cm', 'width_cm', 'height_cm'))


def intersects(a, b):
    x, y, w, h = a
    X, Y, W, H = b
    return min(x+w, X+W) > max(x, X) and min(y+h, Y+H) > max(y, Y)


def validate(data):
    board = data['board']
    w, h = number(board, 'width_cm', True), number(board, 'height_cm', True)
    margin = board.get('margin_cm', 3)
    if not isinstance(margin, (int, float)) or isinstance(margin, bool) or not math.isfinite(margin) or margin < 0 or margin * 2 >= min(w, h):
        raise ValueError('margin_cm must be finite, nonnegative and leave usable space')
    entities = [data['title']] + data['modules']
    if not data['modules']:
        raise ValueError('at least one content module is required')
    warnings = []
    seen = set()
    exclusions = [box(e) for e in data.get('exclusions', [])]
    for e in entities:
        ident = e['id']
        if not isinstance(ident, str) or not ident or ident in seen:
            raise ValueError(f'nonempty unique id required: {ident}')
        seen.add(ident)
        x, y, W, H = box(e)
        if e.get('rotation_deg', 0) != 0:
            raise ValueError(f'{ident}: rotated layouts require a separate geometry check')
        if x < 0 or y < 0 or x+W > w+1e-9 or y+H > h+1e-9:
            raise ValueError(f'{ident}: outside board')
        if x < margin or y < margin or x+W > w-margin or y+H > h-margin:
            warnings.append(f'{ident}: enters suggested margin; review intentionally')
        if any(intersects(box(e), ex) for ex in exclusions):
            raise ValueError(f'{ident}: intersects fixed exclusion')
        if e.get('shape', 'rect') not in ('rect', 'cloud', 'book', 'hexagon', 'leaf', 'ribbon'):
            raise ValueError(f'{ident}: unsupported shape')
        for key in ('text_box', 'illustration_box'):
            if key in e:
                a, b, c, d = box(e[key])
                if a < 0 or b < 0 or a+c > W+1e-9 or b+d > H+1e-9:
                    raise ValueError(f'{ident}: {key} outside module bounds')
    for ex in exclusions:
        x, y, W, H = ex
        if x < 0 or y < 0 or x+W > w+1e-9 or y+H > h+1e-9:
            raise ValueError('exclusion outside board')
    allowed = set()
    for pair in data.get('allowed_overlaps', []):
        if len(pair) != 2 or any(i not in seen for i in pair):
            raise ValueError('allowed_overlaps must reference two known ids')
        allowed.add(frozenset(pair))
    for i, e in enumerate(entities):
        for other in entities[i+1:]:
            if intersects(box(e), box(other)) and frozenset([e['id'], other['id']]) not in allowed:
                warnings.append(f'{e["id"]}/{other["id"]}: bounding boxes overlap; review reading area')
    return w, h, margin, warnings


def shape_points(kind, x, y, w, h):
    if kind == 'hexagon':
        return [(x+w*.12,y),(x+w*.88,y),(x+w,y+h*.22),(x+w,y+h*.78),(x+w*.88,y+h),(x+w*.12,y+h),(x,y+h*.78),(x,y+h*.22)]
    if kind == 'ribbon':
        return [(x,y),(x+w,y),(x+w*.94,y+h*.5),(x+w,y+h),(x,y+h),(x+w*.06,y+h*.5)]
    if kind == 'book':
        return [(x,y+h*.05),(x+w*.25,y),(x+w*.5,y+h*.06),(x+w*.75,y),(x+w,y+h*.05),(x+w,y+h*.95),(x+w*.75,y+h*.91),(x+w*.5,y+h),(x+w*.25,y+h*.91),(x,y+h*.95)]
    if kind == 'leaf':
        right = [(x+w*.5+w*.49*math.sin(math.pi*t)**.6,y+h*t) for t in [i/80 for i in range(81)]]
        left = [(x+w*.5-w*.49*math.sin(math.pi*t)**.6,y+h*t) for t in [i/80 for i in range(80,-1,-1)]]
        return right+left
    if kind == 'cloud':
        return [(x+w*.5+w*.47*math.cos(t)*(1+.04*math.sin(10*t)),y+h*.5+h*.46*math.sin(t)*(1+.04*math.sin(10*t))) for t in [i*2*math.pi/160 for i in range(160)]]
    return [(x,y),(x+w,y),(x+w,y+h),(x,y+h)]


def find_font(given):
    candidates = [given] if given else []
    candidates += ['/System/Library/Fonts/Hiragino Sans GB.ttc', '/System/Library/Fonts/STHeiti Medium.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc']
    for p in candidates:
        if p and Path(p).is_file():
            return str(Path(p).resolve())
    raise ValueError('No CJK font found; pass --font /path/to/chinese-font.ttf')


def render(data, out, font_path, board_px=1800):
    from PIL import Image, ImageDraw, ImageFont
    w, h, margin, warnings = validate(data)
    scale = board_px/w
    pad, top = 100, 150
    bw, bh = round(w*scale), round(h*scale)
    image = Image.new('RGB', (bw+pad*2, bh+top+180), '#FFFFFF')
    draw = ImageDraw.Draw(image)
    svg_parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{image.width}" height="{image.height}" viewBox="0 0 {image.width} {image.height}">', '<rect width="100%" height="100%" fill="white"/>']
    def font(size): return ImageFont.truetype(font_path, int(size))
    def text(x, y, value, size=20, fill='#163E45'):
        draw.text((x,y), str(value), font=font(size), fill=fill)
        svg_parts.append(f'<text x="{x}" y="{y+size}" font-family="sans-serif" font-size="{size}" fill="{fill}">{html.escape(str(value))}</text>')
    def line(coords, fill='#52717B', width=2):
        draw.line(coords, fill=fill, width=width)
        svg_parts.append(f'<polyline points="{" ".join(f"{x},{y}" for x,y in coords)}" fill="none" stroke="{fill}" stroke-width="{width}"/>')
    def rect(x,y,W,H,fill,outline='#A9B8AF',radius=0):
        draw.rounded_rectangle((x,y,x+W,y+H),radius=radius,fill=fill,outline=outline,width=2)
        svg_parts.append(f'<rect x="{x}" y="{y}" width="{W}" height="{H}" rx="{radius}" fill="{fill}" stroke="{outline}" stroke-width="2"/>')
    def wrap(value, max_width, size=18):
        lines=[]
        for para in str(value).split('\n'):
            current=''
            for ch in para:
                if current and draw.textlength(current+ch,font=font(size)) > max_width:
                    lines.append(current);current=ch
                else:current+=ch
            lines.append(current)
        return lines
    text(pad,14,'阶段2 · 布局规划图',28)
    text(pad,53,f'{data.get("name","主题黑板报")}  |  {w:g} × {h:g} cm  |  仅规划，不供1:1打印',19)
    text(pad,82,'色块为模块；标号为阅读次序；浅色框为文字/插画预留，不是成品插画。',17)
    rect(pad,top,bw,bh,data['board'].get('background','#F5ECD5'))
    # Dimension guides are outside the board.
    line([(pad,top-18),(pad+bw,top-18)])
    for x in (pad,pad+bw):line([(x,top-26),(x,top-10)])
    text(pad+bw/2-60,top-47,f'{w:g} cm',18)
    line([(pad-25,top),(pad-25,top+bh)])
    text(4,top+bh/2,f'{h:g} cm',17)
    rect(pad+margin*scale,top+margin*scale,bw-2*margin*scale,bh-2*margin*scale,data['board'].get('background','#F5ECD5'),'#CFCEC2')
    colors=['#DDEDE7','#F2D7BD','#D9E8F1','#F4E5B5','#E5DDF1','#D8EACB']
    for i,e in enumerate([data['title']]+data['modules']):
        x,y,W,H=box(e);X,Y=x*scale+pad,y*scale+top;WW,HH=W*scale,H*scale
        pts=shape_points(e.get('shape','rect'),X,Y,WW,HH)
        col=e.get('color','#C4DBD5' if i==0 else colors[(i-1)%len(colors)])
        draw.polygon(pts,fill=col,outline='#52717B',width=2)
        svg_parts.append(f'<polygon points="{" ".join(f"{a},{b}" for a,b in pts)}" fill="{col}" stroke="#52717B" stroke-width="2"/>')
        inset=.12 if e.get('shape') in ['hexagon','cloud','leaf','ribbon'] else .06
        if e.get('shape') == 'leaf':inset=.24
        if e.get('shape') == 'cloud':inset=.20
        tx=X+WW*inset;ty=Y+HH*(.12 if e.get('shape')=='cloud' else .10);usable=WW*(1-2*inset)
        heading = f'{e.get("reading_order",e["id"])}  {e["title"]}' if i else e['title']
        heading_size = 22 if i else 28
        while heading_size > 14 and len(wrap(heading, usable, heading_size)) > 1:
            heading_size -= 1
        lines = wrap(heading, usable, heading_size)
        line_step = heading_size + 5
        if i and e.get('text_box') and ty + len(lines)*line_step + 24 > Y + e['text_box']['y_cm']*scale:
            raise ValueError(f'{e["id"]}: heading/metadata collide with text_box; enlarge top spacing')
        for j,s in enumerate(lines):text(tx,ty+j*line_step,s,heading_size)
        if i:
            ty+=len(lines)*line_step+5
            text(tx,ty,f'{e["id"]} · {W:g}×{H:g}cm',15)
            if not e.get('text_box'):
                summary=wrap(e.get('summary',''),usable,16)
                for j,s in enumerate(summary[:3]):text(tx,ty+24+j*20,s,16)
                if len(summary)>3:warnings.append(f'{e["id"]}: planning summary truncated after 3 lines')
            for key,label,fill in [('text_box','正文区','#FFFBED'),('illustration_box','插画预留区','#EEF4F7')]:
                if key not in e:continue
                a,b,c,d=box(e[key]);xx=X+a*scale;yy=Y+b*scale;ww=c*scale;hh=d*scale
                rect(xx,yy,ww,hh,fill,'#9DAFB0',8)
                desc=f'{label} · {e.get("content_chars",0)}字' if key=='text_box' else label
                sublines=wrap(desc,max(ww-12,20),15)
                for j,s in enumerate(sublines):text(xx+6,yy+4+j*19,s,15)
                if key=='text_box':
                    summary=wrap(e.get('summary',''),max(ww-12,20),15)
                    max_lines=max(0,int((hh-12-len(sublines)*19)//19))
                    for j,s in enumerate(summary[:max_lines]):text(xx+6,yy+8+(len(sublines)+j)*19,s,15)
                    if len(summary)>max_lines:warnings.append(f'{e["id"]}: summary exceeds planning text box, see complete content file')
    for e in data.get('exclusions',[]):
        x,y,W,H=box(e);rect(pad+x*scale,top+y*scale,W*scale,H*scale,'#DBDBDB','#B74736')
        text(pad+x*scale+6,top+y*scale+6,e.get('title','固定遮挡'),16,'#A13C30')
    order=sorted(data['modules'],key=lambda e:e.get('reading_order',data['modules'].index(e)))
    text(pad,top+bh+21,'阅读顺序：'+' → '.join(e['id'] for e in order),19)
    text(pad,top+bh+53,'裁切分组：'+'；'.join(f'{e["id"]}={e.get("cut_group","标题/正文/插画/底板")}' for e in order),15)
    text(pad,top+bh+87,'检查：'+ ('存在提示，见layout-report.json；正文容量和实物阅读距离仍须设计复核。' if warnings else '几何边界通过；仍须复核文字容量、阅读距离和异形安全内区。'),16)
    svg_parts.append('</svg>')
    out.mkdir(parents=True,exist_ok=True)
    image.save(out/'02-layout.png')
    (out/'02-layout.svg').write_text('\n'.join(svg_parts),encoding='utf-8')
    (out/'layout-report.json').write_text(json.dumps({'board_cm':[w,h],'pixel_size':image.size,'font':font_path,'warnings':warnings,'scope':'unrotated bounding boxes, exclusions and relative sub-boxes only; does not certify full text fit or readability'},ensure_ascii=False,indent=2),encoding='utf-8')
    with (out/'02-layout.csv').open('w',encoding='utf-8-sig',newline='') as f:
        keys=['id','title','x_cm','y_cm','width_cm','height_cm','shape','content_chars','cut_group']
        writer=csv.DictWriter(f,keys,extrasaction='ignore');writer.writeheader();writer.writerows([data['title']]+data['modules'])
    # The annotated SVG is the view; JSON is authoritative for centimeter units.
    print(json.dumps({'png':str(out/'02-layout.png'),'svg':str(out/'02-layout.svg'),'warnings':len(warnings)},ensure_ascii=False))


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input',type=Path,required=True)
    p.add_argument('--out-dir',type=Path,required=True)
    p.add_argument('--font')
    p.add_argument('--board-px',type=int,default=1800)
    args=p.parse_args()
    try:
        if not 600 <= args.board_px <= 6000:raise ValueError('--board-px must be 600–6000')
        data=json.loads(args.input.read_text(encoding='utf-8'))
        render(data,args.out_dir,find_font(args.font),args.board_px)
    except (ValueError,KeyError,ImportError) as exc:
        p.exit(2,f'layout error: {exc}\n')


if __name__=='__main__':main()
