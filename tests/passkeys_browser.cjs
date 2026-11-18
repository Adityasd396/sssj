/* Synthetic shop + Chromium virtual authenticator only; no physical biometrics. */
const assert = require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
 try{
  const context=await browser.newContext();const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');
  const {authenticatorId}=await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
  const base='http://localhost:56837';
  await page.goto(base+'/login');await page.locator('#username').fill('ui-owner');await page.locator('#password').fill('preview-password');
  await Promise.all([page.waitForURL(base+'/'),page.locator('.login-card [type=submit]').click()]);
  await page.goto(base+'/account/passkeys');await page.locator('#key-name').fill('Test fingerprint device');await page.locator('#key-password').fill('preview-password');
  await Promise.all([page.waitForResponse(r=>r.url().endsWith('/passkeys/register/verify')),page.locator('#passkey-register [type=submit]').click()]);
  await page.waitForURL(base+'/account/passkeys');await page.waitForSelector('td:text("Test fingerprint device")');
  for(const width of [320,768,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  const credentials=await cdp.send('WebAuthn.getCredentials',{authenticatorId});assert.equal(credentials.credentials.length,1);
  await page.locator('.nav-logout').click();await page.waitForURL(base+'/login');
  let assertion;page.on('request',r=>{if(r.url().endsWith('/passkeys/login/verify'))assertion=r.postDataJSON();});
  await page.locator('#passkey-login').click();await page.waitForURL(base+'/');
  const replay=await page.evaluate(async body=>{const csrf=document.querySelector('[name=csrf_token]').value;return (await fetch('/passkeys/login/verify',{method:'POST',headers:{'Content-Type':'application/json','X-CSRFToken':csrf},body:JSON.stringify(body)})).status;},assertion);
  assert.equal(replay,400);
  await page.goto(base+'/account/passkeys');await page.locator('td form [name=password]').fill('preview-password');
  await Promise.all([page.waitForURL(base+'/account/passkeys'),page.locator('td form [type=submit]').click()]);
  assert.equal(await page.locator('td:text("Test fingerprint device")').count(),0);
  assert.deepEqual(errors,[]);console.log('PASS: real WebAuthn registration/signature verification, resident-key login, replay rejection and removal with virtual authenticator.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
