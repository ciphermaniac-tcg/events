/**
 * The home page, for someone signed out: Ciphermaniac Events at night. The
 * headline and the way in, then one sample event (sampleRun) played out on
 * every surface a real one uses: the room's big screen, the organizer's
 * console to click around in, a player's phone, and a player's profile. Then
 * the features, drifting in three rows (FeatureReels), and the way in again.
 * The page is dark whatever the reader's mode; it marks the body while shown.
 */

import { onCleanup, onMount } from 'solid-js';
import type { SignInOffer } from '../../lib/tournament/api';
import { t, tx } from '../../lib/i18n';
import { FeatureReels } from './FeatureReels';
import { HomeConsole } from './HomeConsole';
import { HomePhone } from './HomePhone';
import { HomeProfile } from './HomeProfile';
import { HomeScreen } from './HomeScreen';
import { createSampleRun } from './sampleRun';
import { SignIn } from './SignIn';
import '../../styles/pages/tournament-home.css';

/** The page's ground, which the browser's bar takes while it shows. */
const NIGHT = '#161615';

export function HostHome(props: { offer: SignInOffer }) {
  const run = createSampleRun();
  onMount(() => {
    document.body.classList.add('tm-home-mode');
    // The browser's bar matches the night page, and goes back as it was.
    const bars = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    const before = bars.map(bar => bar.content);
    bars.forEach(bar => bar.setAttribute('content', NIGHT));
    onCleanup(() => {
      document.body.classList.remove('tm-home-mode');
      bars.forEach((bar, i) => bar.setAttribute('content', before[i] ?? NIGHT));
    });
  });
  return (
    <div class='tm-home'>
      <section class='tm-home-hero'>
        <h1 class='tm-home-big'>
          {/* A space before the break, so the heading reads as words where it is not drawn. */}
          {tx('Run your Pokémon{br}TCG events better', { br: [' ', <br />] })}
        </h1>
        <div class='tm-home-signin' id='sign-in'>
          <SignIn offer={props.offer} next='/' stacked />
        </div>
      </section>
      <div class='tm-home-tv'>
        <HomeScreen run={run} />
      </div>
      <section class='tm-home-part'>
        <h2>{t('Responsive admin console')}</h2>
        <div class='tm-home-frame tm-home-console'>
          <HomeConsole run={run} />
        </div>
      </section>
      <div class='tm-home-pair'>
        <section class='tm-home-part'>
          <h2>{t('Mobile reporting')}</h2>
          <div class='tm-home-frame tm-home-phone'>
            <HomePhone run={run} />
          </div>
        </section>
        <section class='tm-home-part'>
          <h2>{t('Player profiles')}</h2>
          <div class='tm-home-frame tm-home-profile'>
            <HomeProfile run={run} />
          </div>
        </section>
      </div>
      <FeatureReels />
      <section class='tm-home-end'>
        <h2 class='tm-home-big'>{t('Ready for your next event?')}</h2>
        <SignIn offer={props.offer} next='/' />
      </section>
    </div>
  );
}
