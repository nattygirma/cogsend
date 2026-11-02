import type { PlatformId } from '#lib/domain/platform-sync.js';
import type { TargetSnapshot } from '#lib/domain/post-state.js';
import type { VideoRuleMeta } from '#lib/domain/video-rules.js';

export type Connection = {
	id: string;
	platform: string;
	handle: string | null;
	displayName: string | null;
	avatarUrl?: string | null;
	status?: string;
	metaJson?: { maxCharacters?: number } & VideoRuleMeta;
};

export type MediaItem = {
	id: string;
	storageKey: string;
	mime: string;
	size?: number;
	width?: number | null;
	height?: number | null;
	altText: string | null;
	segmentIndex?: number;
	previewUrl?: string;
	/** A video's facts and chosen cover, as the server read them. */
	meta?: {
		durationMs?: number | null;
		videoCodec?: string | null;
		fps?: number | null;
		faststart?: boolean | null;
		cover?: { v: number; atMs?: number } | null;
		/** A JPEG copy of a PNG or WebP is stored for Instagram. */
		jpeg?: { v: number } | null;
	} | null;
};

/** A video being prepared or uploaded; it becomes a MediaItem when done. */
export type VideoJob = {
	id: string;
	segmentIndex: number;
	phase: 'reading' | 'converting' | 'uploading';
	progress: number;
	controller: AbortController;
};

export type ActiveTab = 'global' | PlatformId;

export type EditorDraft = {
	id: string;
	baseBody?: string | null;
	selectedConnectionIds?: string[] | null;
	variants?: Array<{
		platform: string;
		body?: string | null;
		optionsJson?: Record<string, unknown>;
	}>;
	media?: MediaItem[];
	targets?: TargetSnapshot[];
};
