/**
 * The home page, for someone signed out: what running an event here is, and the way
 * in for organizers. It stands as its own product, Ciphermaniac Events, with
 * its own head in place of the site's nav. The hero plays a sample event on
 * the real pairing engine (SampleEvent); below it, one band for each thing
 * the site does that TOM can't, then three of what any event needs, each
 * with its picture (HostHomeArt).
 */

import { For, type JSX, onCleanup } from 'solid-js';
import type { SignInOffer } from '../../lib/tournament/api';
import { DecklistArt, FieldArt, PhoneArt, ProfileArt, ResultsArt, ScreenArt, StreamArt, TdfArt } from './HostHomeArt';
import { SampleEvent } from './SampleEvent';
import { SignIn } from './SignIn';
import '../../styles/pages/tournament-home.css';

interface Point {
  name: string;
  art: () => JSX.Element;
  text: string;
}

const BANDS: Point[] = [
  {
    name: 'Opens any .tdf',
    art: TdfArt,
    text: 'Open the .tdf from TOM and carry on in either one. Pairings, standings and the file itself follow TOM’s rules.'
  },
  {
    name: 'Mobile reporting',
    art: PhoneArt,
    text: 'Players can find their table, watch the round clock, and report round results from their phones, all without an account.'
  },
  {
    name: 'Player profiles',
    art: ProfileArt,
    text: 'Anyone with an account gets a public page of every event they’ve played, records and decks included.'
  },
  {
    name: 'Big-screen interface',
    art: ScreenArt,
    text: 'A dynamic second screen interface for your space’s TVs shows pairings, a round timer, and standings.'
  },
  {
    name: 'Stream setup ready',
    art: StreamArt,
    text: 'Add an automatic overlay to your stream setup, showing players, records, and deck archetypes.'
  }
];

const FEATURES: Point[] = [
  {
    name: 'Responsive admin console',
    art: ResultsArt,
    text: 'Manage ties, penalties, static seating, and latecomers from a user-friendly interface.'
  },
  {
    name: 'Decklists ahead of time',
    art: DecklistArt,
    text: 'Players submit their lists ahead of time. Card counts and copy limits are checked as they type, and you review the rest.'
  },
  { name: 'Field breakdown', art: FieldArt, text: 'See your event’s meta share and archetype performance.' }
];

/** Marks an element `is-in` while most of it is on screen, so its picture plays only then. */
function watchInView(el: HTMLElement) {
  const observer = new IntersectionObserver(
    entries => entries.forEach(entry => el.classList.toggle('is-in', entry.isIntersecting)),
    { threshold: 0.35 }
  );
  observer.observe(el);
  onCleanup(() => observer.disconnect());
}

function PointView(props: { point: Point }) {
  return (
    <div class='tm-home-point' ref={watchInView}>
      <div class='tm-art'>{props.point.art()}</div>
      <div>
        <h2>{props.point.name}</h2>
        <p>{props.point.text}</p>
      </div>
    </div>
  );
}

export function HostHome(props: { offer: SignInOffer }) {
  const signIn = () => <SignIn offer={props.offer} next='/' />;
  return (
    <div class='tm-home'>
      <section class='tm-home-hero'>
        <div>
          <h1>
            Run your Pokémon
            <br />
            TCG events better
          </h1>
          <p class='tm-home-lede'>
            Pair rounds, take results from players’ phones and publish standings, for sanctioned and unsanctioned
            Pokémon TCG events alike.
          </p>
          <div class='tm-home-signin' id='sign-in'>
            {signIn()}
          </div>
        </div>
        <SampleEvent />
      </section>
      <div class='tm-home-bands'>
        <For each={BANDS}>{point => <PointView point={point} />}</For>
      </div>
      <div class='tm-home-features'>
        <For each={FEATURES}>{point => <PointView point={point} />}</For>
      </div>
      <div class='tm-home-end'>
        <strong>Ready for your next event?</strong>
        {signIn()}
      </div>
    </div>
  );
}
