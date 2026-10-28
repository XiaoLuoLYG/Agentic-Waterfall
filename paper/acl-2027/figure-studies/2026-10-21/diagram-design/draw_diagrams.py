from pathlib import Path
from html import escape

OUT=Path(__file__).resolve().parent
INK='#25374D'; MUTED='#536A80'; BLUE='#315D83'; PALE='#F0F5F9'; RULE='#B7C5D1'; WARM='#A5522A'; TINT='#FCF1E9'
FONT="'Geist',Arial,sans-serif"

def text(x,y,s,size=14,weight=400,color=INK,anchor='start'):
 return f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}">{escape(s)}</text>'
def rect(x,y,w,h,fill='white',stroke=RULE,dash=False,r=6):
 return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="1.2"'+(' stroke-dasharray="5 4"' if dash else '')+'/>'
def line(d,color=MUTED,dash=False,arrow=True,width=1.5):
 return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round"'+(' stroke-dasharray="5 4"' if dash else '')+(' marker-end="url(#arrow)"' if arrow else '')+'/>'
def card(x,y,label,fill=PALE):
 return rect(x,y,24,28,fill,BLUE,r=2)+text(x+12,y+19,label,14,500,BLUE,'middle')
def label(x,y,w,s):
 return rect(x,y,w,24,'white','none',r=2)+text(x+w/2,y+17,s,14,500,MUTED,'middle')
def save(slug,title,desc,body,height):
 template=(Path('/Users/luoyige/.codex/skills/diagram-design/assets/template.html')).read_text()
 # The approved project palette is scoped to these deliverables; shared skill defaults stay untouched.
 css=f'''*{{box-sizing:border-box}}body{{margin:0;padding:32px;background:white;color:{INK};font-family:{FONT}}}.frame{{max-width:900px;margin:auto;min-width:0}}h1{{font-family:'Instrument Serif',serif;font-weight:400;font-size:28px;margin:0 0 16px}}.eyebrow{{font-size:12px;color:{MUTED};margin:0 0 8px}}.diagram-container{{width:100%;overflow-x:auto}}svg{{display:block;width:100%;min-width:784px}}@media print{{.diagram-container{{overflow-x:visible}}svg{{min-width:0}}}}'''
 fonts='https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&amp;family=Geist+Mono:wght@400;500&amp;family=Instrument+Serif:ital@0;1&amp;display=swap'
 svg=f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 784 {height}" role="img" aria-labelledby="{slug}-title {slug}-desc"><title id="{slug}-title">{title}</title><desc id="{slug}-desc">{desc}</desc><defs><marker id="arrow" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0 0L6 3L0 6Z" fill="{MUTED}"/></marker></defs><rect width="784" height="{height}" fill="white"/>{body}</svg>'''
 html=f'''<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title><link rel="stylesheet" href="{fonts}"><style>{css}</style></head><body><main class="frame"><p class="eyebrow">DIAGRAM DESIGN · WATERFALL · PROPOSED DESIGN</p><h1>{title}</h1><div class="diagram-container">{svg}</div></main></body></html>'''
 (OUT/(slug+'.html')).write_text(html)

# Architecture: seven semantic nodes. State revision r is named at both readers.
b=''
b+=line('M204 108H260')
b+=line('M372 164V216')
b+=line('M484 248H516Q524 248 524 240V76Q524 68 532 68H576')
b+=line('M484 280H540Q548 280 548 272V268Q548 260 556 260H576')
b+=line('M660 96V136')+line('M660 200V232')+line('M660 288V328')
# Less-important pool-status return bridges the outgoing acquire-control path.
b+=line('M532 196a8 8 0 0 0 -16 0','white',False,False,7)
b+=line('M576 164H560Q552 164 552 172V188Q552 196 544 196H532a8 8 0 0 0 -16 0H448Q440 196 440 204V216',dash=True)
b+=line('M744 356H756Q764 356 764 364V400Q764 408 756 408H128Q120 408 120 400V164',dash=True)
b+=label(208,76,48,'EDIT')+label(388,164,112,'POOL STATUS')+label(304,376,144,'SHOWN ITEMS')
# Component frames and internal visual records.
b+=rect(40,52,164,112,PALE,MUTED)
b+=text(56,78,'User evidence',16,600)+text(56,114,'“Start with basics.”')+text(56,142,'Reactions · exposure')
b+=rect(260,52,224,112,TINT,WARM,True)
b+=text(280,78,'Shared state r',16,600,WARM)
b+=line('M280 92H464',RULE,False,False,1)
b+=text(280,114,'Task: beginner')+text(280,142,'Interest: photography')
b+=rect(260,216,224,128,TINT,WARM,True)
b+=text(280,242,'Choose next action',16,600,WARM)
b+=text(280,266,'Check pool + budget',14,500)
b+=text(280,290,'Sufficient → Rank')+text(280,312,'Shortfall → Acquire')+text(280,334,'No update → Hold')
b+=rect(576,40,168,56,PALE,BLUE)+text(592,64,'Acquire',16,600,BLUE)+text(592,84,'state r · sources')
b+=rect(576,136,168,64,'white',BLUE)+text(592,158,'Candidate pool',16,600,BLUE)
for i,v in enumerate('ABC'): b+=card(600+40*i,164,v)
b+=rect(576,232,168,56,PALE,BLUE)+text(592,256,'Rank',16,600,BLUE)+text(592,276,'uses the same state r')
b+=rect(576,328,168,64,'white',BLUE)+text(592,350,'Displayed slate',16,600,BLUE)
for i,v in enumerate('CAB'): b+=card(600+40*i,356,v)
b+=line('M40 432H744',RULE,False,False,1)+text(40,452,'Dashed boxes: proposed modules',14)+text(744,452,'Model parameters stay frozen',14,400,MUTED,'end')
save('architecture','Shared state, coordinated actions','Proposed bounded state edits coordinate acquisition and ranking, with feedback only from displayed items.',b,464)

# Evaluation: two independent trajectories; an instruction is released at the same step.
b=rect(40,40,704,40,PALE,'none')+text(56,66,'Matched start: history · sources · model · budget',16,500)
b+=rect(400,92,152,224,TINT,'none',r=6)
b+=text(476,112,'“Start with basics.”',14,500,WARM,'middle')
for x,s in [(292,'Round 1'),(476,'Round 2'),(660,'Round 3 …')]: b+=text(x,140,s,16,600,INK,'middle')
b+=rect(40,156,704,64,'#F4F7FA','none')+rect(40,248,704,64,'#F4F7FA','none')
for y in [188,280]:
 b+=line(f'M360 {y}H408')+line(f'M544 {y}H592')
# The two assessments remain separate routes, with distinct entry ports.
b+=line('M728 188H752Q760 188 760 196V332Q760 340 752 340H708Q700 340 700 348V360')
b+=line('M728 280H728Q736 280 736 288V324Q736 332 728 332H684Q676 332 676 340V360')
b+=text(56,184,'Matched',16,600)+text(56,205,'baseline',16,600)
b+=text(56,278,'Waterfall',16,600,BLUE)+text(56,299,'controller',16,600,BLUE)
for row,y in enumerate([156,248]):
 for j,x in enumerate([224,408,592]):
  b+=rect(x,y,136,64,'white',BLUE)
  b+=text(x+12,y+22,'State → action',14,500)
  # Miniature displayed cards are item IDs, not grades or measured outcomes.
  ids=(['AB','CD','BE'] if row==0 else ['AC','BH','DF'])[j]
  b+=text(x+12,y+50,'Shown',14,400,MUTED)
  for k,v in enumerate(ids): b+=card(x+72+k*28,y+32,v)
b+=text(40,338,'Within each lane: feedback on shown items updates the next state.',14,400,MUTED)
b+=rect(40,360,704,64,PALE,BLUE)
b+=text(56,386,'Independent assessment',16,600,BLUE)+text(330,386,'Method-blind judge + human audit',14)
b+=text(56,410,'Useful distinct items · adaptation after correction · calls / tokens / latency',14)
b+=text(40,450,'No assessment labels return to the policy.',14,400,MUTED)
b+=text(744,450,'Illustration; no results.',14,400,MUTED,'end')
save('evaluation','Matched conditions, independent trajectories','A shared initial setup and same-step correction support independent trajectories and method-blind assessment without returning judge labels to either policy.',b,464)
print('Wrote two diagram-design HTML source files')
