import { createSignal, onCleanup } from 'solid-js';

/** Whether `query` matches, kept up as the window changes. */
export function createMedia(query: string): () => boolean {
  const list = window.matchMedia(query);
  const [matches, setMatches] = createSignal(list.matches);
  const update = () => setMatches(list.matches);
  list.addEventListener('change', update);
  onCleanup(() => list.removeEventListener('change', update));
  return matches;
}

/** A screen too small or too touch-led for the computer TOM runs on; tm-desktop-only hides on the same. */
export const NOT_TOM_DESKTOP = '(max-width: 640px), (pointer: coarse)';
