import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const axe = (page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);

// Most of this page starts at opacity:0 and fades in when scrolled into view. Scanning
// or tabbing before that happens tests a mostly-invisible document, which silently
// weakens every assertion below.
//
// Do NOT reach for Playwright's reducedMotion emulation here: as of 1.61 the option is
// not applied via test.use, so it fails open — matchMedia keeps reporting false and the
// page stays hidden while the suite reports green. Scroll the page like a real user
// instead, then wait out the 700ms reveal transition.
async function settleReveals(page) {
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const step = Math.floor(window.innerHeight * 0.8);
    for (let y = 0; y <= document.body.scrollHeight; y += step) {
      // behavior:'instant' is load-bearing. The page sets html{scroll-behavior:smooth},
      // which makes a plain scrollTo animate; a stepped loop then keeps interrupting its
      // own in-flight animation and never reaches the bottom, so the last sections never
      // intersect and never reveal.
      window.scrollTo({ top: y, behavior: 'instant' });
      await sleep(60);
    }
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
    await sleep(200);
    window.scrollTo({ top: 0, behavior: 'instant' });
    await sleep(900);
  });
  // Guard against the above silently not working: the last revealed block must be opaque.
  await expect(page.locator('#contact .form')).toHaveCSS('opacity', '1');
}

// Opening the dialog fades the overlay from opacity 0. axe computes contrast by
// blending ancestor opacity, so scanning mid-fade reports phantom failures against
// half-faded colours. Wait for the settled frame before asserting.
async function openApplyModal(page) {
  await page.locator('.apply-btn.pt-btn').scrollIntoViewIfNeeded();
  await page.locator('.apply-btn.pt-btn').click();
  await expect(page.locator('#applyModal')).toHaveClass(/open/);
  await expect(page.locator('#applyModal')).toHaveCSS('opacity', '1');
}

test.describe('axe-core', () => {
  test('no violations on load', async ({ page }) => {
    await page.goto('/');
    await settleReveals(page);
    expect((await axe(page).analyze()).violations).toEqual([]);
  });

  test('no violations with the apply modal open', async ({ page }) => {
    await page.goto('/');
    await settleReveals(page);
    await openApplyModal(page);
    expect((await axe(page).analyze()).violations).toEqual([]);
  });
});

// ---- Finding #1 / #2: phantom tab stops. axe cannot see these; they are the BLOCKERs. ----
test.describe('focus order (2.4.3 / 4.1.2)', () => {
  // WebKit omits <a> from sequential focus unless the user turns on Full Keyboard
  // Access, so Tab-order assertions cannot run there. That is a Safari preference,
  // not a defect in this page — but it does mean Safari keyboard behaviour is only
  // ever proven by the manual VoiceOver + Safari pass, never by this suite.
  test.skip(({ browserName }) => browserName === 'webkit',
    'WebKit does not tab to links by default; verify Safari manually with VoiceOver');

  test('no tab stop is ever invisible', async ({ page }) => {
    await page.goto('/');
    await settleReveals(page);
    const bad = [];
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Tab');
      const hit = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const box = el.getBoundingClientRect();
        const id = `${el.tagName}[${el.getAttribute('name') || el.className || ''}]`;
        if (el.closest('[inert]')) return `inert: ${id}`;
        if (box.width === 0 || box.height === 0) return `zero-size: ${id}`;
        // Walk ancestors: the original defect hid the modal with opacity:0 alone, which
        // leaves every control inside it focusable and on screen-readers' radar while
        // being completely invisible. Checking only the element itself misses that.
        // settleReveals() has already scrolled every reveal to opacity:1, so any
        // opacity:0 ancestor found here is a genuine hidden-focus bug.
        for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (cs.visibility === 'hidden') return `visibility:hidden via ${n.id || n.className}: ${id}`;
          if (parseFloat(cs.opacity) === 0) return `opacity:0 via ${n.id || n.className}: ${id}`;
          if (n.getAttribute('aria-hidden') === 'true') return `aria-hidden via ${n.id || n.className}: ${id}`;
        }
        return null;
      });
      if (hit) bad.push(hit);
    }
    expect(bad, 'focus landed on invisible element(s)').toEqual([]);
  });

  test('closed apply modal is inert; opening releases it and moves focus in', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#applyModal')).toHaveAttribute('inert', '');

    await openApplyModal(page);
    await expect(page.locator('#applyModal')).not.toHaveAttribute('inert', '');
    // inert must be released BEFORE .focus() or the focus call is silently discarded
    await expect(page.locator('#applyForm input[name="from_name"]')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('#applyModal')).toHaveAttribute('inert', '');
    await expect(page.locator('.apply-btn.pt-btn')).toBeFocused();
  });

  test('collapsed mobile menu is inert', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile viewport only');
    await page.goto('/');
    await expect(page.locator('#mobileMenu')).toHaveAttribute('inert', '');
    await page.locator('#navToggle').click();
    await expect(page.locator('#mobileMenu')).not.toHaveAttribute('inert', '');
    await page.locator('#navToggle').click();
    await expect(page.locator('#mobileMenu')).toHaveAttribute('inert', '');
  });
});

// ---- Finding #3: status messages ----
test.describe('status messages (4.1.3)', () => {
  test('both outcome regions are live and never display:none', async ({ page }) => {
    await page.goto('/');
    for (const sel of ['#notice', '#applySuccess']) {
      await expect(page.locator(sel)).toHaveAttribute('aria-live', 'polite');
      await expect(page.locator(sel)).toHaveAttribute('role', 'status');
      // A live region hidden with display:none is not in the a11y tree, so text
      // injected into it is never announced.
      const display = await page.locator(sel).evaluate((el) => getComputedStyle(el).display);
      expect(display, `${sel} must not be display:none`).not.toBe('none');
    }
  });

  test('the apply modal does not auto-close over the confirmation', async ({ page }) => {
    await page.goto('/');
    const src = await page.content();
    // [\s\S]{0,160}? and not [^)]* — the callback itself contains ")" as in
    // `setTimeout(function() { closeModal(); }, 3000)`, so a negated-")" class stops
    // dead at the first paren and never reaches closeModal. That regex reported clean
    // against the exact code this test exists to reject.
    expect(src, 'a timed auto-close destroys the confirmation before a screen reader reads it')
      .not.toMatch(/setTimeout\([\s\S]{0,160}?closeModal/);
  });
});

// ---- Finding #6: bypass blocks ----
test('skip link is the first tab stop and targets main (2.4.1)', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit does not tab to links by default');
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveClass(/skip-link/);
  await expect(page.locator(':focus')).toHaveAttribute('href', '#main');
  await expect(page.locator('main#main')).toHaveCount(1);
});

// ---- Finding #7: autocomplete ----
test('identity inputs declare autocomplete (1.3.5)', async ({ page }) => {
  await page.goto('/');
  const expected = [
    ['#demoForm [name="from_name"]', 'name'],
    ['#demoForm [name="from_email"]', 'email'],
    ['#demoForm [name="phone"]', 'tel'],
    ['#demoForm [name="company"]', 'organization'],
    ['#applyForm [name="from_name"]', 'name'],
    ['#applyForm [name="from_email"]', 'email'],
    ['#applyForm [name="phone"]', 'tel'],
  ];
  for (const [sel, val] of expected) {
    await expect(page.locator(sel)).toHaveAttribute('autocomplete', val);
  }
});

// ---- Findings #4 / #5 / #8 / #11: contrast, measured from shipped computed styles ----
test('contrast holds on the shipped values (1.4.3 / 1.4.11)', async ({ page }) => {
  await page.goto('/');
  const failures = await page.evaluate(() => {
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const cr = (a, z) => { const l1 = L(a), l2 = L(z); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return (hi + 0.05) / (lo + 0.05); };
    const nums = (s) => (s.match(/[\d.]+/g) || []).map(Number);
    const gradientStops = (s) => [...s.matchAll(/rgba?\(([^)]+)\)/g)].map((m) => m[1].split(',').slice(0, 3).map(parseFloat));
    // Walk ancestors for the first opaque background — a transparent element
    // must not be scored against rgba(0,0,0,0).
    const effBg = (el) => {
      let n = el;
      while (n && n !== document.documentElement) {
        const c = nums(getComputedStyle(n).backgroundColor);
        if (c.length >= 3 && (c[3] === undefined || c[3] > 0)) return c.slice(0, 3);
        n = n.parentElement;
      }
      return [255, 255, 255];
    };
    const out = [];
    // White label text on gradient fills: the light end of the gradient is the worst case.
    for (const sel of ['.btn-primary', '.apply-btn.pt-btn', '.apply-btn.ot-btn', '.apply-btn.slp-btn', '.icon.pt', '.icon.ot', '.icon.slp']) {
      const el = document.querySelector(sel);
      if (!el) { out.push(`${sel}: MISSING`); continue; }
      const cs = getComputedStyle(el);
      const fg = nums(cs.color).slice(0, 3);
      const stops = gradientStops(cs.backgroundImage);
      const worst = Math.min(...(stops.length ? stops : [effBg(el)]).map((s) => cr(fg, s)));
      if (worst < 4.5) out.push(`${sel}: ${worst.toFixed(2)}:1 < 4.5`);
    }
    // Text tokens against their real backdrop.
    for (const sel of ['#services .tag', '.step-number', '.req-star', '#agencies .section-head p']) {
      const el = document.querySelector(sel);
      if (!el) { out.push(`${sel}: MISSING`); continue; }
      const r = cr(nums(getComputedStyle(el).color).slice(0, 3), effBg(el));
      if (r < 4.5) out.push(`${sel}: ${r.toFixed(2)}:1 < 4.5`);
    }
    // 1.4.11 — form control boundaries need 3:1 against both sides.
    const inp = document.querySelector('#demoForm input[name="from_name"]');
    const border = nums(getComputedStyle(inp).borderTopColor).slice(0, 3);
    for (const [label, bg] of [['field', nums(getComputedStyle(inp).backgroundColor).slice(0, 3)], ['card', [255, 255, 255]]]) {
      const r = cr(border, bg);
      if (r < 3) out.push(`input border vs ${label}: ${r.toFixed(2)}:1 < 3.0`);
    }
    return out;
  });
  expect(failures, 'contrast failures').toEqual([]);
});

// ---- Findings #9 / #10: reflow and text spacing ----
test('reflows at 320px with no 2-D scrolling and no clipped contact text (1.4.10)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'reflow', '320px project only');
  await page.goto('/');
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, 'horizontal scrolling at 320px').toBeLessThanOrEqual(innerWidth + 1);

  // The email is the fallback channel when the form fails; it must never be cut off.
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('.contact-points span, .contact-points a, .footer span, .footer a')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent.trim().slice(0, 40)));
  expect(clipped, 'clipped contact text at 320px').toEqual([]);
});

test('survives forced text spacing (1.4.12)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'mobile menu only');
  await page.goto('/');
  await page.addStyleTag({
    content: `* { line-height: 1.5 !important; letter-spacing: .12em !important;
      word-spacing: .16em !important; } p { margin-bottom: 2em !important; }`,
  });
  await page.locator('#navToggle').click();
  const reachable = await page.locator('#mobileMenu').evaluate(
    (el) => el.scrollHeight <= el.clientHeight + 1 || getComputedStyle(el).overflowY === 'auto');
  expect(reachable, 'mobile menu clips content under forced text spacing').toBe(true);
});

// ---- Finding #13: list semantics ----
test('sequences and lists use list semantics (1.3.1)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('ol.steps > li')).toHaveCount(4);
  await expect(page.locator('ul.checks > li')).toHaveCount(4);
  await expect(page.locator('ul.contact-points > li')).toHaveCount(3);
});
