#!/usr/bin/env python3
"""Source-backed concept figures; no experimental values are generated.

Run with Python + Matplotlib 3.10.8. Outputs are written beside this script.
Coordinates are millimetres; the figure is drawn at its intended 160 mm width.
"""
from pathlib import Path
import json
import hashlib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Polygon, Circle

OUT = Path(__file__).resolve().parent
BLUE = "#0077BB"
TEAL = "#008477"
WARM = "#B95A24"
INK = "#20333E"
GRAY = "#53636E"
LINE = "#AEBCC5"
PALE_BLUE = "#EFF6FA"
PALE_TEAL = "#EFF8F6"
PALE_WARM = "#FFF4EB"
matplotlib.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["Arial", "Helvetica", "DejaVu Sans"],
    "font.size": 8, "figure.dpi": 300, "savefig.dpi": 300,
    "pdf.fonttype": 42, "ps.fonttype": 42,
    "svg.fonttype": "none", "svg.hashsalt": "waterfall-academic-20261021",
    "axes.spines.top": False, "axes.spines.right": False,
})


def canvas():
    fig = plt.figure(figsize=(160 / 25.4, 84 / 25.4), facecolor="white")
    ax = fig.add_axes([0, 0, 1, 1], xlim=(0, 160), ylim=(0, 84))
    ax.set_axis_off()
    return fig, ax


def text(ax, x, y, s, size=8, color=INK, weight="normal", ha="center", **kw):
    return ax.text(x, y, s, fontsize=size, color=color, weight=weight,
                   ha=ha, va="center", linespacing=1.22, zorder=8, **kw)


def box(ax, x, y, w, h, edge=LINE, fill="white", dashed=False, radius=1.4, lw=.7):
    p = FancyBboxPatch((x, y), w, h,
                      boxstyle=f"round,pad=0,rounding_size={radius}",
                      facecolor=fill, edgecolor=edge, linewidth=lw,
                      linestyle=(0, (3, 2)) if dashed else "solid", zorder=2)
    ax.add_patch(p)
    return p


def route(ax, pts, color=INK, width=.85, arrow=True, dashed=False, z=4):
    """Orthogonal or straight single-headed connector with an explicit route."""
    xs, ys = zip(*pts)
    ax.plot(xs, ys, color=color, linewidth=width,
            linestyle=(0, (2.6, 2.2)) if dashed else "solid",
            solid_joinstyle="round", solid_capstyle="round", zorder=z)
    if arrow:
        a, b = pts[-2:]
        dx, dy = b[0]-a[0], b[1]-a[1]
        length = (dx*dx + dy*dy) ** .5
        assert length > 0
        ux, uy = dx/length, dy/length
        back = (b[0]-1.3*ux, b[1]-1.3*uy)
        ax.add_patch(Polygon([b, (back[0]-.65*uy, back[1]+.65*ux),
                             (back[0]+.65*uy, back[1]-.65*ux)],
                            closed=True, facecolor=color, edgecolor="none", zorder=z))


def doc(ax, x, y, w=5, h=7, color=BLUE, label=None, fill="white", lines=True):
    fold = min(1.4, w*.25)
    verts = [(x,y), (x+w,y), (x+w,y+h-fold), (x+w-fold,y+h),
             (x,y+h), (x,y)]
    ax.add_patch(Polygon(verts, facecolor=fill, edgecolor=color, linewidth=.65, zorder=5))
    route(ax, [(x+w-fold,y+h), (x+w-fold,y+h-fold), (x+w,y+h-fold)],
          color=color, width=.5, arrow=False, z=6)
    if label:
        text(ax, x+w/2, y+h/2-.35, label, color=color, size=8)
    elif lines:
        for off in (2.0, 3.5):
            route(ax, [(x+1,y+off),(x+w-1,y+off)], color=color, width=.5, arrow=False, z=6)


def state_glyph(ax, x, y, color=TEAL, amended=False):
    box(ax, x, y, 6, 8, edge=color, fill="white", radius=.5, lw=.65)
    for yy in (y+2, y+4, y+6):
        route(ax, [(x+1,yy),(x+5,yy)],
              color=WARM if amended and yy == y+6 else color,
              width=.7, arrow=False, z=6)


def save(fig, ax, name):
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    bboxes = [(t.get_text(), t.get_window_extent(renderer)) for t in ax.texts]
    bounds = fig.bbox
    clipped = [s for s,b in bboxes if b.x0 < bounds.x0 or b.y0 < bounds.y0
               or b.x1 > bounds.x1 or b.y1 > bounds.y1]
    overlaps = []
    for i, (s,a) in enumerate(bboxes):
        for t,b in bboxes[i+1:]:
            if a.overlaps(b):
                overlaps.append([s,t])
    assert not clipped, f"Clipped labels in {name}: {clipped}"
    assert min(t.get_fontsize() for t in ax.texts) >= 8
    fig.savefig(OUT / f"waterfall-{name}.png", dpi=300, facecolor="white")
    fig.savefig(OUT / f"waterfall-{name}.svg", facecolor="white",
                metadata={"Date": None, "Creator": "Matplotlib; source-backed concept map"})
    fig.savefig(OUT / f"waterfall-{name}.pdf", facecolor="white",
                metadata={"Title": f"Waterfall {name}", "Creator": "Matplotlib; academic-research version A"})
    result = {"width_mm": 160, "height_mm": 84, "dpi": 300,
              "minimum_font_pt": min(t.get_fontsize() for t in ax.texts),
              "text_outside_canvas": clipped, "text_bbox_overlap_candidates": overlaps,
              "statistical_values": "none; all item letters are illustrative identifiers"}
    plt.close(fig)
    return result


def architecture():
    fig, ax = canvas()
    # Same accepted state reaches both execution operations along the outer rail.
    route(ax, [(51,43),(55,43),(55,82),(158,82),(158,27)], color=TEAL,
          width=.8, arrow=False, z=1)
    route(ax, [(158,64),(153,64)], color=TEAL, width=.8)
    route(ax, [(158,27),(153,27)], color=TEAL, width=.8)
    text(ax, 92, 78, "Same accepted state", color=TEAL)

    # Feedback is tied to the displayed slate, never to the candidate pool.
    route(ax, [(140,3),(140,1.4),(2.5,1.4),(2.5,61.8),(14.3,61.8)], color=WARM, width=.9)
    text(ax, 70, 5.4, "Feedback on displayed items", color=WARM)

    # Feedback interpretation and a bounded update preserve unrelated interests.
    box(ax, 6, 68, 45, 12, edge=WARM, fill=PALE_WARM, radius=1.7)
    ax.add_patch(Polygon([(12,68),(14,65.8),(16,68)], closed=True,
                         facecolor=PALE_WARM, edgecolor=WARM, linewidth=.7, zorder=3))
    text(ax, 28.5, 75.7, "Too advanced.", size=8.5, weight="bold")
    text(ax, 28.5, 71.8, "Start with basics.", size=8.5)
    text(ax, 28.5, 61.8, "Bounded Edit", color=WARM, weight="bold")
    route(ax, [(28.5,67.5),(28.5,64.2)], color=WARM)
    route(ax, [(28.5,59.6),(28.5,57)], color=WARM)

    box(ax, 6, 29, 45, 28, edge=TEAL, fill=PALE_TEAL, dashed=True, lw=.9)
    text(ax, 28.5, 53.3, "Shared, validated state", size=8.5, weight="bold", color=TEAL)
    box(ax, 10, 42, 37, 7.5, edge=WARM, fill="white", radius=.5)
    text(ax, 28.5, 45.7, "Task: beginner", size=8.5)
    box(ax, 10, 32.4, 37, 7.5, edge=TEAL, fill="white", radius=.5)
    text(ax, 28.5, 36.2, "Interest: photography", size=8)
    text(ax, 6, 23, "Model parameters frozen", ha="left", color=GRAY)
    route(ax, [(6,16.5),(12,16.5)], color=GRAY, dashed=True, arrow=False)
    text(ax, 14, 16.5, "Dashed outline: proposed", ha="left", color=GRAY)
    text(ax, 6, 11.3, "Reactions + exposure", ha="left", color=WARM)

    # One policy checks sufficiency and budget, then chooses an operation.
    route(ax, [(51,43),(62,43)], color=TEAL)
    box(ax, 62, 29.5, 55, 40.5, edge=BLUE, fill=PALE_BLUE, dashed=True, lw=.9)
    text(ax, 89.5, 66, "Check pool + budget", size=9.3, weight="bold", color=BLUE)
    route(ax, [(66,61.5),(113,61.5)], color=LINE, width=.6, arrow=False)
    text(ax, 89.5, 57.3, "Shortfall + budget", size=8.3, weight="bold")
    text(ax, 89.5, 53.4, "Acquire a bounded batch", size=8)
    text(ax, 89.5, 46, "Sufficient candidates", size=8.3, weight="bold")
    text(ax, 89.5, 42.1, "Rank the available pool", size=8)
    text(ax, 89.5, 35.5, "No justified update", size=8.3, weight="bold")
    text(ax, 89.5, 31.9, "Hold state + order", size=8)
    route(ax, [(117,55),(121,55),(121,64),(127,64)], color=BLUE)
    route(ax, [(117,43),(121,43),(121,27),(127,27)], color=BLUE)
    route(ax, [(125,49.7),(117,49.7)], color=GRAY, dashed=True, width=.65)
    text(ax, 121, 51.9, "status", color=GRAY, size=8)

    # Solid outlines mark existing component types, not validation of this proposal.
    text(ax, 140, 79.3, "Authorized sources", color=GRAY)
    doc(ax, 134, 71.8, 5, 5.5, color=BLUE)
    doc(ax, 141, 71.8, 5, 5.5, color=BLUE)
    route(ax, [(140,71.5),(140,68)], color=BLUE)
    box(ax, 127, 60, 26, 8, edge=BLUE, fill=PALE_BLUE)
    text(ax, 140, 64, "Acquire", size=9, weight="bold", color=BLUE)
    route(ax, [(140,60),(140,56)], color=BLUE)
    box(ax, 125, 39.5, 30, 16.5, edge=LINE, fill="white", radius=1.0)
    text(ax, 140, 52.4, "Candidate pool", size=8.2)
    for x, letter in zip((129,137,145), "ABC"):
        doc(ax, x, 41.3, 5.5, 7.2, color=BLUE, label=letter)
    route(ax, [(140,39.5),(140,31)], color=BLUE)
    box(ax, 127, 23, 26, 8, edge=TEAL, fill=PALE_TEAL)
    text(ax, 140, 27, "Rank", size=9, weight="bold", color=TEAL)
    route(ax, [(140,23),(140,20)], color=TEAL)
    box(ax, 125, 3, 30, 17, edge=TEAL, fill=PALE_TEAL, radius=1.0)
    text(ax, 140, 16.5, "Displayed", size=8.5, weight="bold", color=TEAL)
    for x, letter in zip((129,137,145), "CAB"):
        doc(ax, x, 5, 5.5, 7.2, color=TEAL, label=letter)
    return save(fig, ax, "architecture")


def round_glyphs(ax, start, y, letters, color, amended=False):
    state_glyph(ax, start+1, y-4, color=color, amended=amended)
    doc(ax, start+9, y-3.3, 5, 7, color=color, fill="white")
    doc(ax, start+8, y-4, 5, 7, color=color, fill="white")
    route(ax, [(start+14,y),(start+16,y)], color=color, width=.75)
    ax.add_patch(Circle((start+19,y), 2.7, facecolor="white", edgecolor=color, linewidth=.7, zorder=5))
    text(ax, start+19, y, "Act", size=8, color=color)
    route(ax, [(start+21.9,y),(start+24,y)], color=color, width=.75)
    for x, letter in zip((start+24, start+29.5), letters):
        doc(ax, x, y-4, 4.6, 8, color=color, label=letter)


def evaluation():
    fig, ax = canvas()
    # Two matched starts branch into separate, method-specific trajectories.
    text(ax, 5, 79, "Same history, sources,", ha="left", size=8.3, weight="bold")
    text(ax, 5, 74.5, "frozen model, tools, budget", ha="left", size=8.1)
    text(ax, 5, 70.1, "Same scoring backend", ha="left", size=8.1, color=GRAY)
    route(ax, [(35,67),(35,36)], color=GRAY, arrow=False, width=.8)
    route(ax, [(35,58),(42,58)], color=BLUE)
    route(ax, [(35,36),(42,36)], color=TEAL)
    text(ax, 5, 58, "Matched\nbaseline", ha="left", color=BLUE, size=8.7, weight="bold")
    text(ax, 5, 36, "Waterfall\ncontroller", ha="left", color=TEAL, size=8.7, weight="bold")

    # Only the scheduled instruction is shared; item reactions stay in their lane.
    text(ax, 112, 82, "Common release before Round 2", size=8, color=WARM)
    box(ax, 67, 71, 88, 9, edge=WARM, fill=PALE_WARM, radius=1.2)
    text(ax, 111, 75.5, "“Too advanced. Start with basics.”", size=9, color=INK)
    route(ax, [(79,71),(79,36)], color=WARM, width=.7, arrow=False, dashed=True, z=1)
    route(ax, [(79,58),(80,58)], color=WARM, width=.75)
    route(ax, [(79,36),(80,36)], color=WARM, width=.75)

    starts = (41,79,117)
    for i, x in enumerate(starts, 1):
        text(ax, x+17, 67.5, f"Round {i}", size=8.5, weight="bold")
        text(ax, x+7.5, 63.8, "state / pool", size=8, color=GRAY)
        text(ax, x+28.5, 63.8, "shown", size=8, color=GRAY)
    for y, color, slates in ((58,BLUE,("BC","DE","BF")),
                              (36,TEAL,("AC","BG","EH"))):
        for i, (start, slate) in enumerate(zip(starts, slates)):
            round_glyphs(ax, start, y, slate, color, amended=(i>0))
        for start, nxt in zip(starts, starts[1:]):
            route(ax, [(start+28,y-4),(start+28,y-8),(nxt+4,y-8),(nxt+4,y-4)],
                  color=WARM, width=.8)
            text(ax, start+28, y-10.2, "feedback", size=8, color=WARM)
        route(ax, [(151.1,y),(157,y)], color=GRAY, width=.7)
    text(ax, 5, 24.1, "Own pools; own slates", size=8, ha="left", color=GRAY)

    # The judge consumes outputs and logs; there is no reverse edge to either policy.
    route(ax, [(157,58),(157,22),(29,22),(29,19)], color=GRAY, width=.8)
    text(ax, 156, 24.3, "Slates + logs", size=8, color=GRAY, ha="right")
    box(ax, 4, 4.8, 50, 14.2, edge=GRAY, fill="white", radius=1.1)
    text(ax, 29, 15.7, "Independent usefulness judge", size=8.2, weight="bold")
    text(ax, 29, 11.4, "Method-blind · human audit", size=8)
    text(ax, 29, 7.4, "No labels return to policy", size=8, color=GRAY)
    route(ax, [(54,12),(59,12)], color=GRAY, width=.75)
    for x, heading, lines, color in (
        (74,"Useful distinct",("Deduplicated items","Ranking quality"),BLUE),
        (106,"Adaptation",("Recovery exposures","Unwanted edits"),TEAL),
        (140,"Cost",("Calls · tokens","Update latency"),INK)):
        text(ax, x, 16, heading, size=8.6, color=color, weight="bold")
        text(ax, x, 11.4, lines[0], size=8)
        text(ax, x, 7.5, lines[1], size=8)
    text(ax, 5, 1.8, "Protocol illustration; no measured outcomes", size=8, ha="left", color=GRAY)
    text(ax, 156, 1.8, "Generated feedback is simulated", size=8, ha="right", color=GRAY)
    return save(fig, ax, "evaluation")


if __name__ == "__main__":
    checks = {"architecture": architecture(), "evaluation": evaluation()}
    checks["renderer"] = {"matplotlib": matplotlib.__version__,
                          "script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    (OUT / "checks.json").write_text(json.dumps(checks, indent=2) + "\n")
    print(json.dumps(checks, indent=2))
