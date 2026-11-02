import { expect, test } from '@playwright/test';
import { E2E_ACCOUNT, clickUntilVisible } from './e2e-env';

test.beforeEach(async ({ page }) => {
	await page.goto('/compose');
	if (/\/login$/.test(page.url().replace(/^https?:\/\/[^/]+/, ''))) {
		await page.getByLabel('Email').fill(E2E_ACCOUNT.email);
		await page.getByLabel('Password', { exact: true }).fill(E2E_ACCOUNT.password);
		await page.getByRole('button', { name: 'Sign in' }).click();
		await expect(page).toHaveURL(/\/$/, { timeout: 20000 });
	}
});

/** Where focus currently is, as a readable label. */
const activeLabel = (page: import('@playwright/test').Page) =>
	page.evaluate(() => {
		const el = document.activeElement as HTMLElement | null;
		if (!el) return '(none)';
		return el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 40) || el.tagName;
	});

test('menus take arrow keys and hand focus back to their trigger', async ({ page }) => {
	// A real "update available" line would come first in the menu; this spec is about keys.
	await page.route('**/api/release*', (route) =>
		route.fulfill({
			json: { current: '0.0.0', latest: null, updateAvailable: false, checkedAt: null }
		})
	);
	await page.goto('/posts');
	const trigger = page.getByRole('button', { name: 'Profile menu' });
	const menu = page.locator('#profile-menu');
	await clickUntilVisible(page, trigger, menu);

	// Opening moves focus into the menu, and arrows walk the items.
	await expect.poll(() => activeLabel(page)).toContain('Account');
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => activeLabel(page)).toContain('Settings');
	await page.keyboard.press('ArrowUp');
	await expect.poll(() => activeLabel(page)).toContain('Account');
	await page.keyboard.press('End');
	await expect.poll(() => activeLabel(page)).toContain('Sign out');

	// Escape closes and restores focus, instead of dropping it on <body>.
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
	await expect.poll(() => activeLabel(page)).toBe('Profile menu');
});

test('the connect dialog traps Tab and restores focus on close', async ({ page }) => {
	await page.goto('/accounts');
	const opener = page.getByRole('button', { name: 'Connect new' });
	const dialog = page.getByRole('dialog');
	await clickUntilVisible(page, opener, dialog);

	// Tabbing past the last control must stay inside the dialog.
	for (let i = 0; i < 12; i++) {
		await page.keyboard.press('Tab');
		const inside = await page.evaluate(() => {
			const active = document.activeElement;
			const dialogEl = document.querySelector('[role="dialog"]');
			return Boolean(active && dialogEl && dialogEl.contains(active));
		});
		expect(inside).toBe(true);
	}

	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect.poll(() => activeLabel(page)).toBe('Connect new');
});

test('a posts tab keeps focus on itself when it switches the list', async ({ page }) => {
	await page.goto('/posts');
	// Opening the menu proves the app is hydrated: before that, a tab click is
	// a full page load, which resets focus by design.
	const trigger = page.getByRole('button', { name: 'Profile menu' });
	await clickUntilVisible(page, trigger, page.locator('#profile-menu'));
	await page.keyboard.press('Escape');

	// Focus is read once the switch has rendered and SvelteKit has finished
	// with it, so a reset to <body> (data-sveltekit-reset unset) cannot slip by.
	const switchTo = async (tab: string) => {
		const link = page.locator(`a[data-tab="${tab}"]`);
		await link.click();
		await expect(page).toHaveURL(new RegExp(`[?&]tab=${tab}`));
		await expect(link).toHaveAttribute('aria-current', 'page');
		await page.evaluate(
			() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
		);
		return page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.tab ?? null);
	};
	expect(await switchTo('scheduled')).toBe('scheduled');
	expect(await switchTo('drafts')).toBe('drafts');
});
