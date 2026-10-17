import { createSignal, Show } from 'solid-js';
import type { OrganizerActivity as Activity, HistoryEntry } from '../../../shared/accounts/types';
import { TabPanel, Tabs } from '@ciphermaniac/design/components/Tabs';
import { t } from '../../lib/i18n';
import { createShownCount, HistoryList } from './HistoryList';
import { OrganizerActivity } from './OrganizerActivity';
import '../../styles/pages/tournament-profile.css';

export function ProfileHistory(props: { entries: readonly HistoryEntry[]; activity?: readonly Activity[] }) {
  const [tab, setTab] = createSignal<'playing' | 'organizing'>('playing');
  const count = createShownCount();
  return (
    <div class='tm-profile-history'>
      <Tabs
        id='history'
        options={[
          { value: 'playing', label: t('Playing · {count}', { count: count.shown(props.entries) }) },
          { value: 'organizing', label: t('Organizing · {count}', { count: props.activity?.length ?? 0 }) }
        ]}
        selected={tab()}
        onSelect={setTab}
        ariaLabel={t('Profile history')}
      />
      <TabPanel tabs='history' selected={tab()}>
        <Show when={tab() === 'playing'} fallback={<OrganizerActivity entries={props.activity ?? []} />}>
          <Show when={props.entries.length} fallback={<p class='muted tm-empty'>{t('No events yet')}</p>}>
            <HistoryList entries={props.entries} onGone={count.onGone} />
          </Show>
        </Show>
      </TabPanel>
    </div>
  );
}
