# -*- coding: utf-8 -*-
"""生成程序图标：一个简化的方框图（两个方块 + 反馈回路）。"""
import os
from PIL import Image, ImageDraw, ImageFont

S = 512
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)


def load_font(size):
    for name in ("arialbd.ttf", "arial.ttf", "seguisb.ttf", "segoeui.ttf", "msyhbd.ttc", "msyh.ttc"):
        p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", name)
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def rounded(size, radius, fill):
    im = Image.new("RGBA", size, (0, 0, 0, 0))
    dd = ImageDraw.Draw(im)
    dd.rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=fill)
    return im


# 背景：蓝色圆角方块（竖向渐变）
bg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
bd = ImageDraw.Draw(bg)
for y in range(S):
    t = y / (S - 1)
    r = int(30 + (59 - 30) * t)
    g = int(64 + (130 - 64) * t)
    b = int(175 + (246 - 175) * t)
    bd.line([(0, y), (S, y)], fill=(r, g, b, 255))
mask = rounded((S, S), 96, (255, 255, 255, 255))
img.paste(bg, (0, 0), mask)
d = ImageDraw.Draw(img)

W = (255, 255, 255, 255)
BLUE = (30, 64, 175, 255)
LW = 17

# 两个方块
d.rounded_rectangle([92, 190, 220, 322], radius=20, fill=(255, 255, 255, 248))
d.rounded_rectangle([292, 190, 420, 322], radius=20, fill=(255, 255, 255, 248))

# 方块里的 G1 / G2
font = load_font(84)
for text, cx in (("G1", 156), ("G2", 356)):
    bb = d.textbbox((0, 0), text, font=font)
    d.text((cx - (bb[2] - bb[0]) / 2 - bb[0], 256 - (bb[3] - bb[1]) / 2 - bb[1]),
           text, font=font, fill=BLUE)

# 主通路箭头：输入 -> G1 -> G2 -> 输出
d.line([(28, 256), (92, 256)], fill=W, width=LW)
d.line([(220, 256), (292, 256)], fill=W, width=LW)
d.line([(420, 256), (472, 256)], fill=W, width=LW)
d.polygon([(470, 228), (508, 256), (470, 284)], fill=W)

# 引出点（黄色小圆）落在 G2 之后的线上
d.ellipse([434, 244, 458, 268], fill=(250, 204, 21, 255))

# 反馈回路：从引出点向下、向左、再向上回到 G1
d.line([(446, 268), (446, 404)], fill=W, width=LW)
d.line([(446, 404), (156, 404)], fill=W, width=LW)
d.line([(156, 404), (156, 326)], fill=W, width=LW)
d.polygon([(132, 348), (156, 324), (180, 348)], fill=W)

img.save("icon.png")

sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
img.save("icon.ico", format="ICO", sizes=sizes)
print("icon.ico 生成完成:", sizes)

