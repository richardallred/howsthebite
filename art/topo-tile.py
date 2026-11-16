# A seamless tile of contour lines for the page background (styles.css, --topo).
# The height field is periodic in both directions, so the lines meet themselves across
# every edge and the tile can repeat forever.  python3 art/topo-tile.py out.svg
import math, random, sys
random.seed(11)
W = H = 1200; S = 10
nx, ny = W // S, H // S
# Hills, each repeated on the tile's neighbours so the field wraps
hills = [(random.uniform(0, W), random.uniform(0, H), random.uniform(140, 300), random.uniform(0.4, 1.0)) for _ in range(7)]
waves = [(random.randint(1, 3), random.randint(-2, 2), random.uniform(0, 6.28), random.uniform(0.05, 0.1)) for _ in range(5)]
def f(x, y):
    v = 0
    for cx, cy, r, a in hills:
        for ox in (-W, 0, W):
            for oy in (-H, 0, H):
                v += a * math.exp(-((x-cx-ox)**2 + (y-cy-oy)**2) / (2*r*r))
    v += sum(amp * math.sin(2*math.pi*(kx*x/W + ky*y/H) + ph) for kx, ky, ph, amp in waves)
    return v
G = [[f(i*S, j*S) for i in range(nx)] for j in range(ny)]
val = lambda i, j: G[j % ny][i % nx]  # wraps: column nx is column 0
def interp(p1, p2, v1, v2, t):
    k = (t-v1)/(v2-v1) if v2 != v1 else 0.5
    return (round(p1[0]+k*(p2[0]-p1[0]), 1), round(p1[1]+k*(p2[1]-p1[1]), 1))
TABLE = {1:[(3,0)],2:[(0,1)],3:[(3,1)],4:[(1,2)],5:[(3,0),(1,2)],6:[(0,2)],7:[(3,2)],8:[(2,3)],9:[(0,2)],10:[(0,1),(2,3)],11:[(1,2)],12:[(1,3)],13:[(0,1)],14:[(3,0)]}
def segments(t):
    out = []
    for j in range(ny):
        for i in range(nx):
            c = [(i*S,j*S),(i*S+S,j*S),(i*S+S,j*S+S),(i*S,j*S+S)]
            v = [val(i,j), val(i+1,j), val(i+1,j+1), val(i,j+1)]
            idx = sum(1 << k for k in range(4) if v[k] > t)
            E = lambda a, b: interp(c[a], c[b], v[a], v[b], t)
            for a, b in TABLE.get(idx, []):
                ea = {0:(0,1),1:(1,2),2:(2,3),3:(3,0)}[a]; eb = {0:(0,1),1:(1,2),2:(2,3),3:(3,0)}[b]
                out.append((E(*ea), E(*eb)))
    return out
def join(ss):
    from collections import defaultdict
    adj = defaultdict(list)
    for k, (a, b) in enumerate(ss): adj[a].append(k); adj[b].append(k)
    used = set(); lines = []
    for k in range(len(ss)):
        if k in used: continue
        used.add(k); line = list(ss[k])
        for end in (1, 0):
            while True:
                p = line[-1] if end else line[0]
                nxt = [m for m in adj[p] if m not in used]
                if not nxt: break
                m = nxt[0]; used.add(m); a, b = ss[m]; q = b if a == p else a
                if end: line.append(q)
                else: line.insert(0, q)
        lines.append(line)
    return lines
def rdp(pts, eps):
    if len(pts) < 3: return pts
    (x1,y1),(x2,y2) = pts[0], pts[-1]; dx, dy = x2-x1, y2-y1; L = math.hypot(dx,dy) or 1e-9
    d = [abs(dy*(x-x1)-dx*(y-y1))/L for x,y in pts[1:-1]]; i = max(range(len(d)), key=d.__getitem__)
    if d[i] > eps: return rdp(pts[:i+2], eps)[:-1] + rdp(pts[i+1:], eps)
    return [pts[0], pts[-1]]
def path(p):
    r = lambda v: str(round(v))
    out = f"M{r(p[0][0])} {r(p[0][1])}"
    for i in range(len(p)-1):
        p0 = p[i-1] if i else p[i]; p1, p2 = p[i], p[i+1]; p3 = p[i+2] if i+2 < len(p) else p2
        c1 = (p1[0]+(p2[0]-p0[0])/6, p1[1]+(p2[1]-p0[1])/6); c2 = (p2[0]-(p3[0]-p1[0])/6, p2[1]-(p3[1]-p1[1])/6)
        out += f"C{r(c1[0])} {r(c1[1])} {r(c2[0])} {r(c2[1])} {r(p2[0])} {r(p2[1])}"
    return out
flat = [v for row in G for v in row]; lo, hi = min(flat), max(flat)
thin, thick = [], []
for n, t in enumerate(lo + (hi-lo)*k/26 for k in range(1, 26)):
    for line in join(segments(t)):
        pts = rdp(line, 2.0)
        (thick if n % 5 == 4 else thin).append(path(pts))
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">'
       f'<path stroke-width="1" d="{"".join(thin)}"/><path stroke-width="2" d="{"".join(thick)}"/></svg>')
open(sys.argv[1], 'w').write(svg); print(len(svg), 'bytes')
