#!/usr/bin/env python3
"""
Extract two Youmi Lens Y marks from official master raster:
  - lockup: header brand row (fuller silhouette, closer to master)
  - nav: top bar (thicker, shorter stem, stable at small sizes)

Requires: opencv-python-headless, numpy.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np


def blue_mask_bgr(im_bgr: np.ndarray) -> np.ndarray:
    b, g, r = cv2.split(im_bgr)
    mask = np.zeros(im_bgr.shape[:2], np.uint8)
    m1 = (b > 40) & (b > r) & (b > g - 5) & (r < 100) & (g < 110)
    m2 = (r.astype(np.int32) + g.astype(np.int32) + b.astype(np.int32)) > 40
    mask[(m1 & m2)] = 255
    return mask


def largest_outer_contour(mask: np.ndarray) -> np.ndarray | None:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None
    return max(contours, key=cv2.contourArea)


def shorten_stem(mask: np.ndarray, frac_bottom: float) -> np.ndarray:
    """Trim the bottom fraction of the shape bbox (shortens tail, keeps arms)."""
    ys, _xs = np.where(mask > 0)
    if len(ys) == 0:
        return mask
    y0, y1 = int(ys.min()), int(ys.max())
    h = y1 - y0 + 1
    cut = int(y1 - frac_bottom * h)
    out = mask.copy()
    out[cut + 1 :, :] = 0
    return out


def mask_lockup(raw: np.ndarray) -> np.ndarray:
    """Header lockup: merge parts, modest thicken (~15%), keep full stem, softer simplify."""
    k_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (19, 19))
    m = cv2.morphologyEx(raw, cv2.MORPH_CLOSE, k_close)
    k_th = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    m = cv2.dilate(m, k_th, iterations=1)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    return m


def mask_nav(raw: np.ndarray) -> np.ndarray:
    """Nav bar: thicker (~18%), blur waist, shorten stem, prioritize solid read at low px."""
    k_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21))
    m = cv2.morphologyEx(raw, cv2.MORPH_CLOSE, k_close)
    k_th = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    m = cv2.dilate(m, k_th, iterations=1)
    blur = cv2.GaussianBlur(m, (7, 7), 0)
    m = (blur > 95).astype(np.uint8) * 255
    m = cv2.morphologyEx(
        m,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)),
    )
    m = shorten_stem(m, 0.15)
    m = cv2.morphologyEx(
        m,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)),
    )
    return m


def contour_to_path_d(
    contour: np.ndarray,
    min_xy: tuple[float, float],
    scale: float,
) -> str:
    pts = contour.reshape(-1, 2).astype(np.float64)
    parts: list[str] = []
    for i, (x, y) in enumerate(pts):
        px = (x - min_xy[0]) * scale
        py = (y - min_xy[1]) * scale
        if i == 0:
            parts.append(f"M{px:.4f},{py:.4f}")
        else:
            parts.append(f"L{px:.4f},{py:.4f}")
    parts.append("Z")
    return "".join(parts)


def path_from_mask(
    mask: np.ndarray,
    vb_w: float,
    eps_factor: float,
) -> tuple[str, float, float] | None:
    cnt = largest_outer_contour(mask)
    if cnt is None:
        return None
    per = cv2.arcLength(cnt, True)
    cnt = cv2.approxPolyDP(cnt, eps_factor * per, True)
    x, y, w, h = cv2.boundingRect(cnt)
    if w < 1 or h < 1:
        return None
    scale = vb_w / float(w)
    vb_h = float(h) * scale
    d = contour_to_path_d(cnt, (float(x), float(y)), scale)
    return d, vb_w, vb_h


def write_svg(path: Path, d: str, vb_w: float, vb_h: float) -> None:
    text = "\n".join(
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vb_w:.4f} {vb_h:.4f}" fill="currentColor" aria-hidden="true">',
            f'  <path fill="currentColor" d="{d}"/>',
            "</svg>",
            "",
        ]
    )
    path.write_text(text, encoding="utf-8")


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    src = root / "public" / "brand" / "youmi-lens-master-y-source.png"
    if not src.is_file():
        print("Source PNG not found:", src, file=sys.stderr)
        return 1

    out_dir = root / "src" / "branding"
    out_dir.mkdir(parents=True, exist_ok=True)

    im = cv2.imread(str(src))
    if im is None:
        print("Failed to read image", file=sys.stderr)
        return 1

    raw = blue_mask_bgr(im)

    m_lockup = mask_lockup(raw)
    m_nav = mask_nav(raw)

    # Lockup: tighter path fidelity; nav: heavier smooth (stable glyph, not skeleton)
    pl = path_from_mask(m_lockup, 40.0, 0.00085)
    pn = path_from_mask(m_nav, 40.0, 0.0048)
    if pl is None or pn is None:
        print("Contour extraction failed", file=sys.stderr)
        return 1

    d_lockup, vb_w_l, vb_h_l = pl
    d_nav, vb_w_n, vb_h_n = pn

    meta = {
        "lockupViewBox": f"0 0 {vb_w_l:.4f} {vb_h_l:.4f}",
        "navViewBox": f"0 0 {vb_w_n:.4f} {vb_h_n:.4f}",
        "source": "public/brand/youmi-lens-master-y-source.png",
    }
    (out_dir / "youmi-lens-mark-y.meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    ts = "\n".join(
        [
            "/** Auto-generated by scripts/extract-youmi-y-mark.py - do not edit by hand. */",
            f"export const YOUMI_LENS_MARK_LOCKUP_VIEWBOX = '0 0 {vb_w_l:.4f} {vb_h_l:.4f}' as const",
            f"export const YOUMI_LENS_MARK_LOCKUP_VB_WIDTH = {vb_w_l} as const",
            f"export const YOUMI_LENS_MARK_LOCKUP_VB_HEIGHT = {vb_h_l:.4f} as const",
            f"export const YOUMI_LENS_MARK_PATH_LOCKUP = {json.dumps(d_lockup)}",
            "",
            f"export const YOUMI_LENS_MARK_NAV_VIEWBOX = '0 0 {vb_w_n:.4f} {vb_h_n:.4f}' as const",
            f"export const YOUMI_LENS_MARK_NAV_VB_WIDTH = {vb_w_n} as const",
            f"export const YOUMI_LENS_MARK_NAV_VB_HEIGHT = {vb_h_n:.4f} as const",
            f"export const YOUMI_LENS_MARK_PATH_NAV = {json.dumps(d_nav)}",
            "",
        ]
    )
    (out_dir / "youmiLensMarkPaths.ts").write_text(ts, encoding="utf-8")

    write_svg(out_dir / "youmi-lens-mark-y-lockup.svg", d_lockup, vb_w_l, vb_h_l)
    write_svg(out_dir / "youmi-lens-mark-y-nav.svg", d_nav, vb_w_n, vb_h_n)

    # Remove legacy filenames if present
    for legacy in ("youmi-lens-mark-y-master.svg", "youmi-lens-mark-y-ui.svg"):
        leg = out_dir / legacy
        if leg.is_file():
            leg.unlink()

    print("Wrote lockup viewBox", meta["lockupViewBox"])
    print("Wrote nav viewBox", meta["navViewBox"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
