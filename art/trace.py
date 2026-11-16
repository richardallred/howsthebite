import sys, math
import numpy as np
from PIL import Image, ImageFilter
src, out_full, out_small = sys.argv[1:4]
TIGHT = '--tight' in sys.argv  # crop to the drawing instead of a square
N = int(next((a.split('=')[1] for a in sys.argv if a.startswith('--size=')), 800))
img = Image.open(src).convert('L').filter(ImageFilter.GaussianBlur(1.2)).resize((N, N), Image.LANCZOS)
a = 1 - np.asarray(img, dtype=float) / 255  # ink = 1
T = 0.5
def segs(a):
    h, w = a.shape; out = []
    p = np.pad(a, 1)  # close shapes at the border
    h, w = p.shape
    for j in range(h-1):
        row0, row1 = p[j], p[j+1]
        for i in range(w-1):
            v = (row0[i], row0[i+1], row1[i+1], row1[i])
            idx = sum(1 << k for k in range(4) if v[k] > T)
            if idx in (0, 15): continue
            c = ((i, j), (i+1, j), (i+1, j+1), (i, j+1))
            def e(a_, b_):
                va, vb = v[a_], v[b_]; k = (T - va) / (vb - va)
                return (round(c[a_][0] + k*(c[b_][0]-c[a_][0]) - 1, 3), round(c[a_][1] + k*(c[b_][1]-c[a_][1]) - 1, 3))
            E = {0: lambda: e(0,1), 1: lambda: e(1,2), 2: lambda: e(2,3), 3: lambda: e(3,0)}
            table = {1:[(3,0)],2:[(0,1)],3:[(3,1)],4:[(1,2)],5:[(3,0),(1,2)],6:[(0,2)],7:[(3,2)],8:[(2,3)],9:[(0,2)],10:[(0,1),(2,3)],11:[(1,2)],12:[(1,3)],13:[(0,1)],14:[(3,0)]}
            for x, y in table[idx]: out.append((E[x](), E[y]()))
    return out
def join(ss):
    from collections import defaultdict
    adj = defaultdict(list)
    for k, (p0, p1) in enumerate(ss): adj[p0].append(k); adj[p1].append(k)
    used = set(); loops = []
    for k in range(len(ss)):
        if k in used: continue
        used.add(k); line = list(ss[k])
        while True:
            nxt = [m for m in adj[line[-1]] if m not in used]
            if not nxt: break
            m = nxt[0]; used.add(m); p0, p1 = ss[m]; line.append(p1 if p0 == line[-1] else p0)
        loops.append(line)
    return loops
def rdp(pts, eps):
    if len(pts) < 3: return pts
    (x1,y1),(x2,y2) = pts[0], pts[-1]; dx, dy = x2-x1, y2-y1; L = math.hypot(dx,dy) or 1e-9
    d = [abs(dy*(x-x1)-dx*(y-y1))/L for x,y in pts[1:-1]]; i = max(range(len(d)), key=d.__getitem__)
    if d[i] > eps: return rdp(pts[:i+2], eps)[:-1] + rdp(pts[i+1:], eps)
    return [pts[0], pts[-1]]
def smooth(p, s):
    r = lambda v: f"{v*s:.1f}".rstrip('0').rstrip('.')
    n = len(p); out = f"M{r(p[0][0])} {r(p[0][1])}"
    for i in range(n):
        p0, p1, p2, p3 = p[i-1], p[i], p[(i+1)%n], p[(i+2)%n]
        c1 = (p1[0]+(p2[0]-p0[0])/6, p1[1]+(p2[1]-p0[1])/6); c2 = (p2[0]-(p3[0]-p1[0])/6, p2[1]-(p3[1]-p1[1])/6)
        out += f"C{r(c1[0])} {r(c1[1])} {r(c2[0])} {r(c2[1])} {r(p2[0])} {r(p2[1])}"
    return out + "Z"
loops = [l for l in join(segs(a)) if len(l) > 8]
shapes = []
for l in loops:
    pts = rdp(l[:-1] if l[0] == l[-1] else l, 0.55)
    if len(pts) < 3: continue
    xs = [x for x, _ in pts]; ys = [y for _, y in pts]
    shapes.append({'pts': pts, 'box': (min(xs), min(ys), max(xs), max(ys))})
def write(path, keep, pad):
    sel = [s for s in shapes if keep(s)]
    x0 = min(s['box'][0] for s in sel); y0 = min(s['box'][1] for s in sel); x1 = max(s['box'][2] for s in sel); y1 = max(s['box'][3] for s in sel)
    if TIGHT:
        w, h = (x1-x0) * (1 + 2*pad), (y1-y0) + (x1-x0) * 2*pad
        ox, oy = (x0+x1)/2 - w/2, (y0+y1)/2 - h/2; s = 200 / w
        box = f'0 0 200 {h*s:.1f}'
    else:
        side = max(x1-x0, y1-y0) * (1 + 2*pad); cx, cy = (x0+x1)/2, (y0+y1)/2
        ox, oy = cx - side/2, cy - side/2; s = 100 / side
        box = '0 0 100 100'
    d = ''.join(smooth([(x-ox, y-oy) for x, y in sh['pts']], s) for sh in sel)
    open(path, 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}"><path fill-rule="evenodd" d="{d}"/></svg>\n')
    return len(d)
# The bobber alone: shapes inside the ball's box (original 2000px: x 560–1360, y 420–1360), scaled to N
k = N / 2000
inside = lambda s: s['box'][0] >= 540*k and s['box'][2] <= 1380*k and s['box'][1] >= 400*k and s['box'][3] <= 1380*k
print('full', write(out_full, lambda s: True, 0.04), 'shapes', len(shapes))
print('small', write(out_small, inside, 0.06), 'shapes', sum(1 for s in shapes if inside(s)))
