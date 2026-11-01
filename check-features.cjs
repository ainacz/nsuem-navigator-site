// Run: node check-features.cjs [URL] [baseline HTML]. Requires Playwright and Edge.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const success = 'Вопрос скопирован — отправь его боту';
const questions = [
  'Где находится 5-303?', 'Где посмотреть расписание моей группы?',
  'Как заказать справку об обучении?', 'Как узнать условия повышенной стипендии?',
  'Где посмотреть даты пересдач?', 'Куда обратиться по заселению?'
];

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: false });
  try {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    const errors = [];
    let popups = 0;
    page.on('pageerror', error => errors.push(error.message));
    page.on('popup', () => popups++);
    const response = await page.goto(url);
    assert.equal(response.status(), 200);
    const html = await response.text();
    if (process.argv[3]) {
      const baseline = fs.readFileSync(process.argv[3], 'utf8');
      const hero = source => source.slice(source.indexOf('<div class="hero">'), source.indexOf('<section class="reviews"'));
      const reviews = (source, next) => source.slice(source.indexOf('<section class="reviews"'), source.indexOf(next));
      assert.equal(hero(html), hero(baseline), 'Hero HTML must remain unchanged');
      assert.equal(reviews(html, '<section class="features"'), reviews(baseline, '<section class="examples"'), 'All original reviews and metadata must remain unchanged');
      const originalScript = baseline.match(/<script>([\s\S]*?)<\/script>/)[1].trim();
      assert(html.match(/<script>([\s\S]*?)<\/script>/)[1].trim().startsWith(originalScript), 'Carousel code must remain unchanged');
    }
    await page.evaluate(() => document.fonts.ready);
    assert.deepEqual(await page.locator('.question-text').allTextContents(), questions);
    assert.equal(await page.locator('.feature-card').count(), 6);
    assert.deepEqual(await page.locator('a.messenger').evaluateAll(nodes => nodes.map(node => node.href)), [
      'https://t.me/ninhkurs_bot', 'https://max.ru/se13712944_1_bot',
      'https://t.me/ninhkurs_bot', 'https://max.ru/se13712944_1_bot'
    ]);
    assert.equal(await page.locator('.room-note').textContent(), 'Отсутствие занятий в расписании не означает разрешение занять аудиторию.');
    for (const width of [320, 390, 640, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.locator('.feature-grid').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), width <= 650 ? 1 : 2);
      const headingFonts = await page.locator('.feature-card h3, .all-topics summary, .topic-groups h3, .room-pilot h3').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).font));
      assert.equal(new Set(headingFonts).size, 1, 'All capability headings must use the same typography');
      const order = await page.evaluate(() => ['.hero', '.reviews', '.features', '.repeat-cta'].map(selector => document.querySelector(selector).getBoundingClientRect()));
      for (let i = 1; i < order.length; i++) assert(order[i].top >= order[i - 1].bottom);
      const summary = page.locator('.all-topics summary');
      await summary.focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.all-topics').getAttribute('open'), '');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.keyboard.press('Space');
      assert.equal(await page.locator('.all-topics').getAttribute('open'), null);
      console.log(width + 'px: layout, order, details and keyboard PASS');
    }
    await page.bringToFront();
    const originalURL = page.url();
    for (const [index, question] of questions.entries()) {
      const card = page.locator('.feature-card').nth(index);
      if (index === 0) { await card.locator('button').focus(); await page.keyboard.press('Enter'); }
      else await card.locator('button').click();
      await page.waitForFunction(({ index, success }) => document.querySelectorAll('.copy-feedback')[index].textContent === success, { index, success });
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), question);
      assert.equal(await card.locator('textarea').isVisible(), false);
      assert.equal(page.url(), originalURL);
    }
    assert.equal(popups, 0);
    console.log('All six examples copy exact text using the real clipboard; no navigation PASS');
    for (const mode of ['reject', 'missing', 'pending']) {
      const fallback = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await fallback.addInitScript(mode => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === 'missing' ? undefined : {
          writeText: () => mode === 'reject' ? Promise.reject(new Error('Denied')) : new Promise(resolve => { window.finishCopy = resolve; })
        } });
      }, mode);
      await fallback.goto(url);
      const card = fallback.locator('.feature-card').first();
      await card.locator('button').click();
      if (mode === 'pending') {
        assert.equal(await card.locator('.copy-feedback').textContent(), '');
        await fallback.evaluate(() => window.finishCopy());
        await fallback.waitForFunction(success => document.querySelector('.copy-feedback').textContent === success, success);
      } else {
        await card.locator('textarea').waitFor({ state: 'visible' });
        assert(!((await card.locator('.copy-feedback').textContent()).includes(success)));
        assert.equal(await card.locator('textarea').inputValue(), questions[0]);
        assert.equal(await card.locator('textarea').evaluate(node => document.activeElement === node && node.selectionEnd - node.selectionStart === node.value.length), true);
        await fallback.keyboard.press('Tab');
        assert.equal(await fallback.locator('.question-copy').nth(1).evaluate(node => node === document.activeElement), true);
      }
      assert.equal(await fallback.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await fallback.close();
    }
    const plain = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    await plain.goto(url);
    await plain.locator('summary').click();
    assert.equal(await plain.locator('.all-topics').getAttribute('open'), '');
    assert.deepEqual(await plain.locator('.question-text').allTextContents(), questions);
    assert.deepEqual(errors, []);
    console.log('Denied/missing clipboard manual selection, pending-copy feedback and native details without JS PASS');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
