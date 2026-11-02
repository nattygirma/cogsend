/**
 * Brand marks for the platforms, in one place.
 *
 * Two components drew these: `SocialIcon` (accounts, queue) and `PlatformLogo`
 * (the composer's platform picker). One path was duplicated byte for
 * byte, LinkedIn and Threads had drifted into two different drawings of the same
 * logo, and their fallbacks disagreed — `PlatformLogo` documented "never another
 * brand's mark" for an unknown platform while `SocialIcon` answered with the
 * Bluesky logo. One map, one fallback: `null` means "no mark", and the caller
 * draws a neutral glyph.
 */
export const PLATFORM_MARKS: Record<string, string> = {
	bluesky:
		'M5.202 2.857C7.954 4.922 10.913 9.11 12 11.358c1.087-2.247 4.046-6.436 6.798-8.501C20.783 1.366 24 .213 24 3.883c0 .732-.42 6.156-.667 7.037-.856 3.061-3.978 3.842-6.755 3.37 4.854.826 6.089 3.562 3.422 6.299-5.065 5.196-7.28-1.304-7.847-2.97-.104-.305-.152-.448-.153-.327 0-.121-.05.022-.153.327-.568 1.666-2.782 8.166-7.847 2.97-2.667-2.737-1.432-5.473 3.422-6.3-2.777.473-5.899-.308-6.755-3.369C.42 10.04 0 4.615 0 3.883c0-3.67 3.217-2.517 5.202-1.026',
	x: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z',
	linkedin:
		'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z',
	threads:
		'M18.263 11.097c-.03-3.486-1.92-5.586-5.111-5.586-2.13 0-3.922.963-4.863 2.499l2.062 1.438c.535-.843 1.272-1.543 2.628-1.543 1.528 0 2.318.85 2.544 2.431a15 15 0 0 0-2.236-.173c-4.125 0-6.068 1.867-6.068 4.336s1.943 3.99 4.804 3.99c3.139 0 5.013-2.115 5.781-4.735.798.361 1.348 1.204 1.348 2.47 0 3.387-3.907 5.232-7.22 5.232-4.885 0-8.077-3.207-8.077-8.424 0-6.392 4.223-10.487 9.9-10.487 3.808 0 5.69 1.671 6.97 3.914l2.108-1.475C21.44 2.078 18.331 0 13.663 0 6.227 0 1.168 5.277 1.168 12.934c0 7 4.953 11.066 10.856 11.066 4.878 0 9.809-2.846 9.809-7.716 0-2.545-1.46-4.231-3.569-5.187m-6.33 4.855c-1.077 0-2.026-.512-2.026-1.453 0-1.483 1.822-1.934 3.606-1.934.678 0 1.34.045 1.927.173-.422 1.927-1.671 3.215-3.508 3.214Z',
	// Drawn here, not copied: the rounded frame, lens and dot, with the inner
	// outlines wound the other way so the default fill rule leaves them open.
	instagram:
		'M7 0h10a7 7 0 0 1 7 7v10a7 7 0 0 1-7 7H7a7 7 0 0 1-7-7V7a7 7 0 0 1 7-7zm0 2.16a4.84 4.84 0 0 0-4.84 4.84v10A4.84 4.84 0 0 0 7 21.84h10a4.84 4.84 0 0 0 4.84-4.84V7A4.84 4.84 0 0 0 17 2.16zM12 5.84a6.16 6.16 0 1 1 0 12.32 6.16 6.16 0 1 1 0-12.32zM12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8zm6.406-3.846a1.44 1.44 0 1 1 0 2.88 1.44 1.44 0 1 1 0-2.88z',
	// Drawn here like Instagram's: each frame with its cut-out wound the other
	// way, so the default fill rule leaves the play button, the f and the
	// note's ring open.
	youtube: 'M3 5h18a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zm7 4v6l5.2-3z',
	facebook:
		'M4 0h16a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4zm9.5 24V12H16l.5-3h-3V7.5Q13.5 6 15 6h2V3h-2q-4.5 0-4.5 4v2H8v3h2.5v12z',
	tiktok:
		'M12.5 1h3.2c.3 2.6 2 4.3 4.8 4.6v3.3c-1.8 0-3.4-.6-4.8-1.6V16a6 6 0 1 1-6-6v3.3A2.7 2.7 0 1 0 12.5 16z'
};

/** The path for a platform, or null when there is no mark for it. */
export function platformMark(platform: string | null | undefined): string | null {
	return PLATFORM_MARKS[String(platform ?? '').toLowerCase()] ?? null;
}
