/**
 * A player's sheet, as the public page and the console both open one: at the
 * side on desktop, from the bottom on a phone, over a scrim that closes it.
 * Focus goes into the sheet, stays there, and goes back to what opened it;
 * Escape closes it. The page behind holds still while it is open. The head
 * names the player with a muted line under the name; the body scrolls, and
 * the foot, when there is one, stays put.
 */

import { children, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { inertOutside, keepTabIn } from '../../lib/focusTrap';
import { t } from '../../lib/i18n';
import '../../styles/pages/tournament-sheet.css';

export function Sheet(props: {
  /** The player's name, and anything drawn beside it. */
  title: JSX.Element;
  sub: JSX.Element;
  onClose: () => void;
  children: JSX.Element;
  foot?: JSX.Element;
}) {
  const foot = children(() => props.foot);
  const opener = document.activeElement as HTMLElement | null;
  let sheet: HTMLDivElement | undefined;
  let scrim: HTMLDivElement | undefined;
  // Only the sheet, and the scrim that closes it, can be reached while it is open.
  let live: () => void = () => undefined;
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      props.onClose();
    } else if (sheet) {
      keepTabIn(sheet, event);
    }
  };
  // The page behind holds still while the sheet is open.
  const { overflow } = document.documentElement.style;
  onMount(() => {
    document.addEventListener('keydown', onKey);
    document.documentElement.style.overflow = 'hidden';
    if (sheet) {
      live = inertOutside(sheet, scrim ? [scrim] : []);
    }
  });
  onCleanup(() => {
    document.removeEventListener('keydown', onKey);
    document.documentElement.style.overflow = overflow;
    live();
    opener?.focus();
  });
  return (
    <>
      <div ref={scrim} class='tm-scrim' aria-hidden='true' onClick={() => props.onClose()} />
      <div ref={sheet} class='tm-sheet' role='dialog' aria-modal='true' aria-labelledby='tm-sheet-title'>
        <div class='tm-sheet-head'>
          <div>
            <h2 id='tm-sheet-title'>{props.title}</h2>
            <p class='muted'>{props.sub}</p>
          </div>
          <button
            type='button'
            class='btn btn-ghost'
            // Once mounted: an open list still loading holds the sheet out of the page until it arrives.
            ref={el => onMount(() => el.focus())}
            onClick={() => props.onClose()}
          >
            {t('Close')}
          </button>
        </div>
        <div class='tm-sheet-body'>{props.children}</div>
        <Show when={foot()}>
          <div class='tm-sheet-foot'>{foot()}</div>
        </Show>
      </div>
    </>
  );
}
