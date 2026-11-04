/* Camera lifecycle tests use virtual streams only, never the user's physical camera. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = 'http://127.0.0.1:' + (process.env.BILLING_PREVIEW_PORT || '56837');
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_PATH,
    args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  try {
    const context = await browser.newContext({permissions:['camera']});
    const page = await context.newPage();
    await page.goto(base+'/login');
    await page.locator('[name=username]').fill('ui-owner');
    await page.locator('[name=password]').fill('preview-password');
    await Promise.all([page.waitForURL(base+'/'),page.locator('button[type=submit]').click()]);
    await page.evaluate(() => {
      const actual = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.testCameraTracks = [];
      navigator.mediaDevices.getUserMedia = async options => {
        const stream = await actual(options); window.testCameraTracks.push(...stream.getTracks()); return stream;
      };
    });
    await page.locator('.header-tools [data-open-scanner]').click();
    await page.waitForFunction(()=>!document.getElementById('scanner-live').hidden).catch(async error => { console.error(await page.locator('#scan-status').textContent()); throw error; });
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.getElementById('scan-modal').open && window.testCameraTracks.length>0 && window.testCameraTracks.every(track=>track.readyState==='ended'));
    assert(await page.evaluate(()=>window.testCameraTracks.every(track=>track.readyState==='ended')));

    // A small, sharp QR occupying about 3% of a 4K frame must remain readable.
    await page.evaluate(async imageData => {
      const image = new Image(); image.src = imageData; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width=3840; canvas.height=2160;
      const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,3840,2160);
      const size=image.naturalWidth / 5;
      ctx.imageSmoothingEnabled=false;ctx.drawImage(image,(3840-size)/2,(2160-size)/2,size,size);
      navigator.mediaDevices.getUserMedia = async options => {
        window.requestedCameraOptions=options;
        const stream=canvas.captureStream(5);window.smallQrTracks=stream.getTracks();
        setTimeout(()=>ctx.drawImage(image,(3840-size)/2,(2160-size)/2,size,size),100);
        return stream;
      };
    }, 'data:image/png;base64,'+fs.readFileSync('.cache/scanner-qr.png').toString('base64'));
    await page.locator('.header-tools [data-open-scanner]').click();
    await page.waitForSelector('#scan-result:not([hidden])').catch(async error=>{console.error(await page.evaluate(()=>({status:document.getElementById('scan-status').textContent,w:document.getElementById('scan-video').videoWidth,h:document.getElementById('scan-video').videoHeight})));await page.screenshot({path:'.cache/qr-debug.png'});throw error;});
    assert.equal(await page.locator('#scan-result-code').textContent(),'GOLD-01');
    assert.equal(await page.evaluate(()=>window.requestedCameraOptions.video.width.ideal),3840);
    await page.waitForFunction(()=>window.smallQrTracks.every(track=>track.readyState==='ended'));
    await page.keyboard.press('Escape');

    await page.evaluate(()=>{
      navigator.mediaDevices.getUserMedia = async()=>{throw new DOMException('Test refusal','NotAllowedError');};
    });
    await page.locator('.header-tools [data-open-scanner]').click();
    await page.waitForFunction(()=>document.getElementById('scan-status').textContent.includes('permission was denied'));
    assert(await page.locator('[data-scan-tab=photo]').isEnabled());
    await page.keyboard.press('Escape');

    // A permission request can resolve after the user has already closed the dialog.
    await page.evaluate(()=>{
      navigator.mediaDevices.getUserMedia = ()=>new Promise(resolve=>{window.releaseCamera=resolve;});
    });
    await page.locator('.header-tools [data-open-scanner]').click();
    await page.waitForFunction(()=>typeof window.releaseCamera==='function');
    await page.keyboard.press('Escape');
    await page.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=20;canvas.height=20;
      const stream=canvas.captureStream(1);window.lateCameraTracks=stream.getTracks();window.releaseCamera(stream);
    });
    await page.waitForFunction(()=>window.lateCameraTracks.every(track=>track.readyState==='ended'));
    assert.equal(await page.locator('#scan-modal').evaluate(dialog=>dialog.open),false);
    await page.goto(base+'/invoices/create');
    await page.locator('.header-tools [data-open-scanner]').click();
    await page.locator('[data-scan-tab=code]').click();
    await page.locator('#scan-manual').fill('GOLD-01');
    await page.locator('#scan-manual').press('Enter');
    await page.waitForSelector('#scan-result:not([hidden])');
    await page.locator('#scan-add').click();
    assert.equal(await page.locator('.item-row').count(),1);
    assert.equal(await page.locator('[name=product_code]').inputValue(),'GOLD-01');
    assert.equal(await page.locator('#scan-modal').evaluate(dialog=>dialog.open),false);
    console.log('PASS: automatic camera, small QR in a 4K frame, permission refusal, late-stream cancellation, and confirmed scan-to-bill.');
    await context.close();
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});

