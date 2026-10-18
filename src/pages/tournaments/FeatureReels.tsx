/**
 * The home page's features: three rows drifting at their own speeds, running
 * the event, players, then the room and stores. Pressing a row stops it; a
 * drag moves it, and letting go throws it, coasting back to its drift
 * (lib/reel). Each row repeats enough copies to never show its end. Under
 * reduced motion the rows rest, and still move by hand.
 */

import { createSignal, For, onCleanup, onMount } from 'solid-js';
import { coast, type DragSample, MAX_THROW, throwSpeed, wrapOffset } from '../../lib/reel';
import { msg, t } from '../../lib/i18n';

const ROWS: { features: string[]; drift: number }[] = [
  {
    drift: 36,
    features: [
      msg('Opens any .tdf'),
      msg('TOM sync for sanctioned events'),
      msg('Swiss pairing'),
      msg('Top cut brackets'),
      msg('Divisions and combined pods'),
      msg('Prerelease and local events'),
      msg('Integrated round clock'),
      msg('Table time extensions'),
      msg('Correct a past result'),
      msg('Penalty notes'),
      msg('Deck checks'),
      msg('Head judge and staff roles'),
      msg('Static seating'),
      msg('Late arrivals'),
      msg('Remembers venues')
    ]
  },
  {
    drift: -28,
    features: [
      msg('Register by Player ID'),
      msg('Check-in before round 1'),
      msg('Event caps'),
      msg('Decklists on paper or pasted'),
      msg('Lists checked as they’re typed'),
      msg('Find your table by last name'),
      msg('Report results from a phone'),
      msg('Player profiles'),
      msg('Badges'),
      msg('Event history'),
      msg('Export your data')
    ]
  },
  {
    drift: 44,
    features: [
      msg('Big-screen interface'),
      msg('QR code to the event'),
      msg('Stream overlay'),
      msg('Optional field breakdown'),
      msg('Store pages'),
      msg('Multiple staff for a location'),
      msg('Sanctioned event listings')
    ]
  }
];

/** Keyboard arrows throw a row this fast. */
const KEY_THROW = 900;
/** Longest frame step, so a background tab coming back does not jump. */
const MAX_STEP = 0.05;

interface Drag {
  id: number;
  x: number;
  at: number;
  samples: DragSample[];
}

function Reel(props: { features: string[]; drift: number; still: boolean; row: number }) {
  let box!: HTMLDivElement;
  let track!: HTMLDivElement;
  const [copies, setCopies] = createSignal(3);
  let width = 0;
  let x = 0;
  let speed = 0;
  let drag: Drag | null = null;
  /** Held still by keyboard focus, so a row can be read without chasing it. */
  let focused = false;

  /** One copy's width, and enough copies to cover the row twice over. */
  function measure() {
    width = track.firstElementChild?.getBoundingClientRect().width ?? 0;
    setCopies(width > 0 ? Math.max(3, Math.ceil((box.clientWidth * 2) / width) + 1) : 3);
  }
  const drift = () => (props.still || focused ? 0 : props.drift);

  function down(event: PointerEvent) {
    if (event.button !== 0) {
      return;
    }
    drag = { id: event.pointerId, x: event.clientX, at: performance.now(), samples: [] };
    speed = 0;
    box.setPointerCapture(event.pointerId);
    box.classList.add('is-held');
  }
  function move(event: PointerEvent) {
    if (drag?.id !== event.pointerId) {
      return;
    }
    const now = performance.now();
    const dx = event.clientX - drag.x;
    x = wrapOffset(x - dx, width);
    drag.samples = [...drag.samples.slice(-4), { dx, ms: now - drag.at }];
    drag.x = event.clientX;
    drag.at = now;
  }
  function up(event: PointerEvent) {
    if (drag?.id !== event.pointerId) {
      return;
    }
    speed = throwSpeed(drag.samples, performance.now() - drag.at);
    drag = null;
    box.classList.remove('is-held');
  }
  /** A capture taken away mid-drag lets go without a throw. */
  function lost() {
    drag = null;
    box.classList.remove('is-held');
  }
  function wheel(event: WheelEvent) {
    const across = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : 0;
    if (!across) {
      return;
    }
    event.preventDefault();
    x = wrapOffset(x + across, width);
    speed = Math.max(-MAX_THROW, Math.min(MAX_THROW, across * 12));
  }
  function key(event: KeyboardEvent) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      speed = event.key === 'ArrowRight' ? KEY_THROW : -KEY_THROW;
    }
  }

  onMount(() => {
    measure();
    speed = drift();
    x = wrapOffset(Math.random() * width, width);
    const resize = new ResizeObserver(measure);
    resize.observe(box);
    resize.observe(track.firstElementChild as Element);
    let last = performance.now();
    let frame = 0;
    let shown = false;
    const tick = (now: number) => {
      const seconds = Math.min(MAX_STEP, (now - last) / 1000);
      last = now;
      if (!drag) {
        speed = coast(speed, drift(), seconds);
        x = wrapOffset(x + speed * seconds, width);
      }
      track.style.transform = `translate3d(${-x}px, 0, 0)`;
      frame = shown ? requestAnimationFrame(tick) : 0;
    };
    // Only a row on screen runs its frames.
    const seen = new IntersectionObserver(([entry]) => {
      shown = entry?.isIntersecting ?? false;
      if (shown && !frame) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    });
    seen.observe(box);
    box.addEventListener('wheel', wheel, { passive: false });
    onCleanup(() => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      seen.disconnect();
      box.removeEventListener('wheel', wheel);
    });
  });

  return (
    <div
      class='tm-reel'
      ref={box}
      role='group'
      aria-label={t('Features, row {n}', { n: props.row })}
      tabIndex={0}
      onFocus={() => (focused = box.matches(':focus-visible'))}
      onBlur={() => (focused = false)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={lost}
      onKeyDown={key}
    >
      <div class='tm-reel-track' ref={track}>
        <For each={Array.from({ length: copies() }, (_, i) => i)}>
          {copy => (
            <ul aria-hidden={copy > 0 ? 'true' : undefined}>
              <For each={props.features}>{feature => <li>{t(feature)}</li>}</For>
            </ul>
          )}
        </For>
      </div>
    </div>
  );
}

export function FeatureReels() {
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return (
    <section class='tm-home-features' aria-labelledby='tm-home-features-title'>
      <h2 id='tm-home-features-title' class='tm-home-big'>
        {t('All the features you expect')}
      </h2>
      <div class='tm-reels'>
        <For each={ROWS}>
          {(row, i) => <Reel features={row.features} drift={row.drift} still={still} row={i() + 1} />}
        </For>
      </div>
    </section>
  );
}
