import { flattenThreadBody } from '#lib/domain/thread-segments.js';
import { effectivePlatformBody, type PlatformId } from '#lib/domain/platform-sync.js';
import { requiredSettingsByPlatform, composeChecks } from '../checks';
import { displayHandle, platformName } from '#lib/domain/platforms.js';
import { initialsOf } from '#lib/components/initials.js';
import { showToast } from '#lib/components/toast.svelte.js';
import type { ComposeCheck } from '../checks';
import type { Composer } from './composer';
import { field, provide } from './expose';

/** What the panes show: settings, preview, checks and the footer labels. */
export interface ComposerViewApi {
	/** Problems stay quiet while the post is being written and show once the
	 *  person first tries to publish or schedule it. */
	checksRevealed: boolean;
	readonly composeCheckList: ComposeCheck[];
	readonly hasPlatformSettings: boolean;
	readonly insertText: (index: number, text: string) => void;
	readonly previewIdentity: { name: string; avatarUrl: string | null; initials: string };
	previewOpen: boolean;
	readonly requiredSettings: Partial<Record<'youtube' | 'tiktok', number>>;
	readonly saveAsDraft: () => Promise<void>;
	readonly scheduleButtonLabel: string | null;
	settingsOpen: boolean;
	readonly settingsPlatforms: ('youtube' | 'tiktok')[];
	readonly uncheckPlatform: (platform: string) => void;
	readonly youtubeText: string;
}

export function useComposerView(ed: Composer): void {
	const youtubeText = $derived(
		flattenThreadBody(effectivePlatformBody(ed.baseBody, ed.overrides, 'youtube'))
	);
	const settingsPlatforms = $derived(
		(['youtube', 'tiktok'] as const).filter((p) => ed.selectedPlatforms.has(p))
	);
	const hasPlatformSettings = $derived(settingsPlatforms.length > 0);
	// Choices a platform needs before the post can go there (YouTube's title
	// and audience, TikTok's privacy): counted on the Settings bar.
	const requiredSettings = $derived(
		requiredSettingsByPlatform({
			selectedPlatforms: ed.selectedPlatforms,
			youtube: ed.youtubeOptions,
			youtubeText,
			tiktok: ed.tiktokOptions
		})
	);
	let settingsOpen = $state(false);
	// On a phone the preview folds away under the editor.
	let previewOpen = $state(false);

	const previewIdentity = $derived.by(() => {
		const rep = ed.activeTab === 'global' ? undefined : ed.representativeAccount(ed.activeTab);
		const name = rep
			? rep.displayName || displayHandle(rep.handle) || platformName(ed.activeTab)
			: 'Global Edit';
		return {
			name,
			avatarUrl: rep?.avatarUrl || ed.avatarSrc || null,
			initials: initialsOf(rep ? name : ed.displayName || 'You')
		};
	});

	const scheduleButtonLabel = $derived(
		ed.postState.nextAt
			? ed.postState.nextAt.toLocaleString(undefined, {
					month: '2-digit',
					day: '2-digit',
					year: 'numeric',
					hour: '2-digit',
					minute: '2-digit'
				})
			: null
	);

	// The emoji picker types into the post the way a keyboard would, so the
	// usual input handling (overrides, splitting, autosave) applies.
	function insertText(index: number, text: string) {
		const el = ed.textareaRefs[index];
		if (!el || ed.editLocked) return;
		el.focus();
		el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
		el.dispatchEvent(new Event('input', { bubbles: true }));
	}

	async function saveAsDraft() {
		const id = await ed.persistForAction();
		if (!id) return;
		showToast(ed.hasSchedule ? 'Saved — still scheduled' : 'Saved to drafts', 'success', {
			label: 'View',
			href: ed.hasSchedule ? '/posts?tab=scheduled' : '/posts?tab=drafts'
		});
	}

	const composeCheckList = $derived(
		composeChecks({
			connectionCount: ed.connections.length,
			selectedCount: ed.selected.size,
			selectedPlatforms: ed.selectedPlatforms,
			singlePostProblems: ed.singlePostProblems,
			fitProblems: ed.fitProblems(ed.media, true),
			overLimit: [...ed.selectedPlatforms]
				.filter((platform) => ed.getPlatformStatus(platform as PlatformId).hasError)
				.map((platform) => ({
					platform,
					max: ed.platformMax(platform as PlatformId, ed.accountsFor(platform as PlatformId))
				})),
			threadsLinks: ed.threadsLinkCount
		})
	);

	function uncheckPlatform(platform: string) {
		const next = new Set([...ed.selected].filter((id) => ed.platformOf(id) !== platform));
		if (next.size === ed.selected.size) return;
		ed.selected = next;
		ed.selectionTouched = true;
		ed.markDirty();
	}

	let checksRevealed = $state(false);

	field(
		ed,
		'checksRevealed',
		() => checksRevealed,
		(value) => (checksRevealed = value)
	);
	field(ed, 'composeCheckList', () => composeCheckList);
	field(ed, 'hasPlatformSettings', () => hasPlatformSettings);
	field(ed, 'previewIdentity', () => previewIdentity);
	field(
		ed,
		'previewOpen',
		() => previewOpen,
		(v) => (previewOpen = v)
	);
	field(ed, 'requiredSettings', () => requiredSettings);
	field(ed, 'scheduleButtonLabel', () => scheduleButtonLabel);
	field(
		ed,
		'settingsOpen',
		() => settingsOpen,
		(v) => (settingsOpen = v)
	);
	field(ed, 'settingsPlatforms', () => settingsPlatforms);
	field(ed, 'youtubeText', () => youtubeText);
	provide(ed, { insertText, saveAsDraft, uncheckPlatform });
}
