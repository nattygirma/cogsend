<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import Editor from '../Editor.svelte';

	type EditorData = Omit<ComponentProps<typeof Editor>, 'onClose'>;

	interface Props {
		data: EditorData;
		onClose: () => void;
	}

	let { data, onClose }: Props = $props();

	let dialog: HTMLDivElement | null = $state(null);

	// The page behind keeps its place; only the composer's panes scroll.
	$effect(() => {
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previous;
		};
	});

	// Tab stays inside the composer. Focus is left where the editor puts it
	// (the text box), so this only wraps at the ends.
	function trapTab(event: KeyboardEvent) {
		if (event.key !== 'Tab' || !dialog) return;
		const focusable = Array.from(
			dialog.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			)
		).filter((el) => el.getClientRects().length > 0);
		if (!focusable.length) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}
</script>

<div
	class="fixed inset-0 z-50 flex items-stretch justify-center bg-stone-900/40 backdrop-blur-[2px] lg:items-center lg:p-6"
	role="presentation"
	onclick={(event) => {
		if (event.target === event.currentTarget) onClose();
	}}
>
	<div
		bind:this={dialog}
		role="dialog"
		aria-modal="true"
		aria-labelledby="composer-title"
		tabindex="-1"
		onkeydown={trapTab}
		class="flex h-full w-full flex-col overflow-hidden bg-white lg:h-[min(90vh,860px)] lg:max-w-[1200px] lg:rounded-2xl lg:shadow-[0_32px_80px_-24px_rgb(28_25_23/0.45)]"
	>
		<Editor {...data} {onClose} />
	</div>
</div>
