/**
 * The bar across the top of every demo page: what the demo is, a way to start
 * it over, and the way back to the real site. Plain DOM, outside the app, so
 * the site itself stays exactly as it ships.
 */

import { resetDemo } from './server';
import './banner.css';

const REAL_SITE = 'https://events.ciphermaniac.com';

function button(label: string, className: string): HTMLButtonElement {
  const made = document.createElement('button');
  made.type = 'button';
  made.className = className;
  made.textContent = label;
  return made;
}

export function showBanner(): void {
  const bar = document.createElement('div');
  bar.className = 'demo-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Demo');

  const note = document.createElement('p');
  note.textContent = 'This is a demo. Its players and events are made up, and what you change stays in this browser.';

  const reset = button('Reset demo', 'btn btn-ghost');
  // Asked in place, as the site's own confirmations are: the question, then the verb.
  const question = document.createElement('span');
  question.textContent = 'Start the demo over?';
  const confirm = button('Reset', 'btn btn-secondary');
  const cancel = button('Cancel', 'btn btn-ghost');
  const asking = (on: boolean) => {
    reset.hidden = on;
    question.hidden = !on;
    confirm.hidden = !on;
    cancel.hidden = !on;
  };
  asking(false);
  reset.addEventListener('click', () => {
    asking(true);
    confirm.focus();
  });
  cancel.addEventListener('click', () => {
    asking(false);
    reset.focus();
  });
  confirm.addEventListener('click', () => void resetDemo());

  const back = document.createElement('a');
  back.className = 'btn btn-secondary';
  back.href = REAL_SITE;
  back.textContent = 'Ciphermaniac Events';

  const actions = document.createElement('div');
  actions.append(reset, question, confirm, cancel, back);
  bar.append(note, actions);
  document.body.prepend(bar);
}
