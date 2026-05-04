/**
 * Account plug-in entry.
 * Exports `mount(container, api)` and `unmount(container)` per the host contract.
 */

import { changePassword, changeUsername, fetchCurrentUser, persistToken, type AuthUser } from './api';
import { pickLang, strings } from './i18n';
import { el, field, status, STYLES } from './ui';

let styleEl: HTMLStyleElement | null = null;

function ensureStyles(): void {
  if (styleEl) return;
  styleEl = document.createElement('style');
  styleEl.setAttribute('data-account-plugin', '');
  styleEl.textContent = STYLES;
  document.head.appendChild(styleEl);
}

function buildUsernameCard(t: ReturnType<typeof strings>, currentUsername: string): HTMLElement {
  const cur = field({ id: 'cca-u-cur', label: t.username.currentLabel, value: currentUsername });
  cur.input.disabled = true;
  const next = field({ id: 'cca-u-new', label: t.username.newLabel, help: t.username.newHelp, autocomplete: 'username' });
  const pwd = field({ id: 'cca-u-pwd', label: t.username.passwordLabel, type: 'password', autocomplete: 'current-password' });
  const btn = el('button', { type: 'submit', className: 'cca-btn' }, [t.username.submit]);
  const st = status();

  const form = el('form', { className: 'cca-form' }, [cur.wrap, next.wrap, pwd.wrap, btn, st.node]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    st.clear();
    btn.disabled = true;
    btn.textContent = t.username.saving;
    const result = await changeUsername(pwd.input.value, next.input.value);
    btn.disabled = false;
    btn.textContent = t.username.submit;
    if (result.ok) {
      persistToken(result.data.token);
      cur.input.value = result.data.user.username;
      next.input.value = '';
      pwd.input.value = '';
      st.show('ok', t.username.success);
    } else {
      st.show('err', result.error === 'NETWORK' ? t.errors.network : result.error);
    }
  });

  return el('section', { className: 'cca-card' }, [el('h2', {}, [t.username.heading]), form]);
}

function buildPasswordCard(t: ReturnType<typeof strings>): HTMLElement {
  const cur = field({ id: 'cca-p-cur', label: t.password.currentLabel, type: 'password', autocomplete: 'current-password' });
  const next = field({ id: 'cca-p-new', label: t.password.newLabel, type: 'password', help: t.password.newHelp, autocomplete: 'new-password' });
  const conf = field({ id: 'cca-p-conf', label: t.password.confirmLabel, type: 'password', autocomplete: 'new-password' });
  const btn = el('button', { type: 'submit', className: 'cca-btn' }, [t.password.submit]);
  const st = status();

  const form = el('form', { className: 'cca-form' }, [cur.wrap, next.wrap, conf.wrap, btn, st.node]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    st.clear();

    if (next.input.value !== conf.input.value) {
      st.show('err', t.password.mismatch);
      return;
    }

    btn.disabled = true;
    btn.textContent = t.password.saving;
    const result = await changePassword(cur.input.value, next.input.value);
    btn.disabled = false;
    btn.textContent = t.password.submit;
    if (result.ok) {
      persistToken(result.data.token);
      cur.input.value = next.input.value = conf.input.value = '';
      st.show('ok', t.password.success);
    } else {
      st.show('err', result.error === 'NETWORK' ? t.errors.network : result.error);
    }
  });

  return el('section', { className: 'cca-card' }, [el('h2', {}, [t.password.heading]), form]);
}

export async function mount(container: HTMLElement, _api: unknown): Promise<void> {
  ensureStyles();
  const t = strings(pickLang());

  const root = el('div', { className: 'cca-root' });
  root.append(
    el('h1', { className: 'cca-h1' }, [t.title]),
    el('p', { className: 'cca-sub' }, [t.subtitle]),
  );
  container.replaceChildren(root);

  const user: AuthUser | null = await fetchCurrentUser();
  root.append(buildUsernameCard(t, user?.username || ''));
  root.append(buildPasswordCard(t));
}

export function unmount(container: HTMLElement): void {
  container.replaceChildren();
}
