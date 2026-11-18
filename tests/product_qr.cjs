const assert = require('node:assert/strict');
const fs = require('node:fs');
// Run against the isolated tests/serve_preview.py shop after make_scanner_fixtures.py.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
(async () => {
 const browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_PATH});
 try {
 const page = await browser.newPage();
 const errors=[]; page.on('pageerror', e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:56837/login');
 await page.locator('[name=username]').fill('ui-owner');
 await page.locator('[name=password]').fill('preview-password');
 await Promise.all([page.waitForURL('http://127.0.0.1:56837/'),page.locator('[type=submit]').click()]);
 await page.goto('http://127.0.0.1:56837/products/add');
 await page.locator('#name').fill('Existing QR ring');
 await page.locator('#weight_per_unit').fill('2');
 await page.locator('#stock_quantity').fill('4');
 await page.locator('#existing-qr-upload').setInputFiles('.cache/product-existing-qr.png');
 await page.waitForFunction(()=>document.querySelector('#existing_code').value==='SUPPLIER-NEW-104');
 assert.equal(await page.locator('#existing-qr-upload').inputValue(),'');
 assert(await page.evaluate(()=>!Array.from(new FormData(document.getElementById('product-form')).values()).some(value=>value instanceof File)));
 await Promise.all([page.waitForURL('**/products'),page.locator('#product-form [type=submit]').click()]);
 const data=await page.evaluate(async()=>await (await fetch('/products/scan/SUPPLIER-NEW-104')).json());
 assert.equal(data.product.name,'Existing QR ring');
 for(const width of [320,390,768,1024,1440]) {
 await page.setViewportSize({width,height:1000});
 for(const url of ['/products','/products/add']) {
 await page.goto('http://127.0.0.1:56837'+url);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),url+' overflow '+width);
 }
 }
 await page.locator('#existing-qr-upload').setInputFiles({name:'invalid.png',mimeType:'image/png',buffer:Buffer.from('not an image')});
 await page.waitForFunction(()=>document.querySelector('#existing-qr-status').classList.contains('error'));
 assert(await page.locator('#product-form [type=submit]').isDisabled());
 await page.locator('#clear-existing-qr').click();
 assert(await page.locator('#product-form [type=submit]').isEnabled());
 await page.evaluate(async imageData=>{
  const img=new Image();img.src=imageData;await img.decode();
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
  const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,640,480);ctx.drawImage(img,170,90,300,300);
  navigator.mediaDevices.getUserMedia=async()=>{const stream=canvas.captureStream(5);window.productCameraTracks=stream.getTracks();
  const track=stream.getVideoTracks()[0];const caps=track.getCapabilities();window.productCameraMaxWidth=caps.width.max;
  const apply=track.applyConstraints.bind(track);track.applyConstraints=async constraints=>{if(constraints.width)window.productCameraRequestedWidth=constraints.width.ideal;return apply(constraints);};
  setTimeout(()=>ctx.drawImage(img,170,90,300,300),100);return stream;};
 },'data:image/png;base64,'+fs.readFileSync('.cache/product-existing-qr.png').toString('base64'));
 await page.locator('#existing-qr-take-photo').click();
 await page.waitForFunction(()=>document.getElementById('existing_code').value==='SUPPLIER-NEW-104');
 assert.equal(await page.locator('#product-qr-camera').evaluate(d=>d.open),false);
 assert(await page.evaluate(()=>window.productCameraRequestedWidth===window.productCameraMaxWidth));
 assert(await page.evaluate(()=>window.productCameraTracks.every(t=>t.readyState==='ended')));
 assert(await page.evaluate(()=>!Array.from(new FormData(document.getElementById('product-form')).values()).some(value=>value instanceof File)));
 assert.equal(await page.locator('#existing-qr-upload').inputValue(),'');
 assert.equal(await page.locator('#existing-qr-capture').inputValue(),'');
 assert.match(await page.locator('#existing-qr-status').textContent(),/Only its code is saved/i);
 await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');};});
 await page.locator('#existing-qr-take-photo').click();
 await page.waitForFunction(()=>document.getElementById('product-camera-status').textContent.includes('permission was denied'));
 await page.locator('#product-camera-close').click();
 assert.deepEqual(errors,[]);
 console.log('QR upload and automatic camera scanning, local image disposal, camera cleanup/denial, saved-code lookup and 10 responsive checks passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
