"""Authoring only: emit mascot-icon.ts, --idle-png or --gestures. Requires rsvg-convert and Pillow."""
import base64
import io
import json
import subprocess
import sys
from functools import lru_cache
from pathlib import Path
from xml.etree import ElementTree as ET

from PIL import Image

ART = Path(__file__).resolve().parents[3] / 'media/images'
SIZE = 144  # 2× backing for an eight-column, four-row placement in 9×18 px cells.
with Image.open(ART / 'stela-idle-32.png') as swatch:
    palette = swatch.getpalette()
INKS = [tuple(palette[3*i:3*i+3]) for i in range(1, 8)]  # Palette only; never enlarge the old pixels.


@lru_cache(None)
def nearest(rgb):
    return min(range(len(INKS)), key=lambda i: sum((a-b)**2 for a, b in zip(rgb, INKS[i])))


def character(blink=False):
    svg = ET.parse(ART / 'stela-relieve.svg').getroot()
    svg.set('viewBox', '6 6 244 244')  # Less transparent margin, even in the compact placement.
    # The approved small sprite has two equal dots centered at (14,15) and (18,15) on its 32 px grid.
    eyes = svg.find(".//*[@id='stela-ojos']")
    for eye, cx in zip(eyes, (112, 144), strict=True):
        eye.attrib.update(cx=str(cx), cy='122' if blink else '120', rx='7.5', ry='2.75' if blink else '7.5')
    return svg


def raster(svg):
    png = subprocess.run(['rsvg-convert', '--width', str(SIZE*4), '--height', str(SIZE*4)],
                         input=ET.tostring(svg), stdout=subprocess.PIPE, check=True).stdout
    rgba = Image.open(io.BytesIO(png)).convert('RGBA').resize((SIZE, SIZE), Image.Resampling.BOX)
    # Flat, undithered interior inks, plus fractional edge coverage on transparent backgrounds.
    indexed = Image.new('P', rgba.size)
    indexed.putpalette([0, 0, 0] + [v for _ in range(15) for color in INKS for v in color])
    indexed.info['transparency'] = bytes([0] + [17*a for a in range(1, 16) for _ in INKS])
    pixels = rgba.load()
    data = bytearray()
    for y in range(SIZE):
        for x in range(SIZE):
            r, g, b, a = pixels[x, y]
            level = (a + 8) // 17
            data.append(1 + (level-1)*len(INKS) + nearest((r, g, b)) if level else 0)
    indexed.putdata(data)
    return indexed


def floated(source, dy):
    frame = source.copy()
    frame.paste(0, (0, 0, SIZE, SIZE)); frame.paste(source, (0, dy))
    return frame


def encode(im):
    out = io.BytesIO()
    im.save(out, format='PNG', optimize=True)
    return out.getvalue()


def b64(im):
    return base64.b64encode(encode(im)).decode('ascii')


# Angle (degrees clockwise) and hold (ms). The two reverse steps anticipate the spin;
# the wheel accelerates through the middle and brakes to its original, upright pose.
TURN = [(-4, 48), (-9, 72), (-5, 40)] + [(a, 30) for a in
        (4, 18, 37, 60, 86, 113, 140, 167, 194, 221, 248, 273, 296, 316, 333)] + [(345, 40), (353, 44), (358, 46)]


# A working half-cycle, mirrored for the return through center to the opposite side.
# The existing centered float tile (2) is the neutral pose in both animations.
WORK_HALF = [(0, 180), (3, 180), (6, 160), (8, 340), (6, 160), (3, 180)]


def gesture(name):
    svg = character(); ns = '{http://www.w3.org/2000/svg}'
    body = svg.find(".//*[@id='stela-cuerpo']"); face = svg.find(".//*[@id='stela-rostro']")
    eyes = face.find(".//*[@id='stela-ojos']"); crown = body.find(".//*[@id='stela-corona']")
    def move_plates(transform):
        # An indigo backing behind the moving plates closes their tiny seams with the fixed core.
        # The visible core, its bevel and the face stay upright; only the crown casts a moving shadow.
        shadow = body.find(".//*[@href='#stela-placas']")
        backing = ET.Element(ns+'use', {'href': '#stela-nucleo', 'fill': body[0][0].get('fill'), 'transform': transform})
        body.insert(0, backing)
        crown.set('transform', transform); shadow.set('transform', transform)

    if name.startswith(('spin', 'work')):
        move_plates(f'rotate({int(name[4:])} 125.5 130.5)')
    elif name.startswith('float-watch-'):
        # Eyes move, not the crown or the smile. A rail on the right has a real target on that side.
        _, _, side, height = name.split('-')
        dx = {'left': -9, 'right': 9}[side]
        eyes.set('transform', f'translate({dx} -8)')
        return floated(raster(svg), {'mid': 0, 'up': -2, 'down': 2}[height])
    elif name in ('sleep', 'breathe'):
        for old, x in zip(list(eyes), (112, 144), strict=True):
            eyes.remove(old)
            ET.SubElement(eyes, ns+'path', {'d': f'M{x-6} 122 q6 6 12 0', 'fill': 'none', 'stroke': 'currentColor',
                                            'stroke-width': '4.8', 'stroke-linecap': 'round'})
        for node in (body, face): node.set('transform', 'translate(0 4)' if name == 'sleep' else 'translate(0 2)')
    elif name in ('opening', 'lift'):
        for eye in eyes: eye.set('ry', '4.5' if name == 'opening' else '7.5')
        move_plates('translate(0 -2)' if name == 'opening' else 'translate(0 -5)')
    else:
        lean = {'alert': 0, 'lean': -6, 'look': -12}[name]
        for node in (body, face): node.set('transform', f'rotate({lean} 126 143)')
        for eye in eyes: eye.attrib.update(cx=str(int(eye.get('cx'))-3), cy='116', rx='8', ry='9')
    return raster(svg)


def gesture_module():
    steps = [(f'spin{angle}', ms) for angle, ms in TURN] + [(2, 60)]  # 360° is the original centered frame.
    work = [(f'work{sign*a}' if a else 2, ms) for sign in (1, -1) for a, ms in WORK_HALF]
    print('// Generated by assets/render-mascot.py --gestures. Full PNG and four one-row crops per pose.')
    print('export const SPIN_STEPS = ' + json.dumps(steps) + ' as const;')
    print('export const WORK_STEPS = ' + json.dumps(work) + ' as const;')
    print('export const GESTURE_ART: Readonly<Record<string, readonly string[]>> = {')
    watches = [f'float-watch-{side}-{height}' for side in ('left', 'right') for height in ('mid', 'up', 'down')]
    working = list(dict.fromkeys(pose for pose, _ in work if isinstance(pose, str)))
    for key in ['sleep', 'breathe', 'opening', 'lift', 'alert', 'lean', 'look'] + [s for s, _ in steps[:-1]] + watches + working:
        frame = gesture(key)
        parts = [frame] + [frame.crop((0, y, SIZE, y+SIZE//4)) for y in range(0, SIZE, SIZE//4)]
        print('  '+json.dumps(key)+': '+json.dumps([b64(p) for p in parts], indent=2)+',')
    print('};')


if __name__ == '__main__':
    if sys.argv[1:] == ['--gestures']:
        gesture_module(); sys.exit(0)
    idle = raster(character())
    if sys.argv[1:] == ['--idle-png']:
        sys.stdout.buffer.write(encode(idle))
    elif not sys.argv[1:]:
        closed = raster(character(True))
        whole, bands = [], []
        for source, dy in [(idle, y) for y in (-4, -2, 0, 2, 4)] + [(closed, 4)]:
            frame = floated(source, dy)
            whole.append(b64(frame))
            bands.append([b64(frame.crop((0, y, SIZE, y+SIZE//4))) for y in range(0, SIZE, SIZE//4)])
        print('// Generated by assets/render-mascot.py from media/images/stela-relieve.svg. No runtime rasterizer.')
        print('export const FLOAT_FRAMES = ' + json.dumps(whole, indent=2) + ' as const;')
        print('// Regular Pi paints rows in order. Each band owns just its row, including the one beside the footer.')
        print('export const FLOAT_BANDS = ' + json.dumps(bands, indent=2) + ' as const;')
    else:
        raise SystemExit('Usage: render-mascot.py [--idle-png | --gestures]')
