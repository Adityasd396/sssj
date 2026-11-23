/* Run against tests/serve_preview.py, never against a customer's live shop. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = 'http://127.0.0.1:' + (process.env.BILLING_PREVIEW_PORT || '56837');
const output = path.resolve('.cache/ui-verification');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push({url:page.url(), stack:error.stack}));
    await page.goto(base + '/login');
    await page.locator('[name=username]').fill('ui-owner');
    await page.locator('[name=password]').fill('preview-password');
    await Promise.all([page.waitForURL(base + '/'), page.locator('button[type=submit]').click()]);

    await page.goto(base + '/invoices/create');
    await page.locator('#client_id').selectOption('1');
    await page.locator('#product-code').fill('GOLD-01');
    await page.locator('#product-code').press('Enter');
    await page.waitForFunction(() => document.querySelector('[name=product_code]')?.value === 'GOLD-01');
    assert.equal(await page.locator('[name=description]').inputValue(), 'Classic "Heritage" Ring');
    await page.locator('[name=making_charges]').fill('0');
    await page.locator('#payment_type').selectOption('partial');
    await page.locator('#partial_amount').fill('5000');
    await page.waitForFunction(() => document.getElementById('pricing-status').textContent === 'Bill total is up to date.' && Number(document.getElementById('received-amount').textContent.replaceAll(',', '')) === 5000);
    assert(Number((await page.locator('#remaining-amount').textContent()).replaceAll(',', '')) > 0);
    await page.reload();
    await page.locator('#restore-draft').click();
    assert.equal(await page.locator('[name=description]').inputValue(), 'Classic "Heritage" Ring');
    assert.equal(await page.locator('#partial_amount').inputValue(), '5000');
    assert.equal(await page.locator('[name=making_charges]').inputValue(), '0');

    await page.locator('#new-customer').click();
    await page.locator('#quick-name').fill('Checkout customer');
    await page.locator('#quick-phone').fill('9' + String(Date.now()).slice(-9));
    await page.locator('#quick-customer-form [type=submit]').click();
    await page.waitForFunction(() => !document.getElementById('customer-dialog').open);
    assert.match(await page.locator('#client_id option:checked').textContent(), /Checkout customer/);
    await page.locator('#client_id').selectOption('1');

    // Keep entered details when the original checkout rejects an overpayment.
    await page.locator('#partial_amount').fill('999999');
    await Promise.all([page.waitForNavigation(), page.locator('#invoice-form').evaluate(form => form.submit())]);
    assert.match(await page.locator('#bill-error').textContent(), /Partial amount/);
    assert.equal(await page.locator('#partial_amount').inputValue(), '999999');
    await page.locator('#partial_amount').fill('5000');
    await page.waitForFunction(() => document.getElementById('pricing-status').textContent === 'Bill total is up to date.' && Number(document.getElementById('received-amount').textContent.replaceAll(',', '')) === 5000);

    await page.locator('#bill-error').evaluate(element => { element.textContent = ''; });
    for (const [width, height] of [[320, 740], [390, 844], [768, 1024], [1024, 768], [1440, 1000]]) {
      await page.setViewportSize({ width, height });
      const overflow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
      assert(overflow.page <= overflow.viewport + 1, `Billing overflows at ${width}: ${JSON.stringify(overflow)}`);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: path.join(output, `billing-${width}.png`), fullPage: true });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.getElementById('pricing-status').textContent === 'Bill total is up to date.' && Number(document.getElementById('received-amount').textContent.replaceAll(',', '')) === 5000);
    const previewTotal = Number((await page.locator('#total').textContent()).replaceAll(',', ''));
    assert.equal(await page.locator('#dock-save-bill').getAttribute('form'), 'invoice-form');
    await page.locator('#dock-save-bill').click();
    try { await page.waitForURL(/\/invoices\/\d+$/, {timeout:12000}); } catch(error) { console.log('SAVE DIAGNOSTIC',page.url(),await page.locator('#bill-error').textContent(),await page.locator('#pricing-status').textContent(),await page.locator('#invoice-form').evaluate(f=>({valid:f.checkValidity(),busy:f.dataset.submitting,invalid:Array.from(f.querySelectorAll(':invalid')).map(e=>[e.name,e.validationMessage])}))); throw error; }
    const billURL = page.url();
    const billID = billURL.split('/').pop();
    assert.equal(Number((await page.locator('.grand span').last().textContent()).replace(/[₹,]/g, '')), previewTotal);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('billing-draft-v1-1')), null);
    assert(await page.getByRole('link', { name: '+ New bill', exact: true }).isVisible());

    await page.setViewportSize({width:1440,height:1000});
    await page.goto(base + '/');
    assert(await page.locator('.chart .col').evaluateAll(cols => cols.length > 1 && cols[1].getBoundingClientRect().left > cols[0].getBoundingClientRect().left));
    await page.screenshot({path:path.join(output,'overview-desktop.png'),fullPage:true});
    await page.locator('.header-tools [data-open-scanner]').click();
    assert(await page.locator('#scan-modal').isVisible());
    await page.screenshot({path:path.join(output,'scanner-desktop.png')});
    await page.locator('#scan-fallback').evaluate(d=>d.open=true);
    await page.locator('#scan-manual').fill('GOLD-01');await page.locator('#scan-manual').press('Enter');await page.waitForURL(base+'/products/1');
    assert.match(await page.locator('h1').textContent(),/Classic/);
    for(const file of ['scanner-qr.png','scanner-barcode.png']){
      await page.locator('.header-tools [data-open-scanner]').click();await page.locator('#scan-fallback').evaluate(d=>d.open=true);await page.locator('#qr-upload').setInputFiles(path.resolve('.cache/'+file));await page.waitForFunction(()=>document.getElementById('scan-modal').hidden);await page.waitForURL(base+'/products/1');
    }

    // All record screens must stay within the viewport at phone/tablet/PC sizes.
    const pages = ['/', '/clients', '/products', '/invoices', '/collect', '/reports', '/settings',
      '/tags', '/users', '/audit-logs', '/deleted-bills', '/clients/1', '/products/1', billURL,
      '/clients/add', '/clients/1/edit', '/products/add', '/products/1/edit', '/register', '/tags/print?ids=1',
      `/invoices/${billID}/payment`, '/clients/1/pay-remaining', '/clients/1/statement', '/products/1/tag', '/tags/calibrate'];
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const route of pages) {
        const response = await page.goto(route.startsWith('http') ? route : base + route);
        assert.equal(response.status(), 200, `${route} at ${width}`);
        const overflow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
        assert(overflow.page <= overflow.viewport + 1, `${route} overflows at ${width}: ${JSON.stringify(overflow)}`);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/invoices');
    assert(await page.locator('.mobile-cards').count() > 0);
    await page.screenshot({ path: path.join(output, 'bills-mobile.png'), fullPage: true });
    await page.locator('#nav-toggle').click();
    assert.equal(await page.locator('#nav-toggle').getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#nav-toggle').getAttribute('aria-expanded'), 'false');

    await page.goto(billURL);
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('header').isVisible(), false);
    assert.equal(await page.locator('.tabbar').isVisible(), false);
    await page.pdf({ path: path.join(output, 'invoice-print.pdf'), format: 'A4', printBackground: true });
    const touch = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true,
      storageState:await context.storageState()});
    const touchPage = await touch.newPage();
    touchPage.on('pageerror', error => errors.push({url:touchPage.url(),stack:error.stack}));
    await touchPage.goto(base + '/');
    await touchPage.screenshot({path:path.join(output,'overview-mobile.png'),fullPage:true});
    await touchPage.goto(base + '/invoices/create');
    await touchPage.locator('#nav-toggle').tap();
    assert.equal(await touchPage.locator('#nav-toggle').getAttribute('aria-expanded'), 'true');
    await touchPage.locator('[data-close-menu]').tap();
    await touchPage.locator('.add-item-btn').tap();
    assert.equal(await touchPage.locator('.item-row').count(), 2);
    await touchPage.screenshot({path:path.join(output, 'mobile-viewport.png')});
    await touchPage.locator('.header-tools [data-open-scanner]').tap();
    await touchPage.screenshot({path:path.join(output,'scanner-mobile.png')});
    await touchPage.keyboard.press('Escape');
    await touch.close();
    assert.deepEqual(errors, [], 'Browser script errors');
    console.log('PASS: checkout, draft recovery, quick customer, validation recovery, mobile cards, navigation, print and 125 responsive screen checks plus touch interaction.');
    console.log('Screenshots: ' + output);
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
