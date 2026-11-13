/**
 * How an agent attaches a local file. MCP carries no files, so the bytes go to
 * the REST API with the same key; these are the exact commands, so an agent
 * never has to guess request shapes. Shown in the tool descriptions and as the
 * server's instructions.
 */
export function mediaHelpFor(origin: string): string {
	return (
		'To attach a local image or video, create the draft first, then upload with the same API key ' +
		'(MCP itself carries no files). ' +
		`Video (MP4, up to 100 MB), one command: curl -sS -T clip.mp4 -H "Authorization: Bearer $POSTEASY_API_KEY" ` +
		`"${origin}/api/drafts/<draftId>/media/video" — the body is the raw file; add ?segmentIndex=N for another card ` +
		'and &altText=... if wanted. ' +
		`Images (JPEG, PNG, WebP or GIF, up to 16 MB, 4 per card): curl -sS -H "Authorization: Bearer $POSTEASY_API_KEY" ` +
		`-F "files=@photo.jpg" -F "segmentIndex=0" "${origin}/api/drafts/<draftId>/media". ` +
		'Both answer 201 with the stored media; get_draft shows it. A video must be the only media on its card. ' +
		'Then publish_draft or schedule_draft.'
	);
}

export function uploadInstructions(origin: string): string {
	return (
		'PostEasy drafts and schedules social posts. Flow: list_connections to find account ids, ' +
		'create_draft, attach media if any, then schedule_draft (runAt in ISO UTC) or publish_draft, ' +
		'and list_queue to see whether it went out. ' +
		mediaHelpFor(origin)
	);
}
