/**
 * Grows a textarea with its text. The page scroll is put back after each
 * resize: collapsing to `auto` first would otherwise make the page jump.
 */
export function autoResize(node: HTMLTextAreaElement, _value: string) {
	const resize = () => {
		const scrollY = window.scrollY;
		node.style.height = 'auto';
		node.style.height = node.scrollHeight + 'px';
		window.scrollTo(0, scrollY);
	};
	node.addEventListener('input', resize);
	setTimeout(resize, 0);
	return {
		update(_newValue: string) {
			setTimeout(resize, 0);
		},
		destroy() {
			node.removeEventListener('input', resize);
		}
	};
}
