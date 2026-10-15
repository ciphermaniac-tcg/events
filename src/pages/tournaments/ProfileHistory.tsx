import { createSignal, Show } from 'solid-js';
import type { OrganizerActivity as Activity, HistoryEntry } from '../../../shared/accounts/types';
import { TabPanel, Tabs } from '../../components/Tabs';
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
          { value: 'playing', label: `Playing · ${count.shown(props.entries)}` },
          { value: 'organizing', label: `Organizing · ${props.activity?.length ?? 0}` }
        ]}
        selected={tab()}
        onSelect={setTab}
        ariaLabel='Profile history'
      />
      <TabPanel tabs='history' selected={tab()}>
        <Show when={tab() === 'playing'} fallback={<OrganizerActivity entries={props.activity ?? []} />}>
          <Show when={props.entries.length} fallback={<p class='muted tm-empty'>No events yet</p>}>
            <HistoryList entries={props.entries} onGone={count.onGone} />
          </Show>
        </Show>
      </TabPanel>
    </div>
  );
}
