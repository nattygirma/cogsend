import { showToast } from '#lib/components/toast.svelte.js';
import { shrinkToFit, makePreview, makeJpegCopy } from '#lib/components/shrink-image.js';
import {
	X_MAX_IMAGE_BYTES,
	LINKEDIN_MAX_IMAGE_BYTES,
	THREADS_MAX_IMAGE_BYTES,
	X_MAX_GIF_BYTES,
	MAX_VIDEO_BYTES,
	imageOverCap
} from '#lib/domain/media-limits.js';
import type { MediaItem, VideoJob } from '../types';
import { prepareVideo, VideoPrepareError } from '#lib/components/video/prepare.js';
import { uploadVideo } from '#lib/components/video/upload.js';
import {
	firstVideoError,
	factsOfMedia,
	type PlatformFit,
	fitByPlatform
} from '#lib/domain/video-rules.js';
import { supportsThreads } from '#lib/domain/platforms.js';
import type { Composer } from './composer';
import { field, provide } from './expose';

/** Attaching images and videos, covers, and what each platform makes of them. */
export interface MediaUploadApi {
	readonly attachFilesToSegment: (segmentIndex: number, files: File[]) => Promise<void>;
	readonly cardFit: (index: number) => PlatformFit[];
	readonly chooseCover: (jpeg: Blob, atMs: number | null) => Promise<void>;
	readonly fitErrorPlatforms: Set<string>;
	readonly fitProblems: (list: MediaItem[], threadWide: boolean) => PlatformFit[];
	readonly isVideoItem: (m: { mime?: string | null | undefined }) => boolean;
	readonly jobsFor: (segmentIndex: number) => VideoJob[];
	readonly mediaSrc: (m: MediaItem) => string;
	readonly removeCover: () => Promise<void>;
	readonly videoProblem: string | null;
}

export function useMediaUpload(ed: Composer): void {
	async function attachFilesToSegment(segmentIndex: number, files: File[]) {
		if (ed.editLocked) return;
		const picked = files.filter((f) => ed.isMediaFile(f.type));
		if (!picked.length) {
			showToast('Only images (PNG, JPEG, WebP, GIF) and videos are supported', 'warn');
			return;
		}
		const videoFiles = picked.filter((f) => f.type.startsWith('video/'));
		if (videoFiles.length) {
			if (picked.length > 1) {
				showToast('Attach a video on its own — a post takes one video and no images', 'warn');
				return;
			}
			const onSegment =
				ed.media.some((m) => (m.segmentIndex ?? 0) === segmentIndex) ||
				ed.videoJobs.some((job) => job.segmentIndex === segmentIndex);
			if (onSegment) {
				showToast(
					'A video needs a post of its own — remove what is attached, or add a post to the thread',
					'warn'
				);
				return;
			}
			void attachVideo(segmentIndex, videoFiles[0]);
			return;
		}
		if (ed.videoJobs.some((job) => job.segmentIndex === segmentIndex)) {
			showToast('Videos cannot mix with images on the same post', 'warn');
			return;
		}
		// Shrink to X's cap, the strictest one, whatever is selected now:
		// the file is stored once and may be published anywhere later.
		ed.uploadingSegment = segmentIndex;
		const images: File[] = [];
		for (const f of picked) images.push(await shrinkToFit(f, X_MAX_IMAGE_BYTES));
		const linkedinSelected = ed.connections.some(
			(c) => ed.selected.has(c.id) && c.platform === 'linkedin'
		);
		const threadsSelected = ed.connections.some(
			(c) => ed.selected.has(c.id) && c.platform === 'threads'
		);
		const xSelected = ed.connections.some((c) => ed.selected.has(c.id) && c.platform === 'x');
		const webpSelected = images.some((f) => f.type === 'image/webp') && linkedinSelected;
		const overLinkedin = images.filter((f) => f.size > LINKEDIN_MAX_IMAGE_BYTES);
		const advisories: string[] = [];
		if (overLinkedin.length && linkedinSelected) {
			advisories.push(`${overLinkedin[0].name} is over LinkedIn's 8MB image cap.`);
		}
		if (webpSelected) {
			advisories.push(
				'WebP images are rejected by LinkedIn — use JPEG, PNG, or GIF, or uncheck LinkedIn.'
			);
		}
		const threadsBadType =
			threadsSelected && images.some((f) => f.type !== 'image/jpeg' && f.type !== 'image/png');
		const threadsOversize = threadsSelected && images.some((f) => f.size > THREADS_MAX_IMAGE_BYTES);
		if (threadsBadType) {
			advisories.push('Threads takes JPEG/PNG images only — others stay on your other accounts.');
		}
		if (threadsOversize) {
			advisories.push("An image is over Threads' 8MB cap — compress it or uncheck Threads.");
		}
		const xBadType =
			xSelected &&
			images.some(
				(f) =>
					f.type !== 'image/jpeg' &&
					f.type !== 'image/png' &&
					f.type !== 'image/gif' &&
					f.type !== 'image/webp'
			);
		const xOversize =
			xSelected &&
			images.some((f) =>
				f.type === 'image/gif' ? f.size > X_MAX_GIF_BYTES : f.size > X_MAX_IMAGE_BYTES
			);
		if (xBadType) {
			advisories.push('X takes JPEG/PNG/GIF/WebP images only.');
		}
		if (xOversize) {
			advisories.push("An image is over X's 5MB cap (15MB for GIFs) — compress it or uncheck X.");
		}
		if (advisories.length) showToast(advisories[0], 'warn');
		ed.uploadingSegment = segmentIndex;
		const generation = ed.editorGeneration;
		try {
			const id = await ed.persistAll(true);
			if (!id) throw new Error('Could not create draft for upload');
			const form = new FormData();
			form.set('segmentIndex', String(segmentIndex));
			for (const [n, f] of images.entries()) {
				form.append('files', f);
				const preview = await makePreview(f);
				if (preview) form.append(`preview-${n}`, preview, 'preview.jpg');
				const jpeg = await makeJpegCopy(f);
				if (jpeg) form.append(`jpeg-${n}`, jpeg, 'copy.jpg');
			}
			const res = await fetch(`/api/drafts/${id}/media`, { method: 'POST', body: form });
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Upload failed');
			const items: MediaItem[] = Array.isArray(data.items)
				? data.items
				: data.media
					? Array.isArray(data.media)
						? data.media
						: [data.media]
					: [];
			// Left for another post mid-upload: the images belong to the one
			// they were sent with, which keeps them.
			if (generation !== ed.editorGeneration) return;
			ed.media = [
				...ed.media,
				...items.map((it) => ({ ...it, segmentIndex: it.segmentIndex ?? segmentIndex }))
			];
			showToast(
				items.length === 1 ? 'Image attached' : `${items.length} images attached`,
				'success'
			);
		} catch (e) {
			showToast(e instanceof Error ? e.message : 'Upload failed', 'error');
		} finally {
			ed.uploadingSegment = null;
		}
	}

	function updateVideoJob(id: string, patch: Partial<VideoJob>) {
		ed.videoJobs = ed.videoJobs.map((job) => (job.id === id ? { ...job, ...patch } : job));
	}

	/**
	 * Prepare the video in the browser (convert it when a platform would refuse
	 * it as it is), upload it in parts, then keep a frame as its cover so Posts
	 * and the platforms that take one have something to show.
	 */
	async function attachVideo(segmentIndex: number, file: File) {
		const job: VideoJob = {
			id: crypto.randomUUID(),
			segmentIndex,
			phase: 'reading',
			progress: 0,
			controller: new AbortController()
		};
		ed.videoJobs = [...ed.videoJobs, job];
		const generation = ed.editorGeneration;
		const signal = job.controller.signal;
		try {
			const prepared = await prepareVideo(file, {
				signal,
				onProgress: (phase, fraction) => updateVideoJob(job.id, { phase, progress: fraction })
			});
			if (prepared.file.size > MAX_VIDEO_BYTES) {
				throw new Error(
					`Videos can be up to ${MAX_VIDEO_BYTES / 1_000_000} MB — this one is ${Math.round(prepared.file.size / 1_000_000)} MB. Trim it or export it smaller.`
				);
			}
			if (signal.aborted) return;
			const id = await ed.persistAll(true);
			if (!id) throw new Error('Could not create draft for upload');
			if (signal.aborted || generation !== ed.editorGeneration) return;
			updateVideoJob(job.id, { phase: 'uploading', progress: 0 });
			const item = await uploadVideo<MediaItem>(id, {
				file: prepared.file,
				segmentIndex,
				signal,
				onProgress: (fraction) => updateVideoJob(job.id, { progress: fraction })
			});
			if (generation !== ed.editorGeneration) return;
			ed.media = [...ed.media, { ...item, segmentIndex: item.segmentIndex ?? segmentIndex }];
			showToast('Video attached', 'success');
			if (prepared.poster) {
				await saveCover(item.id, prepared.poster, null).catch(() => {});
			}
		} catch (e) {
			if (signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
				if (generation === ed.editorGeneration) showToast('Video upload cancelled', 'warn');
				return;
			}
			const message =
				e instanceof VideoPrepareError || e instanceof Error ? e.message : 'Upload failed';
			showToast(message, 'error');
		} finally {
			ed.videoJobs = ed.videoJobs.filter((j) => j.id !== job.id);
		}
	}

	async function saveCover(mediaId: string, jpeg: Blob, atMs: number | null) {
		if (!ed.draftId) return;
		const query = new URLSearchParams({ mediaId });
		if (atMs !== null) query.set('atMs', String(atMs));
		const res = await fetch(`/api/drafts/${ed.draftId}/media/cover?${query}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'image/jpeg' },
			body: jpeg
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(data.error || 'Could not save the cover');
		const meta = (data.media as MediaItem | undefined)?.meta ?? null;
		ed.media = ed.media.map((m) => (m.id === mediaId ? { ...m, meta } : m));
	}

	async function chooseCover(jpeg: Blob, atMs: number | null) {
		const mediaId = ed.coverFor;
		if (!mediaId || ed.coverBusy) return;
		ed.coverBusy = true;
		try {
			await saveCover(mediaId, jpeg, atMs);
			ed.coverFor = null;
			showToast('Cover saved', 'success');
		} catch (e) {
			showToast(e instanceof Error ? e.message : 'Could not save the cover', 'error');
		} finally {
			ed.coverBusy = false;
		}
	}

	async function removeCover() {
		const mediaId = ed.coverFor;
		if (!mediaId || !ed.draftId || ed.coverBusy) return;
		ed.coverBusy = true;
		try {
			const res = await fetch(
				`/api/drafts/${ed.draftId}/media/cover?${new URLSearchParams({ mediaId })}`,
				{ method: 'DELETE' }
			);
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Could not remove the cover');
			const meta = (data.media as MediaItem | undefined)?.meta ?? null;
			ed.media = ed.media.map((m) => (m.id === mediaId ? { ...m, meta } : m));
			ed.coverFor = null;
		} catch (e) {
			showToast(e instanceof Error ? e.message : 'Could not remove the cover', 'error');
		} finally {
			ed.coverBusy = false;
		}
	}

	const jobsFor = (segmentIndex: number) =>
		ed.videoJobs.filter((job) => job.segmentIndex === segmentIndex);
	const isVideoItem = (m: { mime?: string | null }) => (m.mime || '').startsWith('video/');
	const mediaSrc = (m: MediaItem) =>
		m.previewUrl || `/api/media/${encodeURIComponent(m.storageKey)}`;
	/** Each selected account with the limits it is held to. */
	const selectedVideoAccounts = $derived(
		ed.connections
			.filter((c) => ed.selected.has(c.id))
			.map((c) => ({ platform: c.platform, meta: c.metaJson ?? null }))
	);
	// The first rule a selected account would refuse an attached video for;
	// Publish and Schedule stop on it like on an over-limit image.
	const videoProblem = $derived.by(() => {
		for (const m of ed.media) {
			if (!isVideoItem(m)) continue;
			for (const account of selectedVideoAccounts) {
				const message = firstVideoError(account.platform, factsOfMedia(m), account.meta);
				if (message) return message;
			}
		}
		return null;
	});

	/**
	 * Every platform that would refuse what is attached to `list`, one row
	 * each, for the line under the media. `threadWide` adds the rules of the
	 * platforms that flatten the thread (LinkedIn, Instagram), shown once,
	 * under the first card that has media, or the first card when none has.
	 */
	function fitProblems(list: MediaItem[], threadWide: boolean): PlatformFit[] {
		const rows = new Map<string, PlatformFit>();
		for (const m of list) {
			if (!isVideoItem(m)) continue;
			for (const row of fitByPlatform(selectedVideoAccounts, factsOfMedia(m))) {
				if (!rows.has(row.platform)) rows.set(row.platform, row);
			}
		}
		const images = list.filter((m) => !isVideoItem(m));
		for (const platform of ed.selectedPlatforms) {
			const over = imageOverCap(platform, images);
			if (over && !rows.has(platform))
				rows.set(platform, { platform, level: 'error', message: over });
		}
		if (threadWide && ed.linkedinMediaProblem && !rows.has('linkedin')) {
			rows.set('linkedin', {
				platform: 'linkedin',
				level: 'error',
				message: ed.linkedinMediaProblem
			});
		}
		if (threadWide && ed.instagramMediaProblem && !rows.has('instagram')) {
			rows.set('instagram', {
				platform: 'instagram',
				level: 'error',
				message: ed.instagramMediaProblem
			});
		}
		return [...rows.values()];
	}

	const firstMediaCard = $derived(ed.media.length ? Math.min(...ed.mediaBySegment.keys()) : 0);

	function cardFit(index: number): PlatformFit[] {
		const list = ed.cardMedia(index);
		const flattened = ed.activeTab !== 'global' && !supportsThreads(ed.activeTab);
		return fitProblems(list, flattened || index === firstMediaCard);
	}

	// Platforms some attachment would be refused by, marked on their accounts.
	const fitErrorPlatforms = $derived(
		new Set(
			fitProblems(ed.media, true)
				.filter((r) => r.level === 'error')
				.map((r) => r.platform)
		)
	);

	field(ed, 'fitErrorPlatforms', () => fitErrorPlatforms);
	field(ed, 'videoProblem', () => videoProblem);
	provide(ed, {
		attachFilesToSegment,
		cardFit,
		chooseCover,
		fitProblems,
		isVideoItem,
		jobsFor,
		mediaSrc,
		removeCover
	});
}
