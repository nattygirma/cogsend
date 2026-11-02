import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * The setup guide a new account lands on: channels, then an agent, then the
 * first post. Each test signs up its own account in a fresh context, so the
 * shared e2e account (which never saw the guide) is left alone.
 */

async function signUpFresh(browser: Browser, baseURL: string | undefined): Promise<Page> {
	const context = await browser.newContext({ baseURL });
	const page = await context.newPage();
	await page.goto('/login');
	const res = await page.request.post('/api/auth/signup', {
		headers: { origin: new URL(page.url()).origin },
		data: {
			email: `guide-${randomUUID().slice(0, 8)}@example.com`,
			password: `pw-${randomUUID()}`
		}
	});
	expect(res.status()).toBeLessThan(300);
	return page;
}

test('a new account walks through the guide and is not asked again', async ({
	browser,
	baseURL
}) => {
	const page = await signUpFresh(browser, baseURL);
	await page.goto('/');
	const modal = page.getByTestId('onboarding-modal');
	await expect(modal).toBeVisible();
	await expect(modal.getByRole('heading', { name: 'Connect your channels' })).toBeVisible();
	await expect(page.getByTestId('onboarding-channel-x')).toBeVisible();

	await page.getByTestId('onboarding-next').click();
	await expect(modal.getByRole('heading', { name: 'Connect your AI agent' })).toBeVisible();
	await modal.getByRole('tab', { name: 'Claude Code' }).click();
	await modal.getByRole('button', { name: 'Create API key' }).click();

	const key = (await page.getByTestId('onboarding-new-key').innerText()).trim();
	expect(key).toMatch(/^pe_/);
	const command = await page.getByTestId('onboarding-snippet-0').innerText();
	expect(command).toContain('claude mcp add --transport http posteasy');
	expect(command).toContain('/api/mcp');
	expect(command).toContain(key);

	await page.getByTestId('onboarding-next').click();
	await expect(modal.getByRole('heading', { name: "You're all set" })).toBeVisible();
	await modal.getByRole('button', { name: 'Go to dashboard' }).click();
	await expect(modal).toBeHidden();

	await page.reload();
	await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
	await expect(page.getByTestId('onboarding-modal')).toHaveCount(0);
	await expect(page.getByTestId('get-started-card')).toHaveCount(0);
	await page.context().close();
});

test('closing the guide stops it opening, and the dashboard still offers it', async ({
	browser,
	baseURL
}) => {
	const page = await signUpFresh(browser, baseURL);
	await page.goto('/');
	await expect(page.getByTestId('onboarding-modal')).toBeVisible();
	await page.getByRole('button', { name: 'Close setup guide' }).click();
	await expect(page.getByTestId('onboarding-modal')).toBeHidden();

	await page.reload();
	await expect(page.getByTestId('get-started-card')).toBeVisible();
	await expect(page.getByTestId('onboarding-modal')).toHaveCount(0);

	await page.getByTestId('get-started-card').click();
	await expect(page.getByTestId('onboarding-modal')).toBeVisible();
	await page.context().close();
});
