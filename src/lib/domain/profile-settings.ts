export type OnboardingStep = 1 | 2 | 3;

/**
 * The setup guide's progress. Absent for accounts that never saw it (the
 * first owner seeded from the terminal, accounts from before it existed), so
 * they are not interrupted; sign-up stores `{ step: 1, done: false }`.
 */
export interface OnboardingState {
	step: OnboardingStep;
	/** Finished: the guide no longer opens by itself or shows on the dashboard. */
	done: boolean;
	/** Closed with ×: it stops opening by itself, the dashboard still offers it. */
	dismissed?: boolean;
}

export interface ProfileSettings {
	/** Default selected account ids for new drafts (empty = all active). */
	defaultAccountIds: string[];
	/** Global profile picture URL (used in top navigation and editor main tab). */
	profilePictureUrl: string;
	onboarding?: OnboardingState;
}

export const DEFAULT_PROFILE_SETTINGS: ProfileSettings = {
	defaultAccountIds: [],
	profilePictureUrl: '',
	// Listed so a PATCH carrying it is written; undefined drops out of JSON.
	onboarding: undefined
};

/** A stored or submitted guide state, or null when it is not one. */
export function parseOnboarding(raw: unknown): OnboardingState | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const r = raw as Record<string, unknown>;
	if (r.step !== 1 && r.step !== 2 && r.step !== 3) return null;
	if (typeof r.done !== 'boolean') return null;
	if (r.dismissed !== undefined && typeof r.dismissed !== 'boolean') return null;
	return { step: r.step, done: r.done, ...(r.dismissed ? { dismissed: true } : {}) };
}

/** True while the guide should open by itself. */
export function onboardingAutoOpens(state: OnboardingState | null | undefined): boolean {
	return Boolean(state && !state.done && !state.dismissed);
}

export const PROFILE_PICTURE_URL_MAX = 2000;
export const DEFAULT_ACCOUNT_ID_MAX = 128;

function sanitizeAccountIds(ids: unknown): string[] {
	if (!Array.isArray(ids)) return [];
	return ids.filter(
		(id): id is string =>
			typeof id === 'string' && id.length > 0 && id.length <= DEFAULT_ACCOUNT_ID_MAX
	);
}

/** True when the value is a non-empty https URL within the length cap. */
export function isValidProfilePictureUrl(raw: unknown): boolean {
	if (typeof raw !== 'string') return false;
	const s = raw.trim();
	if (!s || s.length > PROFILE_PICTURE_URL_MAX) return false;
	try {
		return new URL(s).protocol === 'https:';
	} catch {
		return false;
	}
}

/** Stored values: invalid URLs become empty so the UI falls back. */
export function sanitizeProfilePictureUrl(raw: unknown): string {
	const s = typeof raw === 'string' ? raw.trim() : '';
	return isValidProfilePictureUrl(s) ? s : '';
}

/** Parse stored settings defensively: unknown fields and bad values fall back. */
export function parseProfileSettings(raw: unknown): ProfileSettings {
	if (typeof raw === 'string') {
		try {
			raw = JSON.parse(raw);
		} catch {
			return { ...DEFAULT_PROFILE_SETTINGS };
		}
	}
	if (!raw || typeof raw !== 'object') return { ...DEFAULT_PROFILE_SETTINGS };
	const r = raw as Record<string, unknown>;
	const onboarding = parseOnboarding(r.onboarding);
	return {
		defaultAccountIds: sanitizeAccountIds(r.defaultAccountIds),
		profilePictureUrl: sanitizeProfilePictureUrl(r.profilePictureUrl),
		...(onboarding ? { onboarding } : {})
	};
}

/** Validate a client-supplied settings payload. Returns normalized settings or an error. */
export function normalizeProfileSettings(
	input: unknown
): { ok: true; settings: ProfileSettings } | { ok: false; error: string } {
	if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid settings' };
	const r = input as Record<string, unknown>;
	if (r.defaultAccountIds !== undefined) {
		if (
			!Array.isArray(r.defaultAccountIds) ||
			r.defaultAccountIds.length > 50 ||
			r.defaultAccountIds.some(
				(id) => typeof id !== 'string' || id.length === 0 || id.length > DEFAULT_ACCOUNT_ID_MAX
			)
		) {
			return { ok: false, error: 'Invalid default accounts' };
		}
	}
	if (r.profilePictureUrl !== undefined) {
		if (typeof r.profilePictureUrl !== 'string') {
			return { ok: false, error: 'Invalid profile picture URL' };
		}
		const trimmed = r.profilePictureUrl.trim();
		if (trimmed.length > 0 && !isValidProfilePictureUrl(trimmed)) {
			return { ok: false, error: 'Invalid profile picture URL' };
		}
	}
	if (r.onboarding !== undefined && !parseOnboarding(r.onboarding)) {
		return { ok: false, error: 'Invalid onboarding state' };
	}
	return { ok: true, settings: parseProfileSettings(input) };
}
