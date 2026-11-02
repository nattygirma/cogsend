import type { Connection, EditorDraft } from '../types';
import type { ProfileSettings } from '#lib/domain/profile-settings.js';
import type { SeedApi } from './use-seed.svelte';
import type { ComposerStateApi } from './use-composer-state.svelte';
import type { EditorFlagsApi } from './use-editor-flags.svelte';
import type { SegmentsApi } from './use-segments.svelte';
import type { ChecksApi } from './use-checks.svelte';
import type { DraftLoadApi } from './use-draft-load.svelte';
import type { DraftSaveApi } from './use-draft-save.svelte';
import type { PublishApi } from './use-publish.svelte';
import type { PostLifecycleApi } from './use-post-lifecycle.svelte';
import type { ScheduleApi } from './use-schedule.svelte';
import type { MediaUploadApi } from './use-media-upload.svelte';
import type { ComposerViewApi } from './use-composer-view.svelte';
import type { MediaEditApi } from './use-media-edit.svelte';
import type { SegmentEditingApi } from './use-segment-editing.svelte';
import type { ThreadOpsApi } from './use-thread-ops.svelte';
import type { AccountActionsApi } from './use-account-actions.svelte';
import type { ComposerLifecycleApi } from './use-composer-lifecycle.svelte';
import type { SegmentContextApi } from './use-segment-context.svelte';

/** What the composer was opened with. */
export interface ComposerProps {
	readonly initialConnections: Connection[];
	readonly initialSettings: ProfileSettings | null;
	readonly initialDraft: EditorDraft | null;
	readonly displayName: string | null;
	readonly canMakeJpegCopies: boolean;
	readonly onClose: () => void;
}

/**
 * Everything the composer knows and can do, gathered from its hooks. Like a
 * React context value: created once per composer, read by every part of it.
 */
export type Composer = ComposerProps &
	SeedApi &
	ComposerStateApi &
	EditorFlagsApi &
	SegmentsApi &
	ChecksApi &
	DraftLoadApi &
	DraftSaveApi &
	PublishApi &
	PostLifecycleApi &
	ScheduleApi &
	MediaUploadApi &
	ComposerViewApi &
	MediaEditApi &
	SegmentEditingApi &
	ThreadOpsApi &
	AccountActionsApi &
	ComposerLifecycleApi &
	SegmentContextApi;
