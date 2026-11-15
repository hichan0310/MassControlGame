"""실제 브라우저(Playwright + Chrome)로 화면을 찍는다. 시각 점검용.
사용: python3 tools/sim/screenshot.py [출력.png] [진화키...]
예:   python3 tools/sim/screenshot.py shot.png chain+aura orbit+fire
필요: pip install playwright && playwright install chromium
"""
import asyncio,sys,os
from playwright.async_api import async_playwright
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','..'))
OUT=sys.argv[1] if len(sys.argv)>1 else 'shot.png'
KEYS=sys.argv[2:]
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        pg=await b.new_page(viewport={'width':1200,'height':750})
        errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto('file://'+os.path.join(ROOT,'index.html'));await pg.wait_for_timeout(400)
        await pg.keyboard.press('Enter');await pg.wait_for_timeout(300)
        await pg.evaluate("""(ks)=>{const M=window.__mass;const MX={chain:5,shrap:5,hole:4,orbit:4,aura:5,fire:5,missile:5,mine:5};
          for(const k of ks){const [a,b]=k.split('+');M.U[a]=MX[a];M.U[b]=MX[b];M.U.evos[k]=true;}M.U.hpMul=1e6;
          const P=M.P;for(let i=0;i<70;i++){const e=M.mkEnemy(i%5?'chaser':'charger',P.x+Math.cos(i)*(200+i*6),P.y+Math.sin(i)*(200+i*6));e.spawn=0;e.hp=e.max=1e5;M.enemies.push(e);}}""",KEYS)
        for k in ['KeyD','KeyL']: await pg.keyboard.down(k)
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=OUT)
        print('saved',OUT,'errors:',errs)
        await b.close()
asyncio.run(main())
