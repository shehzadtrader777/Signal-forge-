import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:3000';
for(let attempt=0;;attempt++){
  try { const r = await fetch(base+'/api/health',{signal:AbortSignal.timeout(2000)}); if(r.ok) break; }
  catch {}
  if(attempt>=60) throw new Error('Offline application did not start');
  await new Promise(r=>setTimeout(r,500));
}
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
let passed=0;
try {
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
    const context=await browser.newContext({viewport,serviceWorkers:'block',reducedMotion:'reduce'});
    const errors=[];
    // Network namespace has no external network; additionally refuse all external browser requests.
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const page=await context.newPage();
    page.on('pageerror',()=>errors.push('uncaught browser exception'));
    page.on('console',m=>{if(m.type()==='error'&&/\[ErrorBoundary\]|maximum update depth|too many re-renders|minified react error/i.test(m.text()))errors.push('React rendering error');});
    async function healthy(){
      assert.equal(await page.getByText('Dashboard View Recovery',{exact:true}).count(),0);
      assert.equal(await page.getByText(/UNRESOLVED_STARTUP_PROFILE/).count(),0);
      assert.equal(errors.length,0,errors.join('; '));
    }
    async function check(name,fn){await fn();await healthy();passed++;console.log('PASS browser:',viewport.width,name);}
    await check('public homepage',async()=>{
      await page.goto(base+'/',{waitUntil:'domcontentloaded'});
      await page.getByTestId('public-home-page').waitFor({state:'visible',timeout:30000});
      await page.getByRole('heading',{level:1}).first().waitFor({state:'visible'});
    });
    await check('login navigation',async()=>{
      await page.getByTestId('public-login-cta').click();
      await page.getByRole('heading',{name:'Sign In to Signal Forge'}).waitFor({timeout:30000});
      assert.equal(new URL(page.url()).pathname,'/login');
    });
    await check('guest protected console redirect',async()=>{
      await page.goto(base+'/test-console',{waitUntil:'domcontentloaded'});
      await page.waitForURL(base+'/',{timeout:30000});
      await page.getByTestId('public-home-page').waitFor({timeout:30000});
    });
    await check('pricing route',async()=>{
      await page.goto(base+'/pricing',{waitUntil:'domcontentloaded'});
      await page.getByRole('heading',{name:'A workspace that grows with you.'}).waitFor({timeout:30000});
    });
    await check('unknown route recovery',async()=>{
      await page.goto(base+'/offline-browser-test-unknown',{waitUntil:'domcontentloaded'});
      await page.waitForURL(base+'/',{timeout:30000});
      await page.getByTestId('public-home-page').waitFor({timeout:30000});
    });
    await context.close();
  }
  console.log('BROWSER_SMOKE_VERIFIED_CHECKS='+passed);
}finally{await browser.close();}
