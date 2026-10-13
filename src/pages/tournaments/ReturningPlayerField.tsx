import { createEffect, createSignal, createUniqueId, For, onCleanup, Show } from 'solid-js';
import { playerSearch, type ReturningPlayer } from '../../../shared/tournament/returningPlayers';
import { findReturningPlayers } from '../../lib/tournament/api';
import { placeComboList } from '../../utils/comboListPlacement';

export function ReturningPlayerField(props: {
  code: string;
  value: string;
  ref: (input: HTMLInputElement) => void;
  onInput: (value: string) => void;
  onPick: (player: ReturningPlayer) => void;
}) {
  const id = createUniqueId();
  const [players, setPlayers] = createSignal<ReturningPlayer[]>([]);
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(-1);
  const [failed, setFailed] = createSignal(false);
  let input: HTMLInputElement | undefined;
  let list: HTMLUListElement | undefined;
  const showing = () => open() && players().length > 0;
  const optionId = (index: number) => `${id}-${index}`;

  createEffect(() => {
    const query = playerSearch(props.value);
    const { code } = props;
    setPlayers([]);
    setActive(-1);
    setFailed(false);
    if (!query) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void findReturningPlayers(code, query, controller.signal)
        .then(answer => {
          if (!controller.signal.aborted) {
            setPlayers(answer.players);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setFailed(true);
          }
        });
    }, 200);
    onCleanup(() => {
      clearTimeout(timer);
      controller.abort();
    });
  });

  createEffect(() => {
    if (!showing() || !list || !input) {
      return;
    }
    const field = input;
    const popup = list;
    const place = () => {
      const viewport = window.visualViewport;
      const band = { top: viewport?.offsetTop ?? 0, height: viewport?.height ?? window.innerHeight };
      const position = placeComboList(field.getBoundingClientRect(), band);
      popup.setAttribute('data-side', position.side);
      Object.assign(popup.style, {
        left: `${position.left}px`,
        top: `${position.top}px`,
        width: `${position.width}px`,
        maxHeight: `${position.maxHeight}px`
      });
    };
    popup.showPopover();
    place();
    const controller = new AbortController();
    window.addEventListener('scroll', place, { capture: true, signal: controller.signal });
    window.addEventListener('resize', place, { signal: controller.signal });
    window.visualViewport?.addEventListener('resize', place, { signal: controller.signal });
    onCleanup(() => controller.abort());
  });

  function take(player: ReturningPlayer) {
    setOpen(false);
    props.onPick(player);
  }

  function keyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      setOpen(false);
      event.stopPropagation();
      return;
    }
    if (!players().length) {
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      const count = players().length;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActive(index => (index < 0 ? (direction === 1 ? 0 : count - 1) : (index + direction + count) % count));
      document.getElementById(optionId(active()))?.scrollIntoView({ block: 'nearest' });
    }
    if (event.key === 'Enter' && showing() && active() >= 0) {
      event.preventDefault();
      take(players()[active()]);
    }
  }

  return (
    <div class='tl-combo'>
      <input
        id='add-first'
        ref={element => {
          input = element;
          props.ref(element);
        }}
        class='tm-input'
        value={props.value}
        autocomplete='off'
        role='combobox'
        aria-autocomplete='list'
        aria-expanded={showing()}
        aria-controls={showing() ? id : undefined}
        aria-activedescendant={showing() && active() >= 0 ? optionId(active()) : undefined}
        onInput={event => {
          props.onInput(event.currentTarget.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={keyDown}
      />
      <Show when={showing()}>
        <ul ref={list} id={id} class='tl-list' role='listbox' aria-label='Returning players' popover='manual'>
          <For each={players()}>
            {(player, index) => (
              <li
                role='option'
                id={optionId(index())}
                aria-selected={active() === index()}
                onPointerDown={event => event.preventDefault()}
                onClick={() => take(player)}
              >
                <b>
                  {player.firstName} {player.lastName}
                </b>
                <Show when={player.popId}>
                  <span>{player.popId}</span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={failed()}>
        <span class='tm-error'>Player suggestions unavailable</span>
      </Show>
    </div>
  );
}
