import { describe, expect, it } from 'vitest';
import {
	accountLabel,
	displayHandle,
	displayHost,
	isPlatformId,
	PLATFORM_ORDER,
	platformRank,
	PREVIEW_PRIORITY,
	supportsThreads
} from '#lib/domain/platforms.js';

describe('platforms', () => {
	it('recognizes the platform ids, and not removed ones', () => {
		expect(isPlatformId('mastodon')).toBe(false);
		expect(isPlatformId('bluesky')).toBe(false);
		expect(isPlatformId('linkedin')).toBe(true);
		expect(isPlatformId('threads')).toBe(true);
		expect(isPlatformId('instagram')).toBe(true);
		expect(isPlatformId('x')).toBe(true);
		expect(isPlatformId('twitter')).toBe(false);
	});

	it('x and threads support threads', () => {
		expect(supportsThreads('x')).toBe(true);
		expect(supportsThreads('threads')).toBe(true);
		expect(supportsThreads('linkedin')).toBe(false);
		expect(supportsThreads('instagram')).toBe(false);
	});

	it('preview priority covers every platform exactly once', () => {
		expect([...PREVIEW_PRIORITY].sort()).toEqual([
			'facebook',
			'instagram',
			'linkedin',
			'threads',
			'tiktok',
			'x',
			'youtube'
		]);
	});

	it('orders X first, then the Meta platforms, the video platforms, linkedin', () => {
		expect([...PLATFORM_ORDER]).toEqual([
			'x',
			'threads',
			'instagram',
			'facebook',
			'youtube',
			'tiktok',
			'linkedin'
		]);
		expect(platformRank('x')).toBe(0);
		expect(platformRank('linkedin')).toBe(6);
		expect(platformRank('unknown')).toBe(99);
	});
});

describe('displayHandle', () => {
	it('strips the generic .bsky.social suffix', () => {
		expect(displayHandle('testuser.bsky.social')).toBe('testuser');
		expect(displayHandle('TestUser.BSKY.SOCIAL')).toBe('TestUser');
	});

	it('leaves custom domains and other handles alone', () => {
		expect(displayHandle('name.com')).toBe('name.com');
		expect(displayHandle('@TestUsers')).toBe('@TestUsers');
		expect(displayHandle('testuser')).toBe('testuser');
	});

	it('handles empty values', () => {
		expect(displayHandle(null)).toBe('');
		expect(displayHandle(undefined)).toBe('');
		expect(displayHandle('')).toBe('');
	});
});

describe('displayHost', () => {
	it('strips protocol and trailing slash', () => {
		expect(displayHost('https://social.example')).toBe('social.example');
		expect(displayHost('http://social.example/')).toBe('social.example');
		expect(displayHost('social.example')).toBe('social.example');
	});

	it('handles empty values', () => {
		expect(displayHost(null)).toBe('');
		expect(displayHost(undefined)).toBe('');
	});
});

describe('accountLabel', () => {
	it('shows the full value once when name and handle match', () => {
		expect(accountLabel('testuser.bsky.social', 'testuser.bsky.social')).toBe(
			'testuser.bsky.social'
		);
	});

	it('joins distinct names and short handles', () => {
		expect(accountLabel('TestUser', '@testuser')).toBe('TestUser · @testuser');
		expect(accountLabel('Test User', 'test@example.com')).toBe('Test User · test@example.com');
	});

	it('omits a handle that repeats the name', () => {
		expect(accountLabel('testuser', 'testuser.bsky.social')).toBe('testuser');
		expect(accountLabel('TestUser', null)).toBe('TestUser');
	});

	it('falls back to handle or empty', () => {
		expect(accountLabel(null, 'testuser.bsky.social')).toBe('testuser');
		expect(accountLabel(null, null)).toBe('');
	});

	it('qualifies bare usernames to @user@host', () => {
		expect(accountLabel('TestUser', 'testuser', 'https://social.example')).toBe(
			'TestUser · @testuser@social.example'
		);
		expect(accountLabel('testuser', 'testuser', 'https://social.example')).toBe(
			'@testuser@social.example'
		);
	});

	it('leaves already-qualified handles alone', () => {
		expect(accountLabel('Name', 'user@remote.social', 'https://social.example')).toBe(
			'Name · user@remote.social'
		);
	});
});
