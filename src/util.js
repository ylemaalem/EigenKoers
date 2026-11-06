// Kleine hulpfuncties die overal gebruikt worden.

/** HTML-escape voor alle tekst die van gebruikers komt (voorkomt XSS tussen cliënt en netwerk). */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const $ = (id) => document.getElementById(id);

export const COLORS = {
  green: {
    key: 'green',
    label: 'Groen',
    upper: 'GROEN',
    emoji: '🟢',
    name: 'Groen (Overzicht & Rust)',
    badge: 'bg-emerald-100 text-emerald-800',
    header: 'bg-emerald-600',
    dot: 'bg-emerald-300 animate-pulse',
    border: 'border-emerald-500',
    btnOn: 'border-emerald-500 bg-emerald-50',
    pillOn: 'border-emerald-500 bg-emerald-50 text-emerald-900',
  },
  orange: {
    key: 'orange',
    label: 'Oranje',
    upper: 'ORANJE',
    emoji: '🟠',
    name: 'Oranje (Hoofd raakt vol)',
    badge: 'bg-amber-100 text-amber-900',
    header: 'bg-amber-500',
    dot: 'bg-amber-200 animate-ping',
    border: 'border-amber-500',
    btnOn: 'border-amber-500 bg-amber-50',
    pillOn: 'border-amber-500 bg-amber-50 text-amber-900',
  },
  red: {
    key: 'red',
    label: 'Rood',
    upper: 'ROOD',
    emoji: '🔴',
    name: 'Rood (Te veel / Noodrem)',
    badge: 'bg-rose-100 text-rose-900',
    header: 'bg-rose-600',
    dot: 'bg-rose-200 animate-bounce',
    border: 'border-rose-600',
    btnOn: 'border-rose-500 bg-rose-50',
    pillOn: 'border-rose-500 bg-rose-50 text-rose-900',
  },
};
export const COLOR_KEYS = ['green', 'orange', 'red'];

export const DURATIONS = {
  short: '⏱️ Kort (15-30 min)',
  hour: '🕐 Gemiddeld (1 uur)',
  large: '🛠️ Groot (2 tot 3 uur)',
  half_day: '📅 Heel dagdeel',
};

export const ROLES = [
  'Familie / Ouder',
  'Familie / Overig',
  'Ambulant Begeleider',
  'Bewindvoerder',
  'Vriend / Buur / Kennis',
  'Werk / Dagbesteding',
  'Anders',
];

export function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

export function formatCode(code) {
  const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

export function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function euro(n) {
  if (n === null || n === undefined || n === '') return '–';
  const v = Math.round(Number(n) * 100) / 100;
  return '€' + (Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ','));
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** "Vandaag 09:15", "Gisteren 14:00", "3 nov 10:12" */
export function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (d.getTime() >= startToday) return `Vandaag ${time}`;
  if (d.getTime() >= startToday - DAY_MS) return `Gisteren ${time}`;
  const sameYear = d.getFullYear() === today.getFullYear();
  const date = d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
  return `${date} ${time}`;
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
let toastTimer = null;
export function toast(title, body, icon = '🔔', tone = 'info') {
  const el = $('push-toast');
  $('toast-title').textContent = title;
  $('toast-body').textContent = body || '';
  $('toast-icon').textContent = icon;
  el.classList.remove('border-indigo-500', 'border-rose-500', 'border-amber-400', 'border-emerald-500');
  el.classList.add(tone === 'error' ? 'border-rose-500' : tone === 'warn' ? 'border-amber-400' : tone === 'success' ? 'border-emerald-500' : 'border-indigo-500');
  $('toast-title').className = `text-xs font-extrabold uppercase tracking-wider ${tone === 'error' ? 'text-rose-300' : tone === 'warn' ? 'text-amber-300' : tone === 'success' ? 'text-emerald-300' : 'text-indigo-300'}`;
  el.classList.remove('-translate-y-40', 'opacity-0');
  el.classList.add('translate-y-0', 'opacity-100');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.add('-translate-y-40', 'opacity-0');
    el.classList.remove('translate-y-0', 'opacity-100');
  }, tone === 'error' ? 6500 : 4500);
}

export function toastError(err, fallbackTitle = 'Dat lukte niet') {
  toast(fallbackTitle, friendlyError(err), '⚠️', 'error');
}

/** Zet technische foutmeldingen om naar begrijpelijke Nederlandse tekst. */
export function friendlyError(err) {
  if (!err) return 'Er ging iets mis. Probeer het opnieuw.';
  const msg = String(err.message || err.error_description || err.msg || err || '');
  const code = String(err.code || '');
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) {
    return 'Geen verbinding met de server. Controleer je internet en probeer het opnieuw.';
  }
  if (/Invalid login credentials/i.test(msg)) return 'Dit e-mailadres of wachtwoord klopt niet.';
  if (/JWT expired|invalid JWT|refresh token/i.test(msg)) return 'Je sessie is verlopen. Log opnieuw in.';
  if (code === '23505' || /duplicate key/i.test(msg)) {
    if (/network_members_profile_email_key/.test(msg)) return 'Deze persoon (dit e-mailadres) staat al in je cirkel.';
    return 'Dit bestaat al.';
  }
  if (code === '23514' || /check constraint/i.test(msg)) {
    if (/email/.test(msg)) return 'Dit e-mailadres is niet geldig.';
    // Eigen (Nederlandse) meldingen uit de database doorgeven
    if (!/violates check constraint/i.test(msg)) return msg;
    return 'Een van de velden is niet goed ingevuld (te lang of leeg).';
  }
  if (code === '42501' && /permission denied|row-level security/i.test(msg)) {
    return 'Je hebt hier geen toestemming voor.';
  }
  // Meldingen uit onze eigen databasefuncties zijn al Nederlands
  if (/^[A-Z][^\n]{3,200}$/.test(msg) && !/^(permission|new row|null value|invalid input|relation|column|function)/i.test(msg)) {
    return msg;
  }
  return 'Er ging iets mis. Probeer het opnieuw.';
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------
const openStack = [];
let lastFocus = null;

export function openModal(id) {
  const m = $(id);
  if (!m || !m.hidden) return;
  lastFocus = document.activeElement;
  m.hidden = false;
  openStack.push(id);
  const focusable = m.querySelector('input:not([type=hidden]):not([type=checkbox]):not([hidden]), textarea');
  if (focusable && window.matchMedia('(pointer: fine)').matches) setTimeout(() => focusable.focus(), 30);
}

export function closeModal(id) {
  const m = $(id);
  if (!m || m.hidden) return;
  m.hidden = true;
  const i = openStack.lastIndexOf(id);
  if (i >= 0) openStack.splice(i, 1);
  if (lastFocus && document.body.contains(lastFocus) && openStack.length === 0) {
    try { lastFocus.focus({ preventScroll: true }); } catch (_) { /* negeren */ }
  }
}

export function topModal() {
  return openStack[openStack.length - 1] || null;
}

/** Eigen bevestigingsvenster i.p.v. window.confirm. */
export function confirmDialog({ title = 'Weet je het zeker?', body = '', ok = 'Ja, verwijderen', cancel = 'Nee, terug', danger = true } = {}) {
  return new Promise((resolve) => {
    $('confirm-title').textContent = title;
    $('confirm-body').textContent = body;
    const okBtn = $('confirm-ok');
    const cancelBtn = $('confirm-cancel');
    okBtn.textContent = ok;
    cancelBtn.textContent = cancel;
    okBtn.className = `flex-1 ${danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'} text-white font-bold text-xs py-3 rounded-xl shadow`;
    const done = (v) => {
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      $('confirm-modal').removeEventListener('modal-dismiss', onCancel);
      closeModal('confirm-modal');
      resolve(v);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    $('confirm-modal').addEventListener('modal-dismiss', onCancel);
    openModal('confirm-modal');
  });
}

export function infoDialog(title, html) {
  $('info-title').textContent = title;
  $('info-body').innerHTML = html; // alleen vaste teksten
  openModal('info-modal');
}

/** Knop tijdelijk uitschakelen met spinner tijdens een serververzoek. */
export async function withBusy(button, fn) {
  if (!button) return fn();
  if (button.dataset.busy === '1') return undefined;
  button.dataset.busy = '1';
  const prevDisabled = button.disabled;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    return await fn();
  } finally {
    button.dataset.busy = '';
    button.disabled = prevDisabled;
    button.removeAttribute('aria-busy');
  }
}

export function markInvalid(el, invalid = true) {
  if (!el) return;
  el.classList.toggle('input-invalid', invalid);
  if (invalid) {
    el.focus();
    const clear = () => { el.classList.remove('input-invalid'); el.removeEventListener('input', clear); el.removeEventListener('change', clear); };
    el.addEventListener('input', clear);
    el.addEventListener('change', clear);
  }
}

// ---------------------------------------------------------------------------
// Opslag in de browser (alleen gemaksinstellingen; mag altijd ontbreken)
// ---------------------------------------------------------------------------
export const local = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem('eigenkoers:' + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('eigenkoers:' + key, JSON.stringify(value));
    } catch (_) { /* privévenster of geblokkeerd: negeren */ }
  },
  remove(key) {
    try { localStorage.removeItem('eigenkoers:' + key); } catch (_) { /* negeren */ }
  },
};

export const session = {
  get(key) {
    try { return sessionStorage.getItem('eigenkoers:' + key); } catch (_) { return null; }
  },
  set(key, value) {
    try { sessionStorage.setItem('eigenkoers:' + key, value); } catch (_) { /* negeren */ }
  },
  remove(key) {
    try { sessionStorage.removeItem('eigenkoers:' + key); } catch (_) { /* negeren */ }
  },
};

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    ta.remove();
    return ok;
  }
}
