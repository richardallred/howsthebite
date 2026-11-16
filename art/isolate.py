# Keep the whole ink strokes that belong to the bobber; drop the ripple rings around it.
import sys
from collections import deque
import numpy as np
from PIL import Image
src, out = sys.argv[1:3]
im = Image.open(src).convert('L')
W, H = im.size
a = np.asarray(im) < 128
seen = np.zeros_like(a, dtype=bool)
keep = np.zeros_like(a, dtype=bool)
cx, cy, r = 958, 930, 430  # the ball, in the 2000-px source
report = []
for y0, x0 in zip(*np.nonzero(a)):
    if seen[y0, x0]: continue
    q = deque([(y0, x0)]); seen[y0, x0] = True; px = []
    while q:
        y, x = q.popleft(); px.append((y, x))
        for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
            ny, nx = y+dy, x+dx
            if 0 <= ny < H and 0 <= nx < W and a[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True; q.append((ny, nx))
    if len(px) < 40: continue
    ys = np.array([p[0] for p in px]); xs = np.array([p[1] for p in px])
    my, mx = ys.mean(), xs.mean()
    inside = (mx-cx)**2 + (my-cy)**2 <= r*r
    report.append((int(mx), int(my), len(px), inside))
    if inside: keep[ys, xs] = True
Image.fromarray(np.where(keep, 0, 255).astype('uint8')).save(out)
for row in sorted(report): print(row)
