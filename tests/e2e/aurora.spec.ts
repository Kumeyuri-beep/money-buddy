import { expect, test, type Page } from '@playwright/test';

/**
 * พื้นหลังออโรรา + กระจกโปร่งแสง (14 พ.ย. 2569 · docs/decisions/2026-11-14-aurora-liquid-glass.md)
 * - ห้าม blur ซ้อน: ไม่มีองค์ประกอบ backdrop-filter อยู่ใต้องค์ประกอบ backdrop-filter อีกตัว (ทุกหน้า)
 * - พื้นหลังเป็น CSS gradient ล้วน (ไม่มีรูป/ไม่มีคำขอออกนอกเครื่อง) · ขยับช้ามากเฉพาะคอมที่ไม่ลดการเคลื่อนไหว · นิ่งบนมือถือ/ลดการเคลื่อนไหว
 * - การ์ดหน้า (glass-lite) โปร่งแสงจริง (มี backdrop-filter และพื้นไม่ทึบ) · รายการ/ตาราง (solid) ยังทึบ · มือถือแถบหัวหน้าไม่ blur
 * ตัว contrast ของข้อความดูที่ contrast.spec.ts (วัดจากภาพจริง) และ tests/unit/themeContrast.test.ts (กรณีพื้นหลังแย่สุด)
 */
const VIEWS = [
  { id: 'today', desktop: 'ภาพรวม', mobile: 'ภาพรวม' },
  { id: 'ledger', desktop: 'รายรับ-รายจ่าย', mobile: 'รายการ' },
  { id: 'bills', desktop: 'บิลและเป้า', mobile: 'บิลและเป้า' },
  { id: 'portfolio', desktop: 'พอร์ตการลงทุน', mobile: 'พอร์ต' },
  { id: 'averaging', desktop: 'ถัวเฉลี่ยต้นทุน', mobile: 'ถัวเฉลี่ย' },
  { id: 'retirement', desktop: 'วางแผนเกษียณ', mobile: 'แผนเกษียณ' },
  { id: 'tax', desktop: 'คำนวณภาษี', mobile: 'ภาษี' },
  { id: 'account', desktop: 'โปรไฟล์', mobile: 'โปรไฟล์' },
] as const;

async function openApp(page: Page): Promise<void> {
  const external: string[] = [];
  page.on('request', (r) => {
    if (!/^(http:\/\/localhost:5199|data:|blob:|about:)/.test(r.url())) external.push(r.url());
  });
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto('/harness.html?seed=1');
  await expect(page.getByText('ข้าวมันไก่').first()).toBeVisible({ timeout: 20_000 });
  (page as unknown as { __external: string[] }).__external = external;
}

async function openView(page: Page, view: (typeof VIEWS)[number], mobile: boolean): Promise<void> {
  if (view.id === 'today') return;
  if (mobile) {
    await page.getByRole('button', { name: 'เมนู', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: view.mobile, exact: true }).first().click();
    await expect(dialog).toBeHidden();
  } else {
    await page.getByRole('navigation', { name: 'เมนูหลัก' }).getByRole('button', { name: view.desktop }).click();
  }
  await expect(page.locator('#main h2, #main h1').first()).toBeVisible();
  await page.waitForTimeout(300);
}

/** องค์ประกอบที่ backdrop-filter ทำงานอยู่ และตัวที่มีบรรพบุรุษ backdrop-filter ด้วย (ซ้อน) */
const blurAudit = (page: Page) =>
  page.evaluate(() => {
    const has = (el: Element) => {
      const v = getComputedStyle(el).backdropFilter;
      return v !== '' && v !== 'none';
    };
    const blurred = Array.from(document.querySelectorAll('*')).filter((el) => has(el) && el.getClientRects().length > 0); // นับเฉพาะที่แสดงอยู่ (display:none ไม่มีต้นทุน)
    const nested = blurred.filter((el) => {
      for (let p = el.parentElement; p; p = p.parentElement) if (has(p)) return true;
      return false;
    });
    const desc = (el: Element) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')}`;
    return { count: blurred.length, nested: nested.map(desc) };
  });

for (const theme of ['dark', 'light'] as const) {
  for (const w of [
    { width: 360, height: 740, mobile: true },
    { width: 1280, height: 800, mobile: false },
  ]) {
    test.describe(`aurora ${theme} ${w.width}px`, () => {
      test.use({ viewport: { width: w.width, height: w.height }, colorScheme: theme, locale: 'th-TH' });

      test('ทุกหน้า: ไม่มี blur ซ้อนกัน และมีจำนวนชั้น blur อยู่ในกรอบที่ตั้งไว้', async ({ page }) => {
        await openApp(page);
        const counts: Record<string, number> = {};
        for (const view of VIEWS) {
          await openView(page, view, w.mobile);
          const audit = await blurAudit(page);
          expect(audit.nested, `blur ซ้อนกันในหน้า ${view.id}`).toEqual([]);
          counts[view.id] = audit.count;
          // ชั้น blur ต่อหน้า (ทุกการ์ดที่มองเห็นรวมแถบเมนู): ไม่บวมเกินกรอบ (หน้าภาพรวมมากสุด)
          expect(audit.count, `จำนวนชั้น blur หน้า ${view.id}`).toBeLessThanOrEqual(w.mobile ? 10 : 22);
        }
      });

      test('พื้นหลังออโรราเป็น CSS gradient ล้วน อยู่หลังเนื้อหา ไม่มีรูปและไม่มีคำขอออกนอกเครื่อง', async ({ page }) => {
        await openApp(page);
        const info = await page.evaluate(() => {
          const root = document.querySelector('.aurora') as HTMLElement;
          const cs = getComputedStyle(root);
          const parts = Array.from(root.children).map((el) => getComputedStyle(el));
          return {
            position: cs.position,
            z: cs.zIndex,
            events: cs.pointerEvents,
            images: parts.map((p) => p.backgroundImage),
            filters: parts.map((p) => p.filter),
            hidden: root.getAttribute('aria-hidden'),
          };
        });
        expect(info.position).toBe('fixed');
        expect(info.z).toBe('-1');
        expect(info.events).toBe('none');
        expect(info.hidden).toBe('true');
        for (const img of info.images) {
          expect(img).toContain('gradient');
          expect(img).not.toContain('url(');
        }
        for (const f of info.filters) expect(f, 'ห้ามใช้ filter (แพง)').toBe('none');
        expect((page as unknown as { __external: string[] }).__external).toEqual([]);
      });

      test('การ์ดหน้าโปร่งแสงจริง (มี blur + พื้นไม่ทึบ) ส่วนรายการ/ตาราง (solid) ยังทึบ', async ({ page }) => {
        await openApp(page);
        const res = await page.evaluate(() => {
          const alphaOf = (el: Element) => {
            const bg = getComputedStyle(el).backgroundColor;
            const m = /rgba?\(([^)]+)\)/.exec(bg);
            const p = m ? m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number) : [0, 0, 0, 0];
            return p.length > 3 ? p[3]! : 1;
          };
          const blurOf = (el: Element) => getComputedStyle(el).backdropFilter;
          const lite = document.querySelector('.glass-lite.card:not(.sankey)') ?? document.querySelector('.glass-lite');
          const glass = document.querySelector('article.glass.card');
          const solid = document.querySelector('.solid.card') ?? document.querySelector('.solid');
          return {
            lite: lite ? { blur: blurOf(lite), alpha: alphaOf(lite) } : null,
            glass: glass ? { blur: blurOf(glass) } : null,
            solid: solid ? { blur: blurOf(solid), alpha: alphaOf(solid) } : null,
          };
        });
        expect(res.lite!.blur).toContain('blur(');
        expect(res.glass!.blur).toContain('blur(');
        expect(res.solid!.blur).toBe('none');
        expect(res.solid!.alpha, 'รายการ/ตารางยังทึบเกือบเต็ม').toBeGreaterThanOrEqual(0.88);
      });
    });
  }
}

test.describe('การขยับของพื้นหลังออโรรา', () => {
  test.describe('คอม (มีเมาส์) ปกติ', () => {
    test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' });
    test('ขยับช้ามาก (≥ 100 วินาทีต่อรอบ) ด้วย transform เท่านั้น', async ({ page }) => {
      await openApp(page);
      const anim = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.aurora > *')).map((el) => {
          const cs = getComputedStyle(el);
          return { name: cs.animationName, dur: parseFloat(cs.animationDuration), timing: cs.animationTimingFunction };
        }),
      );
      expect(anim.length).toBe(5);
      for (const a of anim) {
        expect(a.name).toMatch(/^aurora-/);
        expect(a.dur, 'ระยะเวลาต่อรอบ (วินาที)').toBeGreaterThanOrEqual(100);
        expect(a.timing, 'ขยับเป็นขั้นช้ามาก (steps) ไม่ให้ blur ถูกคำนวณใหม่ทุกเฟรม').toMatch(/^steps\(/);
      }
      const css = await page.evaluate(() =>
        Array.from(document.styleSheets).flatMap((s) => Array.from(s.cssRules)).filter((r) => r instanceof CSSKeyframesRule && r.name.startsWith('aurora-')).map((r) => (r as CSSKeyframesRule).cssText),
      );
      expect(css.length).toBe(5);
      for (const k of css) expect(k.replace(/@keyframes [\w-]+ \{/, '').match(/[a-z-]+(?=:)/g)!.every((p) => p === 'transform')).toBe(true);
    });
  });

  test.describe('คอม: หยุดชั่วคราวระหว่างเลื่อนหน้า', () => {
    test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' });
    test('เลื่อนหน้าแล้วพื้นหลังหยุด เลิกเลื่อนแล้วขยับต่อ', async ({ page }) => {
      await openApp(page);
      const state = () => page.evaluate(() => getComputedStyle(document.querySelector('.aurora-violet')!).animationPlayState);
      expect(await state()).toBe('running');
      await page.evaluate(() => window.scrollTo(0, 400));
      await expect.poll(state).toBe('paused');
      await expect.poll(state, { timeout: 3000 }).toBe('running');
    });
  });

  test.describe('คอม: เครื่องช้า', () => {
    test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' });
    test('เลื่อนหน้าแล้วเฟรมช้ามาก (CPU ช้าลง 12 เท่า) → ตัวป้องกันปิด blur ของการ์ดหน้า (glass-lite) แต่การ์ดยังโปร่งแสง', async ({ page }) => {
      await openApp(page);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 12 });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            let y = 0;
            const t0 = performance.now();
            const tick = (now: number) => {
              y = (y + 14) % 600;
              window.scrollTo(0, y);
              if (now - t0 < 4000) requestAnimationFrame(tick);
              else resolve();
            };
            requestAnimationFrame(tick);
          }),
      );
      await expect(page.locator('html')).toHaveAttribute('data-lite', '');
      const res = await page.evaluate(() => {
        const el = document.querySelector('.glass-lite.card:not(.sankey)')!;
        const cs = getComputedStyle(el);
        const m = /rgba?(([^)]+))/.exec(cs.backgroundColor);
        return { blur: cs.backdropFilter, bg: m ? m[1] : '' };
      });
      expect(res.blur).toBe('none');
      expect(res.bg).not.toBe('');
    });
  });

  test.describe('ลดการเคลื่อนไหว', () => {
    test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    test('พื้นหลังหยุดนิ่ง', async ({ page }) => {
      await openApp(page);
      const names = await page.evaluate(() => Array.from(document.querySelectorAll('.aurora > *')).map((el) => getComputedStyle(el).animationName));
      for (const n of names) expect(n).toBe('none');
    });
  });

  test.describe('มือถือ (ไม่มีเมาส์)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'no-preference' });
    test('พื้นหลังนิ่ง (ไม่ต้องคำนวณ blur ใหม่ทุกเฟรมตอนเลื่อน) แต่ยังมีก้อนแสงครบ', async ({ page }) => {
      await openApp(page);
      const res = await page.evaluate(() => ({
        names: Array.from(document.querySelectorAll('.aurora > *')).map((el) => getComputedStyle(el).animationName),
        blobs: document.querySelectorAll('.aurora-blob').length,
        topbarBlur: getComputedStyle(document.querySelector('.topbar')!).backdropFilter,
      }));
      for (const n of res.names) expect(n).toBe('none');
      expect(res.blobs).toBe(4);
      expect(res.topbarBlur, 'แถบหัวหน้าบนมือถือไม่ blur').toBe('none');
    });
  });
});
