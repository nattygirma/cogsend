<script lang="ts">
	import type { Connection } from './compose/types';
	import type { ProfileSettings } from '#lib/domain/profile-settings.js';
	import type { EditorDraft } from './compose/types';
	import { useSeed } from './compose/hooks/use-seed.svelte';
	import { useComposerState } from './compose/hooks/use-composer-state.svelte';
	import { useEditorFlags } from './compose/hooks/use-editor-flags.svelte';
	import { useSegments } from './compose/hooks/use-segments.svelte';
	import { useChecks } from './compose/hooks/use-checks.svelte';
	import { useDraftLoad } from './compose/hooks/use-draft-load.svelte';
	import { useDraftSave } from './compose/hooks/use-draft-save.svelte';
	import { usePublish } from './compose/hooks/use-publish.svelte';
	import { usePostLifecycle } from './compose/hooks/use-post-lifecycle.svelte';
	import { useSchedule } from './compose/hooks/use-schedule.svelte';
	import { useMediaUpload } from './compose/hooks/use-media-upload.svelte';
	import { useComposerView } from './compose/hooks/use-composer-view.svelte';
	import { useMediaEdit } from './compose/hooks/use-media-edit.svelte';
	import { useSegmentEditing } from './compose/hooks/use-segment-editing.svelte';
	import { useThreadOps } from './compose/hooks/use-thread-ops.svelte';
	import { useAccountActions } from './compose/hooks/use-account-actions.svelte';
	import { useComposerLifecycle } from './compose/hooks/use-composer-lifecycle.svelte';
	import { useSegmentContext } from './compose/hooks/use-segment-context.svelte';
	import { field } from './compose/hooks/expose';
	import type { Composer } from './compose/hooks/composer';
	import ComposerView from './compose/ComposerView.svelte';
	import ComposerDialogs from './compose/ComposerDialogs.svelte';

	let {
		initialConnections = [],
		initialSettings = null,
		initialDraft = null,
		displayName = null,
		canMakeJpegCopies = false,
		onClose
	}: {
		initialConnections?: Connection[];
		initialSettings?: ProfileSettings | null;
		initialDraft?: EditorDraft | null;
		displayName?: string | null;
		/** The server can make a missing JPEG copy (the Images binding). */
		canMakeJpegCopies?: boolean;
		/** Closes the composer; the post is saved first. */
		onClose: () => void;
	} = $props();

	// One composer per editor: each hook adds its state and actions to it, in
	// the order the editor always set them up, so a hook reads only what the
	// ones before it already defined.
	const ed = {} as Composer;
	field(ed, 'initialConnections', () => initialConnections);
	field(ed, 'initialSettings', () => initialSettings);
	field(ed, 'initialDraft', () => initialDraft);
	field(ed, 'displayName', () => displayName);
	field(ed, 'canMakeJpegCopies', () => canMakeJpegCopies);
	field(ed, 'onClose', () => onClose);
	useSeed(ed);
	useComposerState(ed);
	useEditorFlags(ed);
	useSegments(ed);
	useChecks(ed);
	useDraftLoad(ed);
	useDraftSave(ed);
	usePublish(ed);
	usePostLifecycle(ed);
	useSchedule(ed);
	useMediaUpload(ed);
	useComposerView(ed);
	useMediaEdit(ed);
	useSegmentEditing(ed);
	useThreadOps(ed);
	useAccountActions(ed);
	useComposerLifecycle(ed);
	useSegmentContext(ed);
</script>

<ComposerView {ed} />
<ComposerDialogs {ed} />
