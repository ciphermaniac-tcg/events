import { type JSX, type Resource, Show } from 'solid-js';
import { t } from '../../lib/i18n';
import { errorText } from '../../lib/tournament/api';
import { Skeleton } from '@ciphermaniac/design/components/Skeleton';

/** What a Field's control spreads on itself: its id, and while the field has an error, that it is invalid and why. */
export interface FieldControl {
  id: string;
  'aria-invalid': true | undefined;
  'aria-describedby': string | undefined;
}

/**
 * A labelled form control with an optional error line, the house form row;
 * `errorAction` follows the error's words. Given a function, the control is
 * drawn with the attributes that tie it to the error (see FieldControl), so
 * no form spells out the error line's id.
 */
export function Field(props: {
  id: string;
  label: string;
  error?: string | undefined;
  errorAction?: JSX.Element;
  /** An info marker after the label, for help the field's label can't hold. */
  tip?: JSX.Element;
  children: JSX.Element | ((control: FieldControl) => JSX.Element);
}) {
  const errorId = () => `${props.id}-error`;
  const control: FieldControl = {
    get id() {
      return props.id;
    },
    get 'aria-invalid'() {
      return props.error ? true : undefined;
    },
    get 'aria-describedby'() {
      return props.error ? errorId() : undefined;
    }
  };
  const drawn = () => {
    const { children } = props;
    return typeof children === 'function' ? children(control) : children;
  };
  return (
    <div class='tm-field'>
      <Show
        when={props.tip}
        fallback={
          <label class='tm-label' for={props.id}>
            {props.label}
          </label>
        }
      >
        <span class='tm-label-row'>
          <label class='tm-label' for={props.id}>
            {props.label}
          </label>
          {props.tip}
        </span>
      </Show>
      {drawn()}
      <Show when={props.error}>
        <span class='tm-error' id={errorId()}>
          {props.error} {props.errorAction}
        </span>
      </Show>
    </div>
  );
}

/** The one line a failed request leaves, where the action was, with the way on (`action`) when there is one. */
export function ErrorLine(props: { message: string | null | undefined; action?: JSX.Element }) {
  return (
    <Show when={props.message}>
      <p class='tm-error' role='alert'>
        {props.message} {props.action}
      </p>
    </Show>
  );
}

export function RetryError(props: { error: unknown; onRetry: () => void; small?: boolean }) {
  return (
    <>
      <ErrorLine message={errorText(props.error)} />
      <button
        type='button'
        class={props.small ? 'btn btn-secondary tm-small' : 'btn btn-secondary'}
        onClick={() => props.onRetry()}
      >
        {t('Try again')}
      </button>
    </>
  );
}

export function ResourceFallback(props: {
  resource: Resource<unknown>;
  onRetry: () => void;
  height?: string;
  small?: boolean;
}) {
  return (
    <Show when={props.resource.state === 'errored'} fallback={<Skeleton height={props.height ?? '160px'} />}>
      <RetryError error={props.resource.error} onRetry={() => props.onRetry()} small={props.small} />
    </Show>
  );
}
