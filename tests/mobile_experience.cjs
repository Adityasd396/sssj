/* Native browser engines with mobile viewports; all data and device prompts synthetic. */
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const pw=require(process.env.PLAYWRIGHT_PATH||'playwright');const base='http://127.0.0.1:56837';
const output=path.resolve('.cache/mobile-experience');fs.mkdirSync(output,{recursive:true});
async function login(page){await page.goto(base+'/login');await page.locator('#username').fill('ui-owner');await page.locator('#password').fill('preview-password');await Promise.all([page.waitForURL(base+'/'),page.locator('.login-card [type=submit]').click()]);}
async function ready(page){await page.waitForFunction(()=>Boolean(window.MobileUI)&&Boolean(window.BillDraftStorage));}
async function pricing(page){await page.waitForFunction(()=>document.getElementById('pricing-status').textContent==='Bill total is up to date.');}
(async()=>{
 for(const engine of (process.env.MOBILE_ENGINE?[process.env.MOBILE_ENGINE]:['chromium','webkit'])){
  const browser=await pw[engine].launch({headless:true,...(engine==='chromium'&&process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  try{
   const context=await browser.newContext({...pw.devices[engine==='webkit'?'iPhone 13':'Pixel 5'],viewport:{width:390,height:844},deviceScaleFactor:1});
   let page=await context.newPage();const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message));
   await login(page);await page.goto(base+'/invoices/create');await ready(page);
   assert.equal(await page.locator('#billing-options').evaluate(d=>d.open),false);
   await page.locator('#client_id').selectOption('1');await page.locator('[data-bill-continue=items]').click();
   await page.waitForFunction(()=>document.getElementById('invoice-form').dataset.activeSection==='items');
   await page.locator('#product-code').fill('GOLD-01');await page.locator('#product-code').press('Enter');await page.waitForSelector('[name=product_code][value="GOLD-01"]',{state:'attached'});
   assert.equal(await page.locator('.item-more').evaluate(d=>d.open),false);
   await page.locator('[name=quantity]').fill('2');await page.locator('[data-bill-continue=payment]').click();await page.locator('#payment_type').selectOption('partial');await page.locator('#partial_amount').fill('5000');
   await page.locator('#billing-options>summary').click();await page.locator('#discount_type').selectOption('percent');await page.locator('#discount_value').fill('2');await pricing(page);
   await page.locator('#product-code').focus();
   await page.evaluate(()=>{window.realViewportHeight=visualViewport.height;Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>350});MobileUI.updateViewport();});
   assert(await page.locator('body').evaluate(body=>body.classList.contains('keyboard-open')));
   assert.equal(await page.locator('.checkout-dock').evaluate(el=>getComputedStyle(el).display),'none');
   assert.equal(await page.locator('.tabbar').evaluate(el=>getComputedStyle(el).display),'none');
   await page.locator('#keyboard-done').click();await page.evaluate(()=>{delete visualViewport.height;MobileUI.updateViewport();});
   await page.waitForFunction(()=>!document.body.classList.contains('keyboard-open'));
   await page.locator('#new-customer').click();await page.locator('#quick-name').fill('Interrupted customer');await page.locator('#quick-phone').fill('9555500017');
   await page.waitForFunction(()=>history.state&&history.state._shopDialog==='customer-dialog');
   await page.goBack();await page.waitForFunction(()=>!document.getElementById('customer-dialog').open);
   assert(page.url().endsWith('/invoices/create'));
   await page.locator('#nav-toggle').click();await page.waitForFunction(()=>history.state&&history.state._shopMenu);
   await page.goBack();await page.waitForFunction(()=>!document.getElementById('main-nav').classList.contains('open'));
   await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
   const key=await page.locator('[name=submission_key]').inputValue();
   assert(await page.evaluate(()=>JSON.parse(localStorage.getItem('billing-device-drafts-v2-1')).length>0));
   await page.close();page=await context.newPage();await page.goto(base+'/invoices/create');await page.waitForSelector('#draft-notice:not([hidden])');await page.locator('#restore-draft').click();
   assert.equal(await page.locator('[name=quantity]').inputValue(),'2');assert.equal(await page.locator('#partial_amount').inputValue(),'5000');assert.equal(await page.locator('#discount_value').inputValue(),'2');assert.equal(await page.locator('#quick-name').inputValue(),'Interrupted customer');assert.equal(await page.locator('[name=submission_key]').inputValue(),key);
   await pricing(page);const preview=await page.locator('#total').textContent();
   const duplicate=await context.newPage();await duplicate.goto(base+'/invoices/create');await duplicate.locator('#restore-draft').click();await pricing(duplicate);
   let writes=0;page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/invoices/create')writes++;});
   await page.locator('#invoice-form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});await page.waitForURL(/\/invoices\/\d+$/);const billUrl=page.url();
   assert.equal(writes,1);assert.match(await page.locator('.saved-confirmation').textContent(),/saved/i);assert.equal((await page.locator('.grand span').last().textContent()).replace(/[₹,]/g,''),preview.replace(/,/g,''));
   await duplicate.waitForFunction(()=>document.getElementById('invoice-form').dataset.completed==='true');assert(await duplicate.locator('#dock-save-bill').isDisabled());assert.equal(await duplicate.locator('#draft-state a').getAttribute('href'),new URL(billUrl).pathname);await duplicate.close();
   assert.equal(await page.evaluate(()=>sessionStorage.getItem('billing-draft-v1-1')),null);
   await page.goto(base+'/invoices/create');assert(await page.locator('#draft-notice').isHidden());
   for(const width of [320,390,768,1024]){await page.setViewportSize({width,height:900});const layout=await page.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth,bad:Array.from(document.querySelectorAll('main *')).filter(el=>el.getBoundingClientRect().right>innerWidth+2).slice(0,12).map(el=>({tag:el.tagName,id:el.id,cls:el.className,right:el.getBoundingClientRect().right}))}));assert(layout.page<=layout.viewport+1,engine+' '+width+' '+JSON.stringify(layout));}
   await page.setViewportSize({width:390,height:844});await page.goto(base+'/products?q=2.125g');await page.evaluate(()=>scrollTo(0,300));await page.locator('.stock-record td:first-child a').first().click();
   const saved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('shop-list-positions-1'))['/products']);
   assert((await page.locator('[data-record-back="/products"]').getAttribute('href')).includes('q=2.125g'));
   await page.locator('[data-record-back="/products"]').click();await page.waitForFunction(y=>Math.abs(scrollY-y)<5,saved.y);assert(page.url().includes('q=2.125g'));
   await page.evaluate(()=>{document.activeElement.blur();scrollTo(0,0);});await page.screenshot({path:path.join(output,engine+'-inventory.png'),fullPage:true});
   await page.goto(base+'/invoices/create');await page.locator('#client_id').selectOption('1');await page.locator('#product-code').fill('GOLD-01');await page.locator('#product-code').press('Enter');await page.waitForSelector('[name=product_code][value="GOLD-01"]',{state:'attached'});await pricing(page);
   await page.evaluate(()=>{document.activeElement.blur();scrollTo(0,0);});await page.screenshot({path:path.join(output,engine+'-billing.png'),fullPage:true});
   await page.locator('#nav-toggle').click();await page.locator('.nav-logout').click();await page.waitForURL(base+'/login');assert.equal(await page.evaluate(()=>localStorage.getItem('billing-device-drafts-v2-1')),null);
   assert.deepEqual(errors,[]);
   await login(page);await page.goto(base+'/printers');await page.locator('#preferred-receipt-width').selectOption('58');await page.locator('a[href*="printer-test.html"]').click();
   assert.equal(await page.locator('[data-receipt-preference]').inputValue(),'58');
   await page.goto(billUrl.replace(/$/, '/receipt'));await page.waitForURL(/width=58/);assert.equal(await page.locator('#receipt-width').inputValue(),'58');
   await page.goto(billUrl+'/receipt?width=80');assert.equal(await page.locator('#receipt-width').inputValue(),'80');

   // Private/blocked device storage must degrade to a recoverable tab draft.
   const limited=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await limited.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Blocked','SecurityError');},configurable:true}));
   const lp=await limited.newPage();const blockedErrors=[];lp.on('pageerror',e=>blockedErrors.push(e.message));await login(lp);await lp.goto(base+'/invoices/create');await lp.locator('#client_id').selectOption('1');await lp.waitForFunction(()=>document.getElementById('draft-state').textContent.includes('this tab'));await lp.reload();await lp.locator('#restore-draft').click();assert.equal(await lp.locator('#client_id').inputValue(),'1');assert.deepEqual(blockedErrors,[]);await limited.close();
   await context.close();console.log('PASS '+engine+': guided bill, compact items, keyboard clearance, Android-style Back, tab-loss recovery, one save, completed-draft protection, filtered Back, logout privacy and blocked-storage fallback.');
  }finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exit(1)});

