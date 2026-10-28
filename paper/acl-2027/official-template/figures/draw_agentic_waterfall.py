#!/usr/bin/env python3
"""Draw conceptual figures for the Agentic Waterfall research draft."""
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

OUT = Path(__file__).resolve().parent
matplotlib.rcParams.update({'font.family':'sans-serif','font.sans-serif':['Arial','DejaVu Sans'],
                           'font.size':8,'pdf.fonttype':42,'svg.fonttype':'none','savefig.dpi':300})
INK='#20333E'; BLUE='#0077BB'; TEAL='#008477'; ORANGE='#B95A24'; GRAY='#53636E'

def canvas(height):
    fig = plt.figure(figsize=(160/25.4,height/25.4), facecolor='white')
    ax = fig.add_axes([0,0,1,1],xlim=(0,160),ylim=(0,height)); ax.set_axis_off()
    return fig,ax

def box(ax,x,y,w,h,title,body='',color=BLUE,fill='#EFF6FA'):
    ax.add_patch(FancyBboxPatch((x,y),w,h,boxstyle='round,pad=0,rounding_size=1.3',
                              linewidth=.8,edgecolor=color,facecolor=fill))
    ax.text(x+w/2,y+h/2+(2.3 if body else 0),title,ha='center',va='center',fontsize=8.4,
            fontweight='bold',color=color)
    if body: ax.text(x+w/2,y+h/2-2.8,body,ha='center',va='center',fontsize=8,color=INK,linespacing=1.25)

def arrow(ax,points,color=GRAY,dashed=False):
    for start,end in zip(points[:-2],points[1:-1]):
        ax.plot([start[0],end[0]],[start[1],end[1]],color=color,linewidth=.8,linestyle='--' if dashed else '-')
    ax.add_patch(FancyArrowPatch(points[-2],points[-1],arrowstyle='-|>',mutation_scale=7,
                   linewidth=.8,linestyle='--' if dashed else '-',color=color))

def save(fig,name):
    for ext in ('pdf','svg','png'): fig.savefig(OUT/f'{name}.{ext}',facecolor='white',dpi=300)
    plt.close(fig)

# The labels describe a proposed interface, not measured system behavior.
f,a=canvas(83)
a.text(3,79,'USER INFORMATION',color=GRAY,weight='bold',fontsize=8,va='center')
a.text(58,79,'AGENT AND EXECUTOR',color=GRAY,weight='bold',fontsize=8,va='center')
a.text(120,79,'INTERACTION',color=GRAY,weight='bold',fontsize=8,va='center')
box(a,3,61,42,13,'Language','requests, corrections',ORANGE,'#FFF4EB')
box(a,3,44,42,13,'Observed behavior','exposures, clicks, saves',ORANGE,'#FFF4EB')
box(a,3,27,42,13,'Authorized memory','profile, tasks, evidence',ORANGE,'#FFF4EB')
box(a,57,47,48,23,'Waterfall agent','decide and validate\nstructured actions',BLUE,'#EFF6FA')
box(a,57,15,48,23,'Action executor','update  •  acquire  •  recommend\nrespond  •  wait / stop',TEAL,'#EFF8F6')
box(a,117,51,40,18,'Content environment','sources and candidates',BLUE,'#EFF6FA')
box(a,117,21,40,18,'Feed and user','delivery → exposure\n→ response',TEAL,'#EFF8F6')
for y in (67.5,50.5,33.5): arrow(a,[(45,y),(51,y),(51,58.5),(57,58.5)],ORANGE)
arrow(a,[(81,47),(81,38)],BLUE)
arrow(a,[(105,26.5),(117,26.5)],TEAL)
arrow(a,[(105,34),(112,34),(112,60),(117,60)],TEAL)
arrow(a,[(117,65),(111,65),(111,73),(81,73),(81,70)],BLUE)
arrow(a,[(117,22),(110,22),(110,5),(1,5),(1,50.5),(3,50.5)],ORANGE)
a.text(74,8,'new observations feed the next decision',color=ORANGE,fontsize=8,ha='center',va='center')
save(f,'agentic-waterfall-loop')

f,a=canvas(75)
a.text(3,71,'A  NEXT-ITEM CHOICE',color=BLUE,weight='bold',fontsize=9,va='center')
a.text(3,35,'B  CONTINUOUS USE',color=TEAL,weight='bold',fontsize=9,va='center')
box(a,3,48,33,16,'Shared prefix','same known history',GRAY,'#F7F9FA')
box(a,46,48,30,16,'System A / B','own next item',BLUE,'#EFF6FA')
box(a,87,48,34,16,'Blind pair','randomized sides',BLUE,'#EFF6FA')
box(a,130,48,27,16,'Human choice','A / B / both / neither',ORANGE,'#FFF4EB')
arrow(a,[(36,56),(46,56)]); arrow(a,[(76,56),(87,56)]); arrow(a,[(121,56),(130,56)])
box(a,3,11,33,16,'Matched start','balanced order',GRAY,'#F7F9FA')
box(a,46,11,38,16,'Separate sessions','own exposure + feedback',TEAL,'#EFF8F6')
box(a,96,11,61,16,'Choose a feed for next time','A / B / either / neither',ORANGE,'#FFF4EB')
arrow(a,[(36,19),(46,19)]); arrow(a,[(84,19),(96,19)])
a.text(80,2,'Conceptual protocol; choices and session outcomes are collected separately.',fontsize=8,color=GRAY,ha='center',va='bottom')
save(f,'agentic-waterfall-evaluation')
