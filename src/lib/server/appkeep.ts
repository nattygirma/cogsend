/**
 * Running on appkeep: appkeep signs people in, not this app. Every request it
 * forwards carries who is signed in as x-altstack-* headers, and it strips
 * those headers from anything a browser sends, so they are trusted here — but
 * only when env.appkeep is set. Anywhere else the same headers are just text a
 * client typed, and the app keeps its own login.
 */
import { randomHex } from '#lib/domain/bytes.js';
import { normalizeEmail } from '#lib/domain/credentials.js';
import type { SessionUser } from './auth';
import { findUserByEmail, sessionSettings } from './auth';
import { hashPassword } from './crypto';
import { newId, type AppDb } from './db/client';
import { users } from './db/schema';

export const APPKEEP_LOGIN = '/_altstack/login';
export const APPKEEP_LOGOUT = '/_altstack/logout';

export interface AppkeepIdentity {
	email: string;
	name: string | null;
	avatarUrl: string | null;
}

export function appkeepIdentity(headers: Headers): AppkeepIdentity | null {
	const email = normalizeEmail(headers.get('x-altstack-owner-email') ?? '');
	if (!email || !headers.get('x-altstack-owner-id')) return null;
	let name: string | null = null;
	try {
		name = decodeURIComponent(headers.get('x-altstack-owner-name') ?? '').trim() || null;
	} catch {
		// A malformed name is only cosmetic.
	}
	const avatar = headers.get('x-altstack-owner-avatar');
	return { email, name, avatarUrl: avatar && avatar.startsWith('https://') ? avatar : null };
}

/** Where appkeep's sign-in sends someone back to: the page they asked for. */
export function appkeepLoginUrl(path: string): string {
	return `${APPKEEP_LOGIN}?next=${encodeURIComponent(path)}`;
}

/**
 * The account behind an appkeep identity, created on its first visit. It gets
 * an unusable password: there is no login form on appkeep to use one with.
 */
export async function userForAppkeepIdentity(
	db: AppDb,
	identity: AppkeepIdentity
): Promise<SessionUser> {
	let row = await findUserByEmail(db, identity.email);
	if (!row) {
		const now = new Date();
		try {
			await db.insert(users).values({
				id: newId(),
				email: identity.email,
				passwordHash: await hashPassword(randomHex(32)),
				displayName: identity.name,
				// First visit starts on the setup guide, as a sign-up does.
				settingsJson: JSON.stringify({
					onboarding: { step: 1, done: false },
					...(identity.avatarUrl ? { profilePictureUrl: identity.avatarUrl } : {})
				}),
				createdAt: now,
				updatedAt: now
			});
		} catch {
			// Two first requests racing: the unique index kept one row.
		}
		row = await findUserByEmail(db, identity.email);
		if (!row) throw new Error('Could not create the account for this appkeep sign-in');
	}
	const settings = sessionSettings(row.settingsJson);
	return {
		id: row.id,
		email: row.email,
		timezone: row.timezone,
		totpEnabled: true,
		mfaVerified: true,
		displayName: row.displayName ?? identity.name,
		...settings,
		profilePictureUrl: settings.profilePictureUrl || identity.avatarUrl || ''
	};
}
