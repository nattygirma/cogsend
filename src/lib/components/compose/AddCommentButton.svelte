<script lang="ts">
	import { Plus } from '@lucide/svelte';

	interface Props {
		onAdd: () => void;
	}

	let { onAdd }: Props = $props();
</script>

<button type="button" data-testid="add-thread-post" onclick={onAdd} class="btn btn-primary btn-sm">
	<Plus class="h-4 w-4" /> Add comment / post
</button>
