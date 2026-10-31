#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 AI HUD 应用图标（1024×1024 PNG，纯标准库，无第三方依赖）。

设计对齐 macOS Big Sur 之后的图标语言：
  · 圆角方形（squircle 近似）+ 上下渐变的深色底；
  · 中心同心双环：外环保留 70% 绿色弧（表达"剩余额度"），内环 45% 暗青弧；
  · 环内不放文字 —— 16pt 下任何字符都会糊成一团，图标只保留形状语义。

输出：assets/icon.png（Tauri `tauri icon` 的输入）
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

SIZE = 1024
SS = 2  # 2×2 超采样抗锯齿

BG_TOP = (28, 32, 44)
BG_BOTTOM = (12, 14, 20)
TRACK = (255, 255, 255, 26)
ARC_OUTER = (50, 215, 75)     # macOS systemGreen
ARC_INNER = (10, 132, 255)    # macOS systemBlue


# Apple 图标网格：1024 画布中内容区约 824px，其余留白给系统投影
TILE = SIZE * (824.0 / 1024.0)


def squircle_mask(x: float, y: float, size: float, radius: float) -> float:
    """近似 squircle：超椭圆 (|x|/a)^n + (|y|/a)^n <= 1，n=5 时接近 Apple 图标轮廓。"""
    cx = cy = size / 2
    a = TILE / 2
    dx = abs(x - cx) / a
    dy = abs(y - cy) / a
    n = 5.0
    return 1.0 if dx**n + dy**n <= 1.0 else 0.0


def blend(dst: tuple[int, int, int], src: tuple[int, int, int], alpha: float) -> tuple[int, int, int]:
    alpha = max(0.0, min(1.0, alpha))
    return (
        int(dst[0] + (src[0] - dst[0]) * alpha),
        int(dst[1] + (src[1] - dst[1]) * alpha),
        int(dst[2] + (src[2] - dst[2]) * alpha),
    )


def render() -> bytes:
    w = h = SIZE
    # RGB 缓冲（先渲染灰度 alpha 蒙版，再合成）
    px = [[(0, 0, 0) for _ in range(w)] for _ in range(h)]

    cx = cy = SIZE / 2
    r_outer = TILE * 0.300
    r_inner = TILE * 0.212
    stroke_outer = TILE * 0.062
    stroke_inner = TILE * 0.050

    outer_start = -90.0          # 从 12 点开始
    outer_sweep = 360.0 * 0.70   # 70% 剩余
    inner_start = -90.0
    inner_sweep = 360.0 * 0.45

    for y in range(h):
        # 竖直渐变底
        t = y / (h - 1)
        base = (
            int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t),
            int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t),
            int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t),
        )
        for x in range(w):
            if squircle_mask(x + 0.5, y + 0.5, SIZE, 0) == 0.0:
                px[y][x] = base
                continue

            col = base

            # 内描边：按超椭圆 n-范数距离计算，避免 max() 在正上/正下留下月牙
            nx = abs(x + 0.5 - cx) / (TILE / 2)
            ny = abs(y + 0.5 - cy) / (TILE / 2)
            edge_d = (nx ** 5 + ny ** 5) ** 0.2
            # 方向光：顶部更亮、底部收敛（macOS 常见的内嵌材质感）
            light = 0.30 - 0.16 * (y / (h - 1))
            if edge_d > 0.992:
                col = blend(col, (255, 255, 255), 0.16 + light * 0.45)
            elif edge_d > 0.968:
                col = blend(col, (255, 255, 255), 0.06 + light * 0.22)

            dx = x + 0.5 - cx
            dy = y + 0.5 - cy
            r = math.hypot(dx, dy)
            ang = (math.degrees(math.atan2(dy, dx)) + 360.0) % 360.0

            # 外环轨道
            if abs(r - r_outer) <= stroke_outer / 2:
                col = blend(col, (255, 255, 255), 0.13)
                # 弧段
                rel = (ang - (outer_start % 360.0) + 360.0) % 360.0
                if rel <= outer_sweep:
                    col = blend(col, ARC_OUTER, 1.0)

            # 外环圆头端点（HIG：仪表盘弧段用圆头）
            for cap_angle in (outer_start, outer_start + outer_sweep):
                ca = math.radians(cap_angle)
                cxp = cx + r_outer * math.cos(ca)
                cyp = cy + r_outer * math.sin(ca)
                if math.hypot(x + 0.5 - cxp, y + 0.5 - cyp) <= stroke_outer / 2:
                    col = blend(col, ARC_OUTER, 1.0)

            # 内环轨道
            if abs(r - r_inner) <= stroke_inner / 2:
                col = blend(col, (255, 255, 255), 0.11)
                rel = (ang - (inner_start % 360.0) + 360.0) % 360.0
                if rel <= inner_sweep:
                    col = blend(col, ARC_INNER, 0.97)

            # 内环圆头端点
            for cap_angle in (inner_start, inner_start + inner_sweep):
                ca = math.radians(cap_angle)
                cxp = cx + r_inner * math.cos(ca)
                cyp = cy + r_inner * math.sin(ca)
                if math.hypot(x + 0.5 - cxp, y + 0.5 - cyp) <= stroke_inner / 2:
                    col = blend(col, ARC_INNER, 0.97)

            # 圆心柔光
            if r < r_inner - stroke_inner:
                col = blend(col, (255, 255, 255), 0.04 * (1 - r / (r_inner - stroke_inner)))

            px[y][x] = col

    # 编码 PNG：RGBA，外圈全透明
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter type 0
        for x in range(w):
            r, g, b = px[y][x]
            inside = squircle_mask(x + 0.5, y + 0.5, SIZE, 0)
            a = 255 if inside else 0
            raw += bytes((r, g, b, a))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "assets" / "icon.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    data = render()
    out.write_bytes(data)
    print(f"wrote {out} ({len(data)} bytes, {SIZE}x{SIZE})")


if __name__ == "__main__":
    main()
