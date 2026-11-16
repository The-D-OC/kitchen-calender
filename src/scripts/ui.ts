import { $, bellIcon, h } from './dom';

/* Toast ------------------------------------------------------------- */

let toastTimer = 0;
export function toast(content: (Node | string)[], ms = 4000) {
  const el = $('#toast');
  el.replaceChildren(...content);
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('on'), ms);
}

/* Confirm (window.confirm is blocked in kiosk browsers) ------------- */

export function ask(message: string, okLabel = 'OK', danger = true): Promise<boolean> {
  const dlg = $<HTMLDialogElement>('#confirm-dialog');
  $('#confirm-text').textContent = message;
  const ok = $('#confirm-ok');
  ok.textContent = okLabel;
  ok.className = `btn ${danger ? 'danger' : 'primary'}`;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
}

/* Full-screen alert for bells and timers ---------------------------- */

interface AlertAction {
  label: string;
  primary?: boolean;
  onClick?: () => void;
}

let alertClose: (() => void) | null = null;

export function showAlert(opts: { title: string; subtitle?: string; color?: string; actions?: AlertAction[]; onClose?: () => void }) {
  alertClose?.();
  const el = $('#alert');
  const close = () => {
    el.classList.remove('on');
    if (alertClose === close) alertClose = null;
    opts.onClose?.();
  };
  const actions = opts.actions?.length ? opts.actions : [{ label: 'OK', primary: true }];
  el.style.setProperty('--c', opts.color ?? 'var(--accent)');
  el.replaceChildren(
    h(
      'div',
      { class: 'alert-card' },
      h('div', { class: 'alert-icon' }, bellIcon(56)),
      h('div', { class: 'alert-title' }, opts.title),
      opts.subtitle ? h('div', { class: 'alert-sub' }, opts.subtitle) : null,
      h(
        'div',
        { class: 'alert-actions' },
        ...actions.map((a) =>
          h(
            'button',
            {
              type: 'button',
              class: `btn big ${a.primary ? 'primary' : ''}`,
              onclick: () => {
                close();
                a.onClick?.();
              },
            },
            a.label,
          ),
        ),
      ),
    ),
  );
  el.classList.add('on');
  alertClose = close;
  return close;
}
