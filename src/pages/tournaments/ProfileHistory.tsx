import { createSignal, Show } from 'solid-js';
import type { OrganizerActivity as Activity, HistoryEntry } from '../../../shared/accounts/types';
import { TabPanel, Tabs } from '@ciphermaniac/design/components/Tabs';
import { t } from '../../lib/i18n';
import { HistoryList } from './HistoryList';
import { OrganizerActivity } from './OrganizerActivity';
import '../../styles/pages/tournament-profile.css';

function Playing(props: { entries: readonly HistoryEntry[] }) {
  return (
    <Show when={props.entries.length} fallback={<p class='muted tm-empty'>{t('No events yet')}</p>}>
      <HistoryList entries={props.entries} />
    </Show>
  );
}

/**
 * A profile's events: the ones played, and, for someone who has organized,
 * a second tab with those. A player's profile has no tab bar leading to an
 * empty tab, and no count that drops as rows find they have nothing to show.
 */
export function ProfileHistory(props: { entries: readonly HistoryEntry[]; activity?: readonly Activity[] }) {
  const [tab, setTab] = createSignal<'playing' | 'organizing'>('playing');
  return (
    <div class='tm-profile-history'>
      <Show when={props.activity?.length} fallback={<Playing entries={props.entries} />}>
        <Tabs
          id='history'
          options={[
            { value: 'playing', label: t('Playing') },
            { value: 'organizing', label: t('Organizing') }
          ]}
          selected={tab()}
          onSelect={setTab}
          ariaLabel={t('Profile history')}
        />
        <TabPanel tabs='history' selected={tab()}>
          <Show when={tab() === 'playing'} fallback={<OrganizerActivity entries={props.activity ?? []} />}>
            <Playing entries={props.entries} />
          </Show>
        </TabPanel>
      </Show>
    </div>
  );
}
