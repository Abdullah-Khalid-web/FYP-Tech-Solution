import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

prefix = sys.argv[1]
out = sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 4
width = 280

files = sorted(Path(".").glob(f"{prefix}-*.png"))
n = len(files)
rows = (n + cols - 1) // cols

with Image.open(files[0]) as img:
    aspect = img.height / img.width
height = int(width * aspect)
font_size = 22
pad = 14

grid_w = cols * width + (cols + 1) * pad
grid_h = rows * (height + font_size + 10) + (rows + 1) * pad
grid = Image.new("RGB", (grid_w, grid_h), "white")
draw = ImageDraw.Draw(grid)
try:
    font = ImageFont.load_default(size=font_size)
except Exception:
    font = ImageFont.load_default()

for i, f in enumerate(files):
    row, col = i // cols, i % cols
    x = col * width + (col + 1) * pad
    y = row * (height + font_size + 10) + (row + 1) * pad
    label = f"{i+1}: {f.stem}"
    draw.text((x, y), label, fill="black", font=font)
    with Image.open(f) as img:
        img.thumbnail((width, height))
        grid.paste(img, (x, y + font_size + 6))

grid.save(out, quality=90)
print(out)
