import sys
import fitz

pdf_path = sys.argv[1]
prefix = sys.argv[2] if len(sys.argv) > 2 else "slide"
zoom = float(sys.argv[3]) if len(sys.argv) > 3 else 1.8

doc = fitz.open(pdf_path)
mat = fitz.Matrix(zoom, zoom)
for i, page in enumerate(doc, start=1):
    pix = page.get_pixmap(matrix=mat)
    out = f"{prefix}-{i:02d}.png"
    pix.save(out)
    print(out)
