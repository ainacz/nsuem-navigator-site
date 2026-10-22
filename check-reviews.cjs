// Run against a static server: node check-reviews.cjs [URL] [source Markdown].
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const url = process.argv[2] || 'http://127.0.0.1:4173/';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: false });
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    assert.equal((await page.goto(url)).status(), 200);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => {
      const reviews = document.querySelector('.reviews').getBoundingClientRect();
      const examples = document.querySelector('.examples').getBoundingClientRect();
      const max = document.querySelector('.max').getBoundingClientRect();
      const quote = document.querySelector('.review-card blockquote').getBoundingClientRect();
      const pattern = document.querySelector('.brand-pattern').getBoundingClientRect();
      const heading = document.querySelector('.messengers h2').getBoundingClientRect();
      return max.bottom <= reviews.top && reviews.bottom <= examples.top && quote.top + 44 <= innerHeight && pattern.bottom <= heading.top + 1;
    }), true, 'Reviews must follow bot buttons, precede examples and show text on the first phone screen');
    const track = page.locator('.review-track');
    const next = page.getByRole('button', { name: 'Следующие отзывы' });
    const previous = page.getByRole('button', { name: 'Предыдущие отзывы' });
    assert.equal(await page.locator('.review-card').count(), 21);
    assert.equal(await page.locator('.review-card').first().getAttribute('data-review'), '21');
    assert.equal(await page.locator('[data-review="21"] blockquote').textContent(), 'бот реально помогает больше, чем сайт вуза, где нужно искать всю информацию по разделам. намного удобнее написать вопрос и моментально получить на него ответ. спасибо разработчику! 🙏🏻');
    assert.equal(await page.locator('.reviews').evaluate(node => /От:|Чат:|\bid\s+\d{6,}/u.test(node.textContent)), false);
    assert.equal(await page.locator('[data-review="16"] blockquote').textContent(), '👎');
    assert.equal(await page.locator('[lang="en"]').count(), 1);
    if (process.argv[3]) {
      const source = fs.readFileSync(process.argv[3], 'utf8');
      const expected = [...source.matchAll(/^(\d+)\. \*\*(.+?)\*\* — (.+)$/gm)].reverse();
      assert.equal(expected.length, 20);
      for (const [index, review] of expected.entries()) {
        const card = page.locator('.review-card').nth(index + 1);
        assert.equal(await card.getAttribute('data-review'), review[1]);
        assert.equal(await card.locator('blockquote').textContent(), review[3]);
      }
    }
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await track.focus();
      await page.keyboard.press('Home');
      await page.waitForFunction(() => document.querySelector('[data-direction="-1"]').disabled);
      await next.click();
      await page.waitForFunction(() => document.querySelector('.review-track').scrollLeft > 20);
      await track.focus();
      await page.keyboard.press('End');
      await page.waitForFunction(() => document.querySelector('[data-direction="1"]').disabled);
      assert.match(await page.locator('.review-counter').textContent(), /21 \/ 21$/);
      await page.keyboard.press('Home');
      await page.waitForFunction(() => document.querySelector('[data-direction="-1"]').disabled);
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => document.querySelector('.review-track').scrollLeft > 20);
      await page.keyboard.press('ArrowLeft');
      await page.waitForFunction(() => document.querySelector('[data-direction="-1"]').disabled);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      console.log(width + 'px: text, arrows, keyboard, boundaries, overflow PASS');
    }
    const more = page.locator('.review-expand:visible').first();
    await more.click();
    assert.equal(await more.getAttribute('aria-expanded'), 'true');
    const full = more.locator('..').locator('blockquote');
    assert.equal(await full.evaluate(node => node.scrollHeight <= node.clientHeight + 1), true);
    await more.click();
    assert.equal(await more.getAttribute('aria-expanded'), 'false');
    const touch = await browser.newPage({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true });
    await touch.goto(url);
    await touch.locator('.review-track').scrollIntoViewIfNeeded();
    const box = await touch.locator('.review-track').boundingBox();
    const client = await touch.context().newCDPSession(touch);
    const y = Math.min(box.y + 140, 800);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 340, y }] });
    for (const x of [290, 240, 180, 100, 50]) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touch.waitForFunction(() => document.querySelector('.review-track').scrollLeft > 40);
    await touch.getByRole('button', { name: 'Следующие отзывы' }).click();
    await touch.waitForFunction(() => document.querySelector('.review-track').scrollLeft > 320);
    console.log('Native touch swipe and default animation PASS');
    const fallback = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 900 } });
    await fallback.goto(url);
    assert.equal(await fallback.locator('.review-card').count(), 21);
    assert.equal(await fallback.locator('.review-controls').isVisible(), false);
    assert.equal(await fallback.locator('.is-collapsed').count(), 0);
    assert.deepEqual(errors, []);
    console.log('21 original reviews and no-JavaScript fallback PASS');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
