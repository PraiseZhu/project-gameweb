import json
import math
import re
import sys
import xml.etree.ElementTree as ET


def svg(path):
    raw = open(path, encoding='utf-8').read()
    if re.search(r'<!|<\?', raw):
        raise ValueError()
    root = ET.fromstring(raw)
    ns = '{http://www.w3.org/2000/svg}'
    tags = 'svg g defs path rect circle ellipse line polyline polygon clipPath linearGradient radialGradient stop'.split()
    attrs = ('id width height viewBox x y x1 y1 x2 y2 cx cy fx fy r rx ry d points '
             'fill fill-rule fill-opacity stroke stroke-width stroke-opacity stroke-dasharray stroke-dashoffset '
             'stroke-linecap stroke-linejoin stroke-miterlimit transform opacity clip-path clip-rule clipPathUnits '
             'gradientUnits gradientTransform offset stop-color stop-opacity preserveAspectRatio').split()
    if root.tag != ns + 'svg':
        raise ValueError()
    ids = {item.get('id') for item in root.iter() if item.get('id')}
    for item in root.iter():
        if item.tag not in {ns + tag for tag in tags} or (item.text or '').strip() or (item.tail or '').strip():
            raise ValueError()
        for name, value in item.attrib.items():
            if name not in attrs or not re.fullmatch(r'[\w\s.#(),+%\-]*', value, re.ASCII):
                raise ValueError()
            if '(' in value and name in ('fill', 'stroke', 'clip-path'):
                match = re.fullmatch(r'url\(#([\w.-]+)\)', value)
                color = re.fullmatch(r'rgba?\([0-9.,%\s]+\)', value)
                if not (match and match[1] in ids) and not color:
                    raise ValueError()
    box = [float(part) for part in re.split(r'[\s,]+', root.attrib['viewBox'].strip())]
    if len(box) != 4 or not all(map(math.isfinite, box)):
        raise ValueError()
    width, height = (float(root.attrib[key].removesuffix('px')) for key in ('width', 'height'))
    if not all(math.isfinite(n) and n > 0 for n in (width, height)) or [width, height] != box[2:]:
        raise ValueError()
    return dict(width=width, height=height)


def webp(source, target, force_lossless):
    from PIL import Image, ImageChops, ImageStat, features

    if not features.check('webp'):
        raise ImportError()
    with Image.open(source) as image:
        if image.format != 'PNG' or getattr(image, 'n_frames', 1) != 1:
            raise ValueError()
        rgba = image.convert('RGBA')
    has_alpha = rgba.getchannel('A').getextrema()[0] < 255
    lossless = has_alpha or force_lossless
    pixels = rgba if has_alpha else rgba.convert('RGB')
    pixels.save(target, 'WEBP', quality=90, method=6, lossless=lossless, exact=True)
    with Image.open(target) as encoded:
        if encoded.format != 'WEBP' or encoded.size != pixels.size or getattr(encoded, 'n_frames', 1) != 1:
            raise ValueError()
        decoded = encoded.convert(pixels.mode)
    if lossless and pixels.tobytes() != decoded.tobytes():
        raise ValueError()
    error = ImageStat.Stat(ImageChops.difference(pixels, decoded)).mean
    return dict(width=pixels.width, height=pixels.height, hasAlpha=has_alpha, lossless=lossless,
                quality=90, method=6, meanAbsoluteError=error)


try:
    operation, source, *args = sys.argv[1:]
    print(json.dumps(svg(source) if operation == 'svg' else webp(source, args[0], args[1] == 'true')))
except ImportError:
    sys.exit(3)
except Exception:
    sys.exit(2)
