/* Inventory and bill-rate UI checks on synthetic data only. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const pw=require(process.env.PLAYWRIGHT_PATH||'playwright'),base='http://127.0.0.1:56837';
const output=path.resolve('.cache/inventory-rates-browser');fs.mkdirSync(output,{recursive:true});
async function login(page){await page.goto(base+'/login');await page.locator('#username').fill('ui-owner');await page.locator('#password').fill('preview-password');await Promise.all([page.waitForURL(base+'/'),page.locator('.login-card [type=submit]').click()]);}
async function pricing(page){await page.waitForFunction(()=>document.getElementById('pricing-status').textContent==='Bill total is up to date.');}
(async()=>{
 for(const engine of ['chromium','webkit']){
  const browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{executablePath:process.env.CHROME_PATH}:{})});
  try{
   const context=await browser.newContext({...pw.devices[engine==='webkit'?'iPhone 13':'Pixel 5'],viewport:{width:390,height:844},deviceScaleFactor:1});let page=await context.newPage();let errors=[];page.on('pageerror',e=>errors.push(e.message));await login(page);
   await page.goto(base+'/products/add');assert(await page.locator('#cat-list option[value="Rings"]').count());
   if(engine==='chromium'&&!(await (await context.request.get(base+'/products?q=Browser+Empty')).text()).includes('Browser Empty gold')){
    const session=await (await context.request.get(base+'/api/session')).json();
    for(const metal of ['gold','silver']){let r=await context.request.post(base+'/products/add',{form:{csrf_token:session.csrf_token,name:'Browser Empty '+metal,item_type:metal,unit:'pcs',weight_per_unit:'2.125',stock_quantity:'0',category:'Browser category'}});assert.equal(r.status(),200);}
   }
   await page.goto(base+'/products?stock=out');assert(await page.locator('tr.stock-record').count()>=2);assert(await page.locator('tr.stock-record .badge-cancelled').count()>=2);
   await page.locator('.inventory-totals>summary').click();const summary=await page.locator('#inventory-summary').innerText();assert.match(summary,/Gold products/);assert.match(summary,/Silver products/);
   await page.goto(base+'/products?q=Browser+Empty&code=generated&sort=generated_first');assert.equal(await page.locator('tr.stock-record').count(),2);await page.locator('.inventory-totals>summary').click();assert.equal(await page.locator('#inventory-summary').innerText(),summary);assert.match(await page.locator('body').innerText(),/Scan history is not recorded/);
   await page.goto(base+'/products/add');assert.equal(await page.locator('#cat-list option[value="Browser category"]').count(),1);
   await page.goto(base+'/products?stock=out&code=generated');
   for(const width of [320,390,768,1024]){await page.setViewportSize({width,height:844});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Inventory overflow '+width);}
   await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(output,engine+'-inventory.png'),fullPage:true});
   const masterBefore=await (await context.request.get(base+'/api/prices')).json();
   await page.goto(base+'/invoices/create');await page.locator('#client_id').selectOption('1');await page.locator('[data-bill-continue=items]').click();await page.locator('#bill-rates>summary').click();await page.locator('#bill_gold_rate').fill('7000.25');await page.locator('#bill_silver_rate').fill('90.50');await page.locator('#product-code').fill('GOLD-01');await page.locator('#product-code').press('Enter');await page.waitForSelector('[name=product_code][value="GOLD-01"]',{state:'attached'});await pricing(page);
   await page.locator('#product-code').fill('SILVER-01');await page.locator('#product-code').press('Enter');await page.waitForSelector('[name=product_code][value="SILVER-01"]',{state:'attached'});await page.locator('.item-row').last().locator('[name=quantity]').fill('2.375');await pricing(page);
   const displayed=await page.locator('#total').textContent();assert.match((await page.locator('.rate-hint').first().textContent()).replace(/,/g,''),/7000.25/);
   await page.waitForFunction(()=>{let rows=JSON.parse(localStorage.getItem('billing-device-drafts-v2-1')||'[]');return rows.some(r=>r.data.fields.bill_gold_rate==='7000.25'&&r.data.fields.bill_silver_rate==='90.50');});await page.close();page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/invoices/create');await page.locator('#restore-draft').click();await page.waitForFunction(()=>document.getElementById('bill_gold_rate').value==='7000.25');await pricing(page);assert.equal(await page.locator('#total').textContent(),displayed);assert.equal(Number(await page.locator('#bill_silver_rate').inputValue()),90.5);
   for(const width of [320,390,768,1024]){await page.setViewportSize({width,height:844});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Bill overflow '+width);}
   await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.activeElement.blur();scrollTo(0,0);});await page.screenshot({path:path.join(output,engine+'-bill.png'),fullPage:true});
   await page.locator('#invoice-form').evaluate(f=>f.requestSubmit());await page.waitForURL(/\/invoices\/\d+$/);assert.equal((await page.locator('.grand span').last().textContent()).replace(/[₹,]/g,''),displayed.replace(/,/g,''));assert.match(await page.locator('body').innerText(),/7,?000\.25/);
   const masterAfter=await (await context.request.get(base+'/api/prices')).json();assert.equal(masterAfter.gold,masterBefore.gold);assert.equal(masterAfter.silver,masterBefore.silver);assert.deepEqual(errors,[]);
   await context.close();console.log('PASS '+engine+': zero stock, global metal summaries, saved categories, QR code-style filter, responsive tables/rate fields, rate draft recovery, preview/save agreement and unchanged master rates.');
  }finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exit(1)});
