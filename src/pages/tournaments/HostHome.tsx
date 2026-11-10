/**
 * The home page, for someone signed out, dark whatever the reader's mode.
 * First the two ways in, side by side (stacked on a phone): run an event
 * (a new account, or sign in) or play in an event (an event's code). Then, on a
 * raised band, one sample event (sampleRun) on the surfaces it uses: the
 * room's big screen beside a player's phone, a player's profile, the events
 * really run here lately (RecentEvents), and the way to the demo beside
 * the console. Every preview is the sample; only the recent events are real,
 * and finished.
 */

import { onCleanup, onMount } from 'solid-js';
import { t } from '../../lib/i18n';
import { EventCodeForm } from './EventCodeForm';
import { HomeConsole } from './HomeConsole';
import { HomePhone } from './HomePhone';
import { HomeProfile } from './HomeProfile';
import { HomeScreen } from './HomeScreen';
import { RecentEvents } from './RecentEvents';
import { createSampleRun } from './sampleRun';
import '../../styles/pages/tournament-home.css';

/** The page's ground, which the browser's bar takes while it shows. */
const NIGHT = '#161615';

/** The console's demo: a sample event that runs in the visitor's browser and saves nothing. */
const DEMO_SITE = 'https://demo.events.ciphermaniac.com';

/** The dark page for as long as it shows, the browser's bar with it. */
function useNight() {
  onMount(() => {
    document.body.classList.add('tm-home-mode');
    const bars = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    const before = bars.map(bar => bar.content);
    bars.forEach(bar => bar.setAttribute('content', NIGHT));
    onCleanup(() => {
      document.body.classList.remove('tm-home-mode');
      bars.forEach((bar, i) => bar.setAttribute('content', before[i] ?? NIGHT));
    });
  });
}

function Doors() {
  return (
    <section class='tm-home-doors'>
      <div class='tm-home-door'>
        <h1>{t('Run an event')}</h1>
        <div class='tm-home-join'>
          <a class='btn btn-secondary' href='/create-account'>
            {t('Create an account')}
          </a>
          <a href='/sign-in'>{t('or sign in')}</a>
        </div>
      </div>
      <div class='tm-home-door'>
        <h2>{t('Play in an event')}</h2>
        <EventCodeForm />
      </div>
    </section>
  );
}

export function HostHome() {
  useNight();
  const run = createSampleRun();
  return (
    <div class='tm-home'>
      <Doors />
      <div class='tm-home-band'>
        <section class='tm-home-sec' aria-label={t('At the venue')}>
          <div class='tm-home-lede tm-home-centered'>
            <p>
              {t(
                'Show your event’s pairings and timers on a big screen, accessible to anyone in the venue, and allow your players to virtually report their match results from their phone.'
              )}
            </p>
          </div>
          <div class='tm-home-venue'>
            <div class='tm-home-box tm-home-tv'>
              <HomeScreen run={run} />
            </div>
            <div class='tm-home-box tm-home-phone'>
              <HomePhone run={run} />
            </div>
          </div>
        </section>
        <div class='tm-home-sec tm-home-pair'>
          <section class='tm-home-lede' aria-label={t('Player profiles')}>
            <p>{t('Players can create a profile to share their event standings publicly.')}</p>
            <div class='tm-home-box tm-home-profile'>
              <HomeProfile run={run} />
            </div>
          </section>
          <RecentEvents />
        </div>
        <section class='tm-home-sec tm-home-split' aria-labelledby='tm-home-demo-title'>
          <div class='tm-home-lede'>
            <h2 id='tm-home-demo-title'>{t('Try the console')}</h2>
            <p>{t('Before you commit, try running an event in an offline, risk-free demo.')}</p>
            <a class='btn btn-primary tm-home-demo-open' href={DEMO_SITE} rel='external'>
              {t('Open the demo')}
            </a>
          </div>
          {/* A picture of the console: the demo is where it is run. */}
          <div class='tm-home-box tm-home-console' aria-hidden='true' inert>
            <HomeConsole run={run} />
          </div>
        </section>
      </div>
    </div>
  );
}
