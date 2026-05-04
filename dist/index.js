// src/api.ts
var TOKEN_KEY = "auth-token";
function token() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function persistToken(t) {
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
  }
}
async function call(url, body) {
  let res;
  try {
    const headers = { "Content-Type": "application/json" };
    const t = token();
    if (t) headers["Authorization"] = `Bearer ${t}`;
    res = await fetch(url, { method: "PUT", headers, body: JSON.stringify(body) });
  } catch {
    return { ok: false, error: "NETWORK" };
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) {
    return { ok: false, error: data && data.error || `HTTP ${res.status}` };
  }
  return { ok: true, data };
}
function changePassword(currentPassword, newPassword) {
  return call("/api/auth/account/password", {
    currentPassword,
    newPassword
  });
}
function changeUsername(currentPassword, newUsername) {
  return call("/api/auth/account/username", {
    currentPassword,
    newUsername
  });
}
async function fetchCurrentUser() {
  try {
    const headers = {};
    const t = token();
    if (t) headers["Authorization"] = `Bearer ${t}`;
    const res = await fetch("/api/auth/user", { headers });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.user ? { id: data.user.id, username: data.user.username } : null;
  } catch {
    return null;
  }
}

// src/i18n.ts
var dict = {
  en: {
    title: "Account",
    subtitle: "Change your username or password.",
    username: {
      heading: "Change username",
      currentLabel: "Current username",
      newLabel: "New username",
      newHelp: "3\u201332 characters. Letters, numbers, underscore.",
      passwordLabel: "Current password",
      submit: "Update username",
      saving: "Updating\u2026",
      success: "Username updated."
    },
    password: {
      heading: "Change password",
      currentLabel: "Current password",
      newLabel: "New password",
      newHelp: "At least 8 characters.",
      confirmLabel: "Confirm new password",
      submit: "Update password",
      saving: "Updating\u2026",
      success: "Password updated.",
      mismatch: "Passwords do not match."
    },
    errors: {
      network: "Network error. Please try again.",
      generic: "Something went wrong."
    }
  },
  ar: {
    title: "\u0627\u0644\u062D\u0633\u0627\u0628",
    subtitle: "\u063A\u064A\u0651\u0631 \u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0623\u0648 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631.",
    username: {
      heading: "\u062A\u063A\u064A\u064A\u0631 \u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645",
      currentLabel: "\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u062D\u0627\u0644\u064A",
      newLabel: "\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u062C\u062F\u064A\u062F",
      newHelp: "\u0645\u0646 3 \u0625\u0644\u0649 32 \u062D\u0631\u0641\u0627\u064B. \u062D\u0631\u0648\u0641 \u0648\u0623\u0631\u0642\u0627\u0645 \u0648\u0634\u0631\u0637\u0629 \u0633\u0641\u0644\u064A\u0629.",
      passwordLabel: "\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0627\u0644\u062D\u0627\u0644\u064A\u0629",
      submit: "\u062A\u062D\u062F\u064A\u062B \u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645",
      saving: "\u062C\u0627\u0631\u064D \u0627\u0644\u062A\u062D\u062F\u064A\u062B\u2026",
      success: "\u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645."
    },
    password: {
      heading: "\u062A\u063A\u064A\u064A\u0631 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631",
      currentLabel: "\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0627\u0644\u062D\u0627\u0644\u064A\u0629",
      newLabel: "\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0627\u0644\u062C\u062F\u064A\u062F\u0629",
      newHelp: "8 \u0623\u062D\u0631\u0641 \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644.",
      confirmLabel: "\u062A\u0623\u0643\u064A\u062F \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0627\u0644\u062C\u062F\u064A\u062F\u0629",
      submit: "\u062A\u062D\u062F\u064A\u062B \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631",
      saving: "\u062C\u0627\u0631\u064D \u0627\u0644\u062A\u062D\u062F\u064A\u062B\u2026",
      success: "\u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631.",
      mismatch: "\u0643\u0644\u0645\u062A\u0627 \u0627\u0644\u0645\u0631\u0648\u0631 \u063A\u064A\u0631 \u0645\u062A\u0637\u0627\u0628\u0642\u062A\u064A\u0646."
    },
    errors: {
      network: "\u062E\u0637\u0623 \u0641\u064A \u0627\u0644\u0634\u0628\u0643\u0629. \u062D\u0627\u0648\u0644 \u0645\u062C\u062F\u062F\u0627\u064B.",
      generic: "\u062D\u062F\u062B \u062E\u0637\u0623 \u0645\u0627."
    }
  }
};
function pickLang() {
  const lang = typeof navigator !== "undefined" && navigator.language || "en";
  return lang.toLowerCase().startsWith("ar") ? "ar" : "en";
}
function strings(lang) {
  return dict[lang];
}

// src/ui.ts
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") node.className = String(v);
    else if (k === "html") node.innerHTML = String(v);
    else node[k] = v;
  }
  for (const c of children) node.append(c);
  return node;
}
function field(opts) {
  const input = el("input", {
    id: opts.id,
    type: opts.type || "text",
    value: opts.value || "",
    autocomplete: opts.autocomplete || "off",
    className: "cca-input"
  });
  const labelEl = el("label", { htmlFor: opts.id, className: "cca-label" }, [opts.label]);
  const help = opts.help ? el("p", { className: "cca-help" }, [opts.help]) : null;
  const wrap = el("div", { className: "cca-field" }, help ? [labelEl, input, help] : [labelEl, input]);
  return { wrap, input };
}
function status() {
  const node = el("p", { className: "cca-status" });
  return {
    node,
    show(kind, msg) {
      node.textContent = msg;
      node.className = `cca-status cca-status--${kind === "ok" ? "ok" : "err"}`;
    },
    clear() {
      node.textContent = "";
      node.className = "cca-status";
    }
  };
}
var STYLES = `
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

// src/index.ts
var styleEl = null;
function ensureStyles() {
  if (styleEl) return;
  styleEl = document.createElement("style");
  styleEl.setAttribute("data-account-plugin", "");
  styleEl.textContent = STYLES;
  document.head.appendChild(styleEl);
}
function buildUsernameCard(t, currentUsername) {
  const cur = field({ id: "cca-u-cur", label: t.username.currentLabel, value: currentUsername });
  cur.input.disabled = true;
  const next = field({ id: "cca-u-new", label: t.username.newLabel, help: t.username.newHelp, autocomplete: "username" });
  const pwd = field({ id: "cca-u-pwd", label: t.username.passwordLabel, type: "password", autocomplete: "current-password" });
  const btn = el("button", { type: "submit", className: "cca-btn" }, [t.username.submit]);
  const st = status();
  const form = el("form", { className: "cca-form" }, [cur.wrap, next.wrap, pwd.wrap, btn, st.node]);
  form.addEventListener("submit", async (event) => {
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
      next.input.value = "";
      pwd.input.value = "";
      st.show("ok", t.username.success);
    } else {
      st.show("err", result.error === "NETWORK" ? t.errors.network : result.error);
    }
  });
  return el("section", { className: "cca-card" }, [el("h2", {}, [t.username.heading]), form]);
}
function buildPasswordCard(t) {
  const cur = field({ id: "cca-p-cur", label: t.password.currentLabel, type: "password", autocomplete: "current-password" });
  const next = field({ id: "cca-p-new", label: t.password.newLabel, type: "password", help: t.password.newHelp, autocomplete: "new-password" });
  const conf = field({ id: "cca-p-conf", label: t.password.confirmLabel, type: "password", autocomplete: "new-password" });
  const btn = el("button", { type: "submit", className: "cca-btn" }, [t.password.submit]);
  const st = status();
  const form = el("form", { className: "cca-form" }, [cur.wrap, next.wrap, conf.wrap, btn, st.node]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    st.clear();
    if (next.input.value !== conf.input.value) {
      st.show("err", t.password.mismatch);
      return;
    }
    btn.disabled = true;
    btn.textContent = t.password.saving;
    const result = await changePassword(cur.input.value, next.input.value);
    btn.disabled = false;
    btn.textContent = t.password.submit;
    if (result.ok) {
      persistToken(result.data.token);
      cur.input.value = next.input.value = conf.input.value = "";
      st.show("ok", t.password.success);
    } else {
      st.show("err", result.error === "NETWORK" ? t.errors.network : result.error);
    }
  });
  return el("section", { className: "cca-card" }, [el("h2", {}, [t.password.heading]), form]);
}
async function mount(container, _api) {
  ensureStyles();
  const t = strings(pickLang());
  const root = el("div", { className: "cca-root" });
  root.append(
    el("h1", { className: "cca-h1" }, [t.title]),
    el("p", { className: "cca-sub" }, [t.subtitle])
  );
  container.replaceChildren(root);
  const user = await fetchCurrentUser();
  root.append(buildUsernameCard(t, user?.username || ""));
  root.append(buildPasswordCard(t));
}
function unmount(container) {
  container.replaceChildren();
}
export {
  mount,
  unmount
};
