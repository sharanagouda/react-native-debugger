#!/usr/bin/env python3
"""
ReactoRadar Icon Generator
Generates all macOS iconset sizes from icon.svg, then compiles icon.icns.

Requirements:
    pip install cairosvg pillow

Usage:
    python3 generate_icons.py
"""

import os
import shutil
import struct
import subprocess
import sys
import zlib
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent.resolve()
SVG_SRC    = SCRIPT_DIR / "icon.svg"
ICONSET    = SCRIPT_DIR / "icon.iconset"
ICNS_OUT   = SCRIPT_DIR / "icon.icns"
PNG_OUT    = SCRIPT_DIR / "icon.png"   # 1024×1024, for Electron dev mode

SIZES = [
    # (filename, pixels)
    ("icon_16x16.png",         16),
    ("icon_16x16@2x.png",      32),
    ("icon_32x32.png",         32),
    ("icon_32x32@2x.png",      64),
    ("icon_128x128.png",       128),
    ("icon_128x128@2x.png",    256),
    ("icon_256x256.png",       256),
    ("icon_256x256@2x.png",    512),
    ("icon_512x512.png",       512),
    ("icon_512x512@2x.png",    1024),
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def render_svg_to_png(svg_path: Path, out_path: Path, size: int) -> None:
    """Render SVG → PNG at the given square pixel size."""
    try:
        import cairosvg
        cairosvg.svg2png(
            url=str(svg_path),
            write_to=str(out_path),
            output_width=size,
            output_height=size,
        )
    except ImportError:
        # Fallback: Inkscape CLI
        result = subprocess.run(
            ["inkscape", "--export-type=png",
             f"--export-filename={out_path}",
             f"--export-width={size}",
             f"--export-height={size}",
             str(svg_path)],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            print(f"  inkscape error: {result.stderr}", file=sys.stderr)
            raise RuntimeError("SVG rendering failed")


def build_icns_with_iconutil(iconset_dir: Path, icns_path: Path) -> bool:
    """Use macOS iconutil if available."""
    if shutil.which("iconutil"):
        result = subprocess.run(
            ["iconutil", "-c", "icns", str(iconset_dir), "-o", str(icns_path)],
            capture_output=True, text=True
        )
        if result.returncode == 0:
            return True
        print(f"  iconutil error: {result.stderr}", file=sys.stderr)
    return False


def _png_bytes(path: Path) -> bytes:
    return path.read_bytes()


def _icns_chunk(tag: bytes, data: bytes) -> bytes:
    """Pack one ICNS chunk: 4-byte OSType + 4-byte length (includes header) + data."""
    length = 8 + len(data)
    return tag + struct.pack(">I", length) + data


# ICNS OSType tags for each size
_ICNS_TAGS = {
    16:   b"icp4",
    32:   b"icp5",
    64:   b"icp6",
    128:  b"ic07",
    256:  b"ic08",
    512:  b"ic09",
    1024: b"ic10",
}


def build_icns_pure_python(iconset_dir: Path, icns_path: Path) -> None:
    """Pure-Python ICNS writer (fallback when iconutil unavailable)."""
    chunks = b""
    # Deduplicate: use only the @2x names (they have the higher-res pixels)
    # Actually we want one entry per unique pixel size, highest quality first.
    seen = {}
    for fname, size in SIZES:
        if size not in seen:
            seen[size] = iconset_dir / fname

    for size in sorted(seen):
        tag = _ICNS_TAGS.get(size)
        if tag is None:
            continue
        png_path = seen[size]
        if not png_path.exists():
            print(f"  warning: {png_path.name} missing, skipping")
            continue
        chunks += _icns_chunk(tag, _png_bytes(png_path))

    total = 8 + len(chunks)
    icns_path.write_bytes(b"icns" + struct.pack(">I", total) + chunks)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=== ReactoRadar Icon Generator ===\n")

    if not SVG_SRC.exists():
        print(f"ERROR: {SVG_SRC} not found.", file=sys.stderr)
        sys.exit(1)

    # 1. Create iconset directory
    ICONSET.mkdir(exist_ok=True)
    print(f"Output directory: {ICONSET}\n")

    # 2. Render each size
    for fname, size in SIZES:
        out = ICONSET / fname
        print(f"  Rendering {fname:30s} ({size:4d}px) ...", end=" ", flush=True)
        render_svg_to_png(SVG_SRC, out, size)
        kb = out.stat().st_size // 1024
        print(f"done  ({kb} KB)")

    # 3. Copy 1024×1024 as icon.png (Electron dev-mode asset)
    shutil.copy2(ICONSET / "icon_512x512@2x.png", PNG_OUT)
    print(f"\nCopied icon.png  ({PNG_OUT.stat().st_size // 1024} KB)")

    # 4. Build ICNS
    print(f"\nBuilding {ICNS_OUT.name} ...")
    if not build_icns_with_iconutil(ICONSET, ICNS_OUT):
        print("  iconutil not available – using pure-Python writer")
        build_icns_pure_python(ICONSET, ICNS_OUT)
    print(f"  Written: {ICNS_OUT}  ({ICNS_OUT.stat().st_size // 1024} KB)")

    print("\n✅ All done!\n")
    print("Files generated:")
    print(f"  {ICONSET}/          ← all PNG sizes")
    print(f"  {ICNS_OUT}       ← for Electron builder  (assets/icon.icns)")
    print(f"  {PNG_OUT}        ← for Electron dev mode (assets/icon.png)")
    print(f"  {SVG_SRC}        ← master source")


if __name__ == "__main__":
    main()
