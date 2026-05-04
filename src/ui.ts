/**
 * Tiny DOM helpers — no framework.
 * Keeps the plug-in bundle small and free of host coupling.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Partial<HTMLElementTagNameMap[K]> & { class?: string; html?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'html') node.innerHTML = String(v);
    else (node as any)[k] = v;
  }
  for (const c of children) node.append(c);
  return node;
}

export function field(opts: {
  id: string;
  label: string;
  type?: string;
  help?: string;
  value?: string;
  autocomplete?: string;
}): { wrap: HTMLDivElement; input: HTMLInputElement } {
  const input = el('input', {
    id: opts.id,
    type: opts.type || 'text',
    value: opts.value || '',
    autocomplete: (opts.autocomplete || 'off') as AutoFill,
    className: 'cca-input',
  });
  const labelEl = el('label', { htmlFor: opts.id, className: 'cca-label' }, [opts.label]);
  const help = opts.help ? el('p', { className: 'cca-help' }, [opts.help]) : null;
  const wrap = el('div', { className: 'cca-field' }, help ? [labelEl, input, help] : [labelEl, input]);
  return { wrap, input };
}

export function status(): { node: HTMLParagraphElement; show: (kind: 'ok' | 'err', msg: string) => void; clear: () => void } {
  const node = el('p', { className: 'cca-status' });
  return {
    node,
    show(kind, msg) {
      node.textContent = msg;
      node.className = `cca-status cca-status--${kind === 'ok' ? 'ok' : 'err'}`;
    },
    clear() {
      node.textContent = '';
      node.className = 'cca-status';
    },
  };
}

export const STYLES = `
.cca-root { max-width: 560px; margin: 0 auto; padding: 24px; color: inherit; font: 14px/1.5 system-ui, sans-serif; }
.cca-h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
.cca-sub { color: #888; margin: 0 0 24px; }
.cca-card { border: 1px solid var(--cca-border, rgba(127,127,127,.25)); border-radius: 8px; padding: 20px; margin-bottom: 16px; background: var(--cca-bg, transparent); }
.cca-card h2 { font-size: 16px; font-weight: 600; margin: 0 0 16px; }
.cca-field { display: flex; flex-direction: column; margin-bottom: 14px; }
.cca-label { font-size: 13px; font-weight: 500; margin-bottom: 6px; }
.cca-input { padding: 8px 10px; border: 1px solid var(--cca-border, rgba(127,127,127,.4)); border-radius: 6px; background: transparent; color: inherit; font: inherit; }
.cca-input:focus { outline: 2px solid #4f8cff; outline-offset: 1px; }
.cca-help { font-size: 12px; color: #888; margin: 4px 0 0; }
.cca-btn { padding: 8px 14px; border: 0; border-radius: 6px; background: #4f8cff; color: #fff; font: inherit; font-weight: 500; cursor: pointer; }
.cca-btn:disabled { opacity: .55; cursor: not-allowed; }
.cca-status { font-size: 13px; margin: 10px 0 0; min-height: 1em; }
.cca-status--ok { color: #2e9b4f; }
.cca-status--err { color: #d44; }
`;
