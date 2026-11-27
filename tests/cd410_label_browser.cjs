/* Run against tests/serve_preview.py with synthetic data. Chromium PDF checks require pdfinfo. */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = 'http://127.0.0.1:56837';
const output = '.cache/cd410-alignment';
fs.mkdirSync(output, { recursive: true });

async function checkPdf(page, name, count, width, height) {
    const path = output + '/' + name + '.pdf';
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path, format: 'A4', preferCSSPageSize: true });
    await page.emulateMedia({ media: null });
    checkPdfSize(path, count, width, height);
}

function checkPdfSize(path, count, width, height) {
    const info = execFileSync('pdfinfo', ['-f', '1', '-l', String(count), path], { encoding: 'utf8' });
    assert.equal(Number(info.match(/^Pages:\s*(\d+)/m)[1]), count, info);
    const sizes = [...info.matchAll(/^Page\s+\d+\s+size:\s+([\d.]+) x ([\d.]+)/gm)];
    assert.equal(sizes.length, count, info);
    for (const [, w, h] of sizes) {
        assert(Math.abs(Number(w) * 25.4 / 72 - width) < 0.4, info);
        assert(Math.abs(Number(h) * 25.4 / 72 - height) < 0.4, info);
    }
}

async function run(engine) {
    const browser = await pw[engine].launch(engine === 'chromium' ? { executablePath: process.env.CHROME_PATH } : {});
    try {
        const page = await browser.newPage({ viewport: { width: 320, height: 780 } });
        await page.goto(base + '/login');
        await page.locator('#username').fill('ui-owner');
        await page.locator('#password').fill('preview-password');
        await Promise.all([page.waitForURL(base + '/'), page.locator('.login-card [type=submit]').click()]);
        await page.goto(base + '/products/1/tag?w=50&h=20');
        await page.locator('select[name=rotate]').selectOption('90');
        assert(await page.locator('[data-print-label]').isDisabled());
        await Promise.all([page.waitForURL(u => u.searchParams.get('rotate') === '90'), page.getByRole('button', { name: 'Update preview' }).click()]);
        assert.match(await page.locator('.setup .paper').textContent(), /50\.0 × 20\.0/);
        assert(await page.locator('[data-print-label]').isEnabled());
        assert.equal(await page.locator('.label-page').count(), 1);
        const fit = await page.locator('.label-page').evaluate(e => {
            const frame = e.getBoundingClientRect();
            const art = e.firstElementChild.getBoundingClientRect();
            return art.width < frame.width && Math.abs(frame.height - art.height) < 0.1;
        });
        assert(fit);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
        if (engine === 'chromium') {
            await checkPdf(page, 'vertical-tag', 1, 50, 20);
            await page.goto(base + '/products/1/tag?w=50&h=20&rotate=180');
            await checkPdf(page, 'flipped-tag', 1, 50, 20);
            await page.goto(base + '/products/1/tag?w=50&h=20&rotate=90');
        }

        await page.getByRole('link', { name: 'Print one test label' }).click();
        await page.waitForURL('**/tags/calibrate?*');
        assert.equal(await page.locator('select[name=rotate]').inputValue(), '90');
        await page.emulateMedia({ media: 'print' });
        assert.equal(await page.locator('.no-print').isVisible(), false);
        if (engine === 'chromium') await checkPdf(page, 'vertical-test', 1, 50, 20);
        if (engine === 'chromium' && !(await (await page.request.get(base + '/tags')).text()).includes('Synthetic small tag')) {
            const session = await (await page.request.get(base + '/api/session')).json();
            await page.request.post(base + '/tags/save', { form: {
                csrf_token: session.csrf_token, scope: 'category', category: 'Chains',
                name: 'Synthetic small tag', width_mm: '40', height_mm: '15', copies: '3',
                show_name: 'on', show_qr: 'on', is_thermal: 'on'
            }});
        }

        await page.goto(base + '/tags/print?ids=1,2');
        assert.equal(await page.locator('[name=group] option').count(), 2);
        assert.equal(await page.locator('.label-page').count(), 1);
        await page.emulateMedia({ media: 'screen' });
        await page.locator('[name=group]').selectOption('2');
        await page.locator('select[name=rotate]').selectOption('270');
        await Promise.all([page.waitForURL(u => u.searchParams.get('group') === '2'), page.getByRole('button', { name: 'Update preview' }).click()]);
        assert.equal(await page.locator('.label-page').count(), 3);
        assert.equal(await page.locator('.label-page .jt-name').first().textContent(), 'Silver chain');
        if (engine === 'chromium') await checkPdf(page, 'three-rotated-tags', 3, 40, 15);
        await page.goto(base + '/tags/print?ids=1,2&layout=sheet');
        assert.equal(await page.locator('.label-page').count(), 0);
        assert.equal(await page.locator('.sheet > .jt').count(), 4);
        if (engine === 'chromium') {
            await checkPdf(page, 'a4-tags', 1, 210, 297);
            await page.goto(base + '/tags/calibrate?w=40&h=15');
            await checkPdf(page, 'one-test-small', 1, 40, 15);
        }
        await page.goto(base + '/tags');
        await page.getByRole('button', { name: 'Tail · 30 + 14 × 12 mm' }).click();
        assert.equal(await page.locator('#shape').inputValue(), 'tail');
        assert.equal(await page.locator('#tail_mm').inputValue(), '14');
        await page.getByRole('button', { name: 'Rectangle · 1.5 × 0.5 in' }).click();
        assert.equal(await page.locator('#shape').inputValue(), 'rectangle');
        assert.equal(await page.locator('#width_mm').inputValue(), '38.1');
        assert.equal(await page.locator('#width_mm').evaluate(el => el.validity.stepMismatch), false);

        await page.goto(base + '/products/1/tag');
        await page.locator('#preset').selectOption('tail-56x15');
        await Promise.all([
            page.waitForURL(u => u.searchParams.get('preset') === 'tail-56x15'),
            page.getByRole('button', { name: 'Load preset or design' }).click()
        ]);
        assert.equal(await page.locator('#shape').inputValue(), 'tail');
        assert.equal(Number(await page.locator('#tail').inputValue()), 16);
        assert.match(await page.locator('.setup .paper').textContent(), /56\.0 × 15\.0/);
        await page.locator('[name=tail_pos]').selectOption('bottom');
        await page.locator('[name=tail_height]').fill('5');
        await page.locator('[data-print-alignment] summary').click();
        const settings = page.locator('[data-label-settings]');
        await settings.locator('[name=left]').fill('1.2');
        await settings.locator('[name=right]').fill('1');
        await settings.locator('[name=x]').fill('0.4');
        await settings.locator('[name=gap]').fill('2.5');
        await settings.locator('[data-profile-name]').fill('CD410 tail stock');
        await settings.locator('[data-profile-save]').click();
        assert.match(await settings.locator('[data-profile-status]').textContent(), /settings saved/);
        await Promise.all([
            page.waitForURL(u => u.searchParams.get('tail_pos') === 'bottom'),
            page.getByRole('button', { name: 'Update preview' }).click()
        ]);
        assert.equal(await page.locator('.jt-tail').evaluate(tail => getComputedStyle(tail).alignSelf), 'flex-end');
        assert.match(await page.locator('.setup').textContent(), /2.5 mm/);
        if (engine === 'chromium') await checkPdf(page, 'tail-with-padding', 1, 56, 15);
        await page.getByRole('link', { name: 'Print one test label' }).click();
        await page.waitForURL('**/tags/calibrate?*');
        assert.equal(await page.locator('svg rect').count(), 2);
        if (engine === 'chromium') await checkPdf(page, 'tail-test', 1, 56, 15);
        await page.goto(base + '/tags/calibrate?w=56&h=15');
        await page.locator('[data-print-alignment] summary').click();
        await page.locator('[data-profile-list]').selectOption('CD410 tail stock');
        await page.locator('[data-profile-load]').click();
        assert.equal(await page.locator('[name=left]').inputValue(), '1.2');
        assert.equal(await page.locator('[name=x]').inputValue(), '0.4');
        assert(await page.locator('[data-print-label]').isDisabled());
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
        await page.goto(base + '/products/1/tag?preset=rect-38x15&rotate=270');
        assert.match(await page.locator('.setup .paper').textContent(), /38 × 15|38\.0 × 15\.0/);
        if (engine === 'chromium') {
            for (const rotation of [0, 90, 180, 270]) {
                const response = await page.request.get(base + '/tags/calibrate?format=pdf&w=38&h=15&rotate=' + rotation);
                assert.equal(response.status(), 200);
                assert.match(response.headers()['content-type'], /^application\/pdf/);
                const file = output + '/38x15-cd410-' + rotation + '.pdf';
                fs.writeFileSync(file, await response.body());
                checkPdfSize(file, 1, 38, 15);
            }
            const custom = await page.request.get(base + '/tags/calibrate?format=pdf&w=38&h=15&paper_w=15&paper_h=38&rotate=90');
            assert.equal(custom.status(), 200);
            const file = output + '/15x38-cd410.pdf';
            fs.writeFileSync(file, await custom.body());
            checkPdfSize(file, 1, 15, 38);
        }
        await page.goto(base + '/products/2/tag?preset=rect-38x15');
        const requestedPdf = page.context().waitForEvent('request', r => {
            const url = new URL(r.url());
            return url.pathname === '/products/2/tag' && url.searchParams.get('format') === 'pdf';
        });
        const [printRequest] = await Promise.all([
            requestedPdf, page.getByRole('button', { name: 'Open exact-size tag PDF' }).click()
        ]);
        const productPdf = await page.request.get(printRequest.url());
        assert.equal(productPdf.status(), 200);
        assert.match(productPdf.headers()['content-type'], /^application\/pdf/);
        const bytes = await productPdf.body();
        assert(bytes.includes(Buffer.from('/Subtype /Image')), 'the tag PDF must embed the product QR');
        const productFile = output + '/38x15-product-tag-' + engine + '.pdf';
        fs.writeFileSync(productFile, bytes);
        checkPdfSize(productFile, 1, 38, 15);
        if (engine === 'chromium') {
            const batch = await page.request.get(base + '/tags/print?ids=1,2&group=2&format=pdf&paper_w=38&paper_h=15');
            assert.equal(batch.status(), 200);
            const batchFile = output + '/38x15-product-batch.pdf';
            fs.writeFileSync(batchFile, await batch.body());
            checkPdfSize(batchFile, 3, 38, 15);
            const tail = await page.request.get(base + '/products/1/tag?preset=tail-56x15&format=pdf');
            assert.equal(tail.status(), 200);
            const tailFile = output + '/56x15-product-tail.pdf';
            fs.writeFileSync(tailFile, await tail.body());
            checkPdfSize(tailFile, 1, 56, 15);
        }
        console.log(engine + ' passed label settings, fixed stock sizes and the exact-size product tag PDF');
    } finally {
        await browser.close();
    }
}

(async () => {
    await run('chromium');
    await run('webkit');
})().catch(error => { console.error(error); process.exitCode = 1; });
