from pathlib import Path
import json,subprocess
from playwright.sync_api import sync_playwright
out=Path(__file__).resolve().parent
reports=[]
with sync_playwright() as p:
 browser=p.chromium.launch()
 page=browser.new_page(viewport={'width':1000,'height':900},device_scale_factor=3)
 for name in ['architecture','evaluation']:
  source=out/(name+'.html')
  page.goto(source.as_uri(),wait_until='networkidle',timeout=30000)
  page.evaluate('document.fonts.ready')
  svg=page.locator('svg')
  svg.evaluate("e=>{e.style.width='784px';for(let p=e.parentElement;p;p=p.parentElement)p.style.overflow='visible'}")
  svg.screenshot(path=str(out/(name+'.png')))
  geometry=page.evaluate('''() => {const s=document.querySelector('svg'),v=s.viewBox.baseVal;return Array.from(s.querySelectorAll('text')).flatMap(t=>{let b=t.getBBox();return b.x<0||b.y<0||b.x+b.width>v.width||b.y+b.height>v.height?[t.textContent]:[]})}''')
  fonts=page.evaluate("({geist:document.fonts.check('14px Geist'),serif:document.fonts.check('28px \"Instrument Serif\"')})")
  reports.append({'file':name,'outside_viewbox':geometry,'fonts_loaded':fonts,'width_mm':160,'minimum_text_pt':14*160/25.4*72/784})
 browser.close()
(out/'render-checks.json').write_text(json.dumps(reports,indent=2))
print(json.dumps(reports))
