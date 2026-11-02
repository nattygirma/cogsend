/**
 * Meta's Graph API error body, shared by Instagram and Facebook: both
 * classify failures by Meta's numeric code, never by its text, because the
 * "missing permissions" boilerplate also appears in invalid-parameter errors.
 */
export function parseMetaError(body: string): {
	code?: number;
	subcode?: number;
	message?: string;
} {
	try {
		const err = (
			JSON.parse(body) as {
				error?: {
					code?: unknown;
					error_subcode?: unknown;
					error_user_msg?: unknown;
					message?: unknown;
				};
			}
		)?.error;
		if (!err || typeof err !== 'object') return {};
		const userMessage = typeof err.error_user_msg === 'string' ? err.error_user_msg : undefined;
		return {
			...(typeof err.code === 'number' ? { code: err.code } : {}),
			...(typeof err.error_subcode === 'number' ? { subcode: err.error_subcode } : {}),
			...(userMessage || typeof err.message === 'string'
				? { message: userMessage || (err.message as string) }
				: {})
		};
	} catch {
		return {};
	}
}
