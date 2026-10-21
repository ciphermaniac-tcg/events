import { createSignal, type JSX, Show } from 'solid-js';
import { t, tx } from '../../lib/i18n';
import { Modal } from './Modal';

/** Whether what was typed is `word`, in any case and with any spaces either side. */
const typedIs = (typed: string, word: string) => typed.trim().toLowerCase() === word.trim().toLowerCase();

/**
 * The question in a dialog, for what can't be taken back: what the answer
 * costs (`scope`, with its counts), then Keep or the answer. `typed` holds
 * the answer back until that word is typed, for what costs the most.
 * Keep comes first, so it is what an Enter pressed too soon presses.
 */
export function ConfirmDialog(props: {
  open: boolean;
  question: string;
  scope: JSX.Element;
  confirmLabel: string;
  keepLabel?: string;
  danger?: boolean;
  typed?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = createSignal('');
  const close = () => {
    setTyped('');
    props.onClose();
  };
  const ready = () => !props.busy && (props.typed === undefined || typedIs(typed(), props.typed));
  return (
    <Modal open={props.open} title={props.question} class='tm-confirm-dialog' onClose={close}>
      <div class='tm-box-bar tm-modal-body'>
        <p>{props.scope}</p>
        <Show when={props.typed}>
          {word => (
            <label class='tm-field'>
              <span class='tm-label'>{tx('Type {handle} to confirm', { handle: <strong>{word()}</strong> })}</span>
              <input
                class='tm-input'
                autocomplete='off'
                autocapitalize='none'
                spellcheck={false}
                value={typed()}
                onInput={event => setTyped(event.currentTarget.value)}
              />
            </label>
          )}
        </Show>
      </div>
      <div class='tm-box-bar tm-modal-foot'>
        <button type='button' class='btn btn-ghost' onClick={close}>
          {props.keepLabel ?? t('Keep')}
        </button>
        <button
          type='button'
          class={props.danger ? 'btn btn-secondary tm-danger' : 'btn btn-primary'}
          disabled={!ready()}
          onClick={() => {
            props.onConfirm();
            close();
          }}
        >
          {props.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/**
 * A button that takes a second press before it acts, in one of three tiers
 * by what the answer costs. What can be put back from the same screen asks
 * in place: the button becomes the question and its answer, and Escape or
 * Keep backs out, handing focus back to the button. What can't, but whose
 * cost can be counted, gives `scope` and asks in a dialog that states it
 * (ConfirmDialog). What costs the most, such as deleting an event, also
 * gives `typed`, a word to type before the answer is taken. A destructive
 * answer (`danger`) is drawn in the negative hue rather than as the page's
 * primary.
 */
export function ConfirmAction(props: {
  label: string;
  /** The question the second press answers, e.g. "Remove Ada?". */
  question: string;
  confirmLabel?: string;
  class?: string;
  disabled?: boolean;
  danger?: boolean;
  /** Anything the question needs besides its answer, such as a Keep reported results box. */
  extra?: JSX.Element;
  /** What the answer costs, with its counts: asks in a dialog rather than in place. */
  scope?: JSX.Element;
  /** A word to type before the dialog takes the answer. */
  typed?: string;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  const back = () => {
    setAsking(false);
    queueMicrotask(() => trigger?.focus());
  };
  const inDialog = () => props.scope !== undefined || props.typed !== undefined;
  // The question's buttons keep the size of the button that asked it.
  const size = () => ((props.class ?? 'tm-small').includes('tm-small') ? ' tm-small' : '');
  const button = (
    <button
      ref={el => (trigger = el)}
      type='button'
      class={props.class ?? 'btn btn-ghost tm-small'}
      disabled={props.disabled}
      onClick={() => setAsking(true)}
    >
      {props.label}
    </button>
  );
  return (
    <Show
      when={!inDialog()}
      fallback={
        <>
          {button}
          <ConfirmDialog
            open={asking()}
            question={props.question}
            scope={props.scope}
            confirmLabel={props.confirmLabel ?? props.label}
            danger={props.danger}
            typed={props.typed}
            busy={props.disabled}
            onConfirm={() => props.onConfirm()}
            onClose={back}
          />
        </>
      }
    >
      <Show when={asking()} fallback={button}>
        <span
          class='tm-row-actions tm-confirm'
          role='group'
          aria-label={props.question}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              back();
            }
          }}
        >
          <span class='tm-confirm-label'>{props.question}</span>
          {props.extra}
          <button
            type='button'
            class={`${props.danger ? 'btn btn-secondary tm-danger' : 'btn btn-primary'}${size()}`}
            ref={el => queueMicrotask(() => el.focus())}
            onClick={() => {
              setAsking(false);
              props.onConfirm();
            }}
          >
            {props.confirmLabel ?? props.label}
          </button>
          <button type='button' class={`btn btn-ghost${size()}`} onClick={back}>
            {t('Keep')}
          </button>
        </span>
      </Show>
    </Show>
  );
}
