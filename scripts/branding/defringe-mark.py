"""Remove the dark fringe left around splash-mark.png's shapes by background removal (owner UX plan, 2026-11-21).
A "fringe" pixel = partly transparent, or opaque but dark (R+G+B < 380; the mark's darkest real colour is far above
that) within BAND px of transparency. Each takes the colour of the nearest clean opaque pixel; alpha is unchanged.
Usage: python3 scripts/branding/defringe-mark.py <in.png> <out.png>"""
import sys
from PIL import Image

def main(src, dst, radius=6):
    im = Image.open(src).convert('RGBA'); px = im.load(); W, H = im.size
    out = im.copy(); op = out.load()
    BAND = 4
    def near_clear(x, y):
        for dy in range(-BAND, BAND + 1):
            for dx in range(-BAND, BAND + 1):
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H and px[nx, ny][3] < 255:
                    return True
        return False
    bad = [[False] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if 0 < a < 255 or (a == 255 and r + g + b < 380 and near_clear(x, y)):
                bad[y][x] = True
    offsets = sorted(((dx, dy) for dx in range(-radius, radius + 1) for dy in range(-radius, radius + 1) if (dx, dy) != (0, 0)),
                     key=lambda d: d[0] * d[0] + d[1] * d[1])
    fixed = 0
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if a == 0:
                op[x, y] = (0, 0, 0, 0)
                continue
            if not bad[y][x]:
                continue
            for dx, dy in offsets:
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H and px[nx, ny][3] == 255 and not bad[ny][nx]:
                    nr, ng, nb, _ = px[nx, ny]; op[x, y] = (nr, ng, nb, a); fixed += 1
                    break
    out.save(dst, optimize=True)
    print('recoloured edge pixels:', fixed)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
