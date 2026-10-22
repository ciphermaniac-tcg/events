import { createEffect, createMemo, createSignal, createUniqueId, type JSX, onCleanup, Show } from 'solid-js';
import { Icon } from '@ciphermaniac/design/components/Icon';
import { t } from '../../lib/i18n';
import { createPopover } from './popover';

/** A fixed menu follows its button as the page scrolls; a resize closes it rather than guess. */
function followButton(place: () => void, close: () => void) {
  window.addEventListener('scroll', place, { capture: true, passive: true });
  window.addEventListener('resize', close);
  onCleanup(() => {
    window.removeEventListener('scroll', place, { capture: true });
    window.removeEventListener('resize', close);
  });
}

export function OptionsMenu(props: {
  name: string;
  staff?: boolean;
  /** Any item closes the menu; without it, only one marked data-closes-menu does. */
  closeOnSelect?: boolean;
  busy?: boolean;
  /** The trigger's look, name and face, when it is not the row's "more" dots (a split button's caret). */
  buttonClass?: string;
  buttonLabel?: string;
  buttonContent?: JSX.Element;
  children: JSX.Element;
}) {
  const id = createUniqueId();
  const [at, setAt] = createSignal<{ top: number; left: number } | null>(null);
  const open = createMemo(() => at() !== null);
  let root: HTMLSpanElement | undefined;
  let button: HTMLButtonElement | undefined;
  let menu: HTMLSpanElement | undefined;
  const close = () => setAt(null);
  const place = () => {
    const rect = button?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const width = menu?.offsetWidth ?? 240;
    const height = menu?.offsetHeight ?? 144;
    const viewport = document.documentElement.getBoundingClientRect().width;
    const top = rect.bottom + height + 8 > innerHeight ? Math.max(8, rect.top - height - 4) : rect.bottom + 4;
    setAt({ top, left: Math.max(8, Math.min(rect.right - width, viewport - width - 8)) });
  };
  createEffect(() => {
    if (props.busy) {
      close();
    }
  });
  createEffect(() => {
    if (!open()) {
      return;
    }
    followButton(place, close);
    const observer = new ResizeObserver(place);
    if (menu) {
      observer.observe(menu);
    }
    onCleanup(() => {
      observer.disconnect();
    });
  });
  createPopover({ open, close, root: () => root, trigger: () => button, panel: () => menu });
  const mountMenu = (element: HTMLSpanElement) => {
    menu = element;
    queueMicrotask(place);
  };
  return (
    <span
      ref={root}
      class='tm-more'
      classList={{ 'tm-staff-more': props.staff }}
      onClick={event => {
        event.stopPropagation();
        const item = (event.target as Element).closest('.tm-menu-item');
        if (item && (props.closeOnSelect || item.hasAttribute('data-closes-menu'))) {
          close();
        }
      }}
    >
      <button
        ref={button}
        type='button'
        class={props.buttonClass ?? 'btn btn-ghost tm-small'}
        aria-label={props.buttonLabel ?? t('More for {name}', { name: props.name })}
        aria-expanded={at() !== null}
        aria-controls={at() ? id : undefined}
        disabled={props.busy}
        onClick={() => {
          if (open()) {
            close();
          } else {
            place();
          }
        }}
      >
        {props.buttonContent ?? <Icon name='more' />}
      </button>
      <Show when={at()}>
        {position => (
          <span
            ref={mountMenu}
            id={id}
            class='tm-menu tm-menu-fixed'
            classList={{ 'tm-staff-options': props.staff, 'tm-result-options': !props.staff }}
            role='group'
            aria-label={t('More for {name}', { name: props.name })}
            style={{ top: `${String(position().top)}px`, left: `${String(position().left)}px` }}
          >
            {props.children}
          </span>
        )}
      </Show>
    </span>
  );
}
