# Rebuilds the brand mark, favicon and app icons from the traced bobber.
#   python3 art/trace.py art/bobber-gemini.jpg <full.svg> <unused.svg>
#   python3 art/isolate.py art/bobber-gemini.jpg <isolated.png>   (the bobber's own strokes)
#   python3 art/trace.py <isolated.png> <small.svg> <unused.svg>
#   python3 art/make-icons.py <full.svg> <small.svg>              (then rasterise: see the README)
import re, sys
full = re.search(r' d="([^"]+)"', open(sys.argv[1]).read()).group(1)
small = re.search(r' d="([^"]+)"', open(sys.argv[2]).read()).group(1)
PAPER, INK = '#ebe6d6', '#d9501b'
def write(path, body): open(path, 'w').write(body)
write('icons/mark.svg', f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="{INK}" fill-rule="evenodd" d="{full}"/></svg>\n')
write('icons/mark-small.svg', f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="{INK}" fill-rule="evenodd" d="{small}"/></svg>\n')
write('favicon.svg', f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="{PAPER}"/><g transform="translate(9 9) scale(.82)"><path fill="{INK}" fill-rule="evenodd" d="{small}"/></g></svg>\n')
write('icons/icon.svg', f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="{PAPER}"/><g transform="translate(6 6) scale(.88)"><path fill="{INK}" fill-rule="evenodd" d="{full}"/></g></svg>\n')
write('icons/icon-maskable.svg', f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="{PAPER}"/><g transform="translate(15 15) scale(.7)"><path fill="{INK}" fill-rule="evenodd" d="{full}"/></g></svg>\n')
# The header's symbol, and the inline copies on the spots and questions pages
s = open('index.html').read()
s = re.sub(r'(<symbol id="i-bobber" viewBox="0 0 100 100"><path fill-rule="evenodd" d=")[^"]+', lambda m: m.group(1) + small, s)
open('index.html', 'w').write(s)
for p in ['faq/index.html', 'spots/index.html']:
    t = open(p).read()
    t = re.sub(r'(<svg class="brand-mark" viewBox="0 0 100 100" aria-hidden="true"><path fill-rule="evenodd" d=")[^"]+', lambda m: m.group(1) + small, t)
    open(p, 'w').write(t)
