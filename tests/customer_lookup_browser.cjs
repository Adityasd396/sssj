/* Bounded search and draft recovery beyond the initial customer page. Synthetic shop only. */
const assert=require('node:assert/strict');
const pw=require(process.env.PLAYWRIGHT_PATH||'playwright');
const base='http://127.0.0.1:56837';
async function login(page){await page.goto(base+'/login');await page.locator('#username').fill('ui-owner');await page.locator('#password').fill('preview-password');await Promise.all([page.waitForURL(base+'/'),page.locator('.login-card [type=submit]').click()]);}
(async()=>{
 for(const engine of ['chromium','webkit']){
  const browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{executablePath:process.env.CHROME_PATH}:{})});
  try{
   const context=await browser.newContext({...pw.devices[engine==='webkit'?'iPhone 13':'Pixel 5']});let page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await login(page);
   if(engine==='chromium'){
    const session=await (await context.request.get(base+'/api/session')).json();
    for(let i=0;i<52;i++){const response=await context.request.post(base+'/clients/add',{form:{csrf_token:session.csrf_token,name:'AAA lookup '+String(i).padStart(2,'0'),phone:'81000000'+String(i).padStart(2,'0')}});assert.equal(response.status(),200);}
   }
   await page.goto(base+'/invoices/create');assert(await page.locator('#client_id option').count()<=51);assert.equal(await page.locator('#client_id option[value="1"]').count(),0);
   await page.locator('#client-search').fill('Meera');await page.waitForSelector('#client_id option[value="1"]',{state:'attached'});await page.locator('#client-search').press('Enter');assert.equal(await page.locator('#client_id').inputValue(),'1');
   await page.waitForFunction(()=>{const rows=JSON.parse(localStorage.getItem('billing-device-drafts-v2-1')||'[]');return rows.some(r=>r.data.fields.client_id==='1');});await page.close();
   page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/invoices/create');assert.equal(await page.locator('#client_id option[value="1"]').count(),0);await page.locator('#restore-draft').click();await page.waitForFunction(()=>document.getElementById('client_id').value==='1'&&!document.getElementById('invoice-form').inert);
   assert.equal(await page.locator('#client_gstin').inputValue(),'27ABCDE1234F1Z5');
   await page.goto(base+'/tags');await page.locator('#tag-product-search').fill('Classic');await page.locator('#tag-product-search').press('Enter');await page.waitForURL(/q=Classic/);assert(await page.locator('.pcheck').count()<=50);
   for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Tag search overflow at '+width);}
   assert.deepEqual(errors,[]);await context.close();console.log('PASS '+engine+': bounded remote customer search, Enter selection, recovery of a customer outside the initial list, current GSTIN and responsive tag search.');
  }finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exit(1);});
