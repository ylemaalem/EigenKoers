import './style.css';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, IS_CONFIGURED } from './config.js';
import { HELP } from './help-texts.js';
import { VISUAL_SCENARIOS, buildCustomScenario } from './scenarios.js';
import {
  esc, $, COLORS, COLOR_KEYS, DURATIONS, ROLES, firstName, formatCode, normalizeCode, euro, fmtWhen,
  toast, toastError, friendlyError, openModal, closeModal, topModal, confirmDialog, infoDialog, withBusy,
  markInvalid, local, session, copyText,
} from './util.js';

const sb = IS_CONFIGURED
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null;

const DURATION_SHORT = { short: '15-30 min', hour: '1 uur', large: '2-3 uur', half_day: 'dagdeel' };

const state = {
  user: null,
  mode: 'client',
  profiles: [],
  activeProfileId: null,
  loadedProfileId: null,
  plans: {},
  goals: [],
  members: [],
  tasks: [],
  choices: [],
  notifications: [],
  viewPhase: 'green',
  clientTab: 'status',
  scenarioKey: 'scooter',
  customScenario: null,
  networks: [],
  networkMemberId: null,
  networkView: null,
  pendingInvite: null,
  editingGoalId: null,
  editingTaskId: null,
  editingMemberId: null,
  moodDraft: null,
  sigDrafts: null,
  sigOriginal: null,
  sigEditing: null,
  realtimeChannel: null,
  pollTimer: null,
  isAdmin: false,
  admin: { from: '', to: '', type: 'ALL', data: null, logs: [], total: 0, request: 0 },
};

const activeProfile = () => state.profiles.find((p) => p.id === state.activeProfileId) || null;
const userKey = (k) => `${k}:${state.user?.id || 'anon'}`;
const emptyPlan = (color) => ({ id: null, color, signals_text: '', signal_chips: [], self_actions: [], network_actions: [] });
const helpBtn = (key, label = 'Uitleg') =>
  `<button type="button" class="help-btn" data-help="${key}" aria-label="${esc(label)}" aria-expanded="false">?</button>`;

// =============================================================================
// SCHERMEN
// =============================================================================
function showScreen(name) {
  for (const s of ['loading', 'auth', 'onboarding', 'app']) $('screen-' + s).hidden = s !== name;
}

function showFatal(title, message, retry = true) {
  showScreen('loading');
  $('screen-loading').innerHTML = `
    <div class="text-4xl">⚠️</div>
    <div class="text-lg font-black text-center px-6">${esc(title)}</div>
    <p class="text-xs text-slate-300 text-center px-8 leading-relaxed">${esc(message)}</p>
    ${retry ? '<button type="button" data-action="reload-page" class="btn-primary">Opnieuw proberen</button>' : ''}`;
}

// =============================================================================
// START
// =============================================================================
async function init() {
  wireEvents();
  renderProfileFieldGroups();
  fillRoleSelect();

  if (!IS_CONFIGURED) {
    showFatal('Nog niet gekoppeld', 'Deze versie van EigenKoers is nog niet verbonden met de database.', false);
    return;
  }

  const params = new URLSearchParams(location.search);
  const code = params.get('uitnodiging') || params.get('invite');
  if (code) {
    session.set('pendingInvite', normalizeCode(code));
    params.delete('uitnodiging');
    params.delete('invite');
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }
  state.pendingInvite = session.get('pendingInvite');

  sb.auth.onAuthStateChange((event, sess) => {
    if (event === 'SIGNED_OUT') {
      setTimeout(() => {
        resetState();
        showAuth();
      }, 0);
    } else if (sess?.user) {
      state.user = sess.user;
    }
  });

  try {
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    if (data.session?.user) await afterLogin(data.session.user);
    else await showAuth();
  } catch (err) {
    showFatal('Kan EigenKoers niet laden', friendlyError(err));
  }
}

function resetState() {
  stopRealtime();
  stopPolling();
  Object.assign(state, {
    user: null, profiles: [], activeProfileId: null, loadedProfileId: null, plans: {}, goals: [], members: [],
    tasks: [], choices: [], notifications: [], networks: [], networkMemberId: null, networkView: null,
    editingGoalId: null, editingTaskId: null, editingMemberId: null,
    isAdmin: false, admin: { from: '', to: '', type: 'ALL', data: null, logs: [], total: 0, request: 0 },
  });
  $('mode-btn-admin').hidden = true;
  for (const id of ['account-modal', 'mood-modal', 'goal-editor-modal', 'signaling-editor-modal', 'invite-share-modal', 'notifications-modal', 'confirm-modal', 'info-modal']) closeModal(id);
}

// =============================================================================
// INLOGGEN / REGISTREREN
// =============================================================================
async function showAuth() {
  showScreen('auth');
  setAuthTab(state.pendingInvite ? 'register' : 'login');
  const banner = $('auth-invite-banner');
  banner.hidden = true;
  if (!state.pendingInvite) return;
  const { data, error } = await sb.rpc('peek_invite', { p_code: state.pendingInvite });
  if (!error && data) {
    banner.className = 'bg-emerald-50 border-2 border-emerald-300 p-4 rounded-2xl text-xs text-emerald-950 leading-relaxed';
    banner.innerHTML = data.already_joined
      ? `👋 Deze uitnodiging van <strong>${esc(data.client_first_name)}</strong> is al gebruikt. Log in met <strong>${esc(data.email_masked)}</strong> om mee te kijken.`
      : `🎉 <strong>${esc(data.client_first_name)}</strong> nodigt je uit om mee te kijken als <strong>${esc(data.member_name)}</strong>.<br>Maak een account (of log in) met het e-mailadres <strong>${esc(data.email_masked)}</strong>. Daarna word je automatisch gekoppeld.`;
    if (data.already_joined) setAuthTab('login');
  } else {
    banner.className = 'bg-amber-50 border-2 border-amber-300 p-4 rounded-2xl text-xs text-amber-950 leading-relaxed';
    banner.innerHTML = '⚠️ Deze uitnodigingslink klopt niet (meer). Vraag om een nieuwe uitnodiging. Inloggen kan wel gewoon.';
    session.remove('pendingInvite');
    state.pendingInvite = null;
  }
  banner.hidden = false;
}

function setAuthTab(tab) {
  const on = 'py-2 rounded-lg text-xs font-bold bg-white shadow text-slate-900';
  const off = 'py-2 rounded-lg text-xs font-bold text-slate-500';
  $('auth-tab-login').className = tab === 'login' ? on : off;
  $('auth-tab-register').className = tab === 'register' ? on : off;
  $('form-login').hidden = tab !== 'login';
  $('form-register').hidden = tab !== 'register';
  $('login-error').hidden = true;
  $('register-error').hidden = true;
}

function showFormError(id, message) {
  const el = $(id);
  el.textContent = message;
  el.hidden = false;
}

async function onLogin(e) {
  e.preventDefault();
  $('login-error').hidden = true;
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  if (!email) return markInvalid($('login-email'));
  if (!password) return markInvalid($('login-password'));
  const btn = e.submitter || $('form-login').querySelector('[type=submit]');
  await withBusy(btn, async () => {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return showFormError('login-error', friendlyError(error));
    $('login-password').value = '';
    await afterLogin(data.user);
  });
}

async function onRegister(e) {
  e.preventDefault();
  $('register-error').hidden = true;
  const full_name = $('reg-name').value.trim();
  const email = $('reg-email').value.trim();
  const password = $('reg-password').value;
  if (!full_name) return markInvalid($('reg-name'));
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    markInvalid($('reg-email'));
    return showFormError('register-error', 'Vul een geldig e-mailadres in.');
  }
  if (password.length < 8) {
    markInvalid($('reg-password'));
    return showFormError('register-error', 'Kies een wachtwoord van minimaal 8 tekens.');
  }
  const btn = e.submitter || $('form-register').querySelector('[type=submit]');
  await withBusy(btn, async () => {
    let res;
    let body = {};
    try {
      res = await fetch(`${SUPABASE_URL}/functions/v1/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({ email, password, full_name }),
      });
      body = await res.json().catch(() => ({}));
    } catch (err) {
      return showFormError('register-error', friendlyError(err));
    }
    if (!res.ok) {
      if (body.error === 'email_exists') {
        setAuthTab('login');
        $('login-email').value = email;
        return showFormError('login-error', body.message || 'Er bestaat al een account met dit e-mailadres. Log in.');
      }
      return showFormError('register-error', body.message || 'Account maken lukte niet. Probeer het opnieuw.');
    }
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return showFormError('register-error', friendlyError(error));
    $('reg-password').value = '';
    toast('Account gemaakt ✨', 'Welkom bij EigenKoers!', '🎉', 'success');
    await afterLogin(data.user);
  });
}

async function afterLogin(user) {
  state.user = user;
  showScreen('loading');
  $('screen-loading').innerHTML = '<div class="text-4xl">🚦</div><div class="text-lg font-black">EigenKoers</div><div class="spinner"></div>';

  if (state.pendingInvite) {
    const code = state.pendingInvite;
    session.remove('pendingInvite');
    state.pendingInvite = null;
    const { data, error } = await sb.rpc('accept_invite', { p_code: code });
    if (error) {
      toast('Uitnodiging niet gekoppeld', friendlyError(error), '⚠️', 'error');
    } else {
      toast('Gekoppeld! 🎉', `Je kijkt nu mee in het netwerk van ${data.client_name}.`, '👥', 'success');
      state.networkMemberId = data.member_id;
      local.set(userKey('networkMember'), data.member_id);
      local.set(userKey('mode'), 'network');
    }
  }

  try {
    await Promise.all([loadProfiles(), loadNetworks(), loadAdminFlag()]);
  } catch (err) {
    return showFatal('Kan je gegevens niet laden', friendlyError(err));
  }

  if (!state.profiles.length && !state.networks.length && !state.isAdmin) return showOnboarding();
  await enterApp();
}

// Beheerder? (de database beslist; mislukt de controle, dan gewoon geen admin)
async function loadAdminFlag() {
  const { data, error } = await sb.rpc('am_i_admin');
  state.isAdmin = !error && data === true;
}

function showOnboarding() {
  showScreen('onboarding');
  const name = state.user?.user_metadata?.full_name || '';
  $('onboarding-name').textContent = firstName(name) || 'daar';
  if (!$('onb-name').value) $('onb-name').value = name;
}

async function logout() {
  closeModal('account-modal');
  await sb.auth.signOut();
  // onAuthStateChange regelt de rest
}

// =============================================================================
// PROFIEL-FORMULIEREN (onboarding, nieuw, wijzigen)
// =============================================================================
function profileFieldsHtml(prefix) {
  return `
    <div class="space-y-2.5">
      <div>
        <div class="field-row" data-help-anchor>
          <label for="${prefix}-name" class="label">Naam cliënt *</label>${helpBtn('profile-name', 'Uitleg naam cliënt')}
        </div>
        <input id="${prefix}-name" type="text" maxlength="120" autocomplete="off" class="input bg-white mt-1" placeholder="Voornaam (en evt. achternaam) cliënt">
      </div>
      <div>
        <div class="field-row" data-help-anchor>
          <label for="${prefix}-sup" class="label">Ambulant begeleider</label>${helpBtn('profile-supervisor', 'Uitleg begeleider')}
        </div>
        <input id="${prefix}-sup" type="text" maxlength="120" autocomplete="off" class="input bg-white mt-1" placeholder="Bijv. Mark">
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <div class="field-row" data-help-anchor>
            <label for="${prefix}-budget" class="label">Weekgeld in €</label>${helpBtn('profile-budget', 'Uitleg weekgeld')}
          </div>
          <input id="${prefix}-budget" type="number" min="0" max="100000" step="0.01" inputmode="decimal" class="input bg-white mt-1" placeholder="Bijv. 70">
        </div>
        <div>
          <div class="field-row" data-help-anchor>
            <label for="${prefix}-goal" class="label">Spaardoel</label>${helpBtn('profile-goal', 'Uitleg spaardoel')}
          </div>
          <input id="${prefix}-goal" type="text" maxlength="200" autocomplete="off" class="input bg-white mt-1" placeholder="Bijv. Laptop">
        </div>
      </div>
    </div>`;
}

function renderProfileFieldGroups() {
  document.querySelectorAll('[data-profile-fields]').forEach((el) => {
    el.innerHTML = profileFieldsHtml(el.dataset.profileFields);
  });
}

function readProfileFields(prefix) {
  const nameEl = $(`${prefix}-name`);
  const budgetEl = $(`${prefix}-budget`);
  const full_name = nameEl.value.trim();
  if (!full_name) {
    markInvalid(nameEl);
    toast('Naam ontbreekt', 'Vul minimaal de voornaam van de cliënt in.', '⚠️', 'warn');
    return null;
  }
  const rawBudget = budgetEl.value.trim().replace(',', '.');
  let weekly_budget = null;
  if (rawBudget !== '') {
    weekly_budget = Number(rawBudget);
    if (!Number.isFinite(weekly_budget) || weekly_budget < 0 || weekly_budget > 100000) {
      markInvalid(budgetEl);
      toast('Weekgeld klopt niet', 'Vul een bedrag in tussen 0 en 100.000, bijvoorbeeld 70.', '⚠️', 'warn');
      return null;
    }
    weekly_budget = Math.round(weekly_budget * 100) / 100;
  }
  return {
    full_name,
    supervisor_name: $(`${prefix}-sup`).value.trim(),
    weekly_budget,
    savings_goal: $(`${prefix}-goal`).value.trim(),
  };
}

function fillProfileFields(prefix, p) {
  $(`${prefix}-name`).value = p?.full_name || '';
  $(`${prefix}-sup`).value = p?.supervisor_name || '';
  $(`${prefix}-budget`).value = p?.weekly_budget ?? '';
  $(`${prefix}-goal`).value = p?.savings_goal || '';
}

async function createProfile(values, button) {
  return withBusy(button, async () => {
    const { data, error } = await sb.from('profiles').insert(values).select().single();
    if (error) {
      toastError(error, 'Profiel maken lukte niet');
      return null;
    }
    state.profiles.push(data);
    return data;
  });
}

// =============================================================================
// APP & MODUS
// =============================================================================
async function enterApp() {
  showScreen('app');
  const stored = local.get(userKey('activeProfile'));
  state.activeProfileId = state.profiles.find((p) => p.id === stored)?.id || state.profiles[0]?.id || null;
  const storedMember = local.get(userKey('networkMember'));
  if (!state.networkMemberId && storedMember) state.networkMemberId = storedMember;
  let mode = local.get(userKey('mode')) || 'client';
  if (mode === 'admin' && !state.isAdmin) mode = 'client';
  if (!state.profiles.length && mode === 'client') {
    mode = state.isAdmin && !state.networks.length ? 'admin' : 'network';
  }
  await switchMode(mode);
}

async function switchMode(mode) {
  if (mode === 'admin' && !state.isAdmin) mode = 'client';
  state.mode = mode;
  local.set(userKey('mode'), mode);
  $('dashboard-client').hidden = mode !== 'client';
  $('dashboard-network').hidden = mode !== 'network';
  $('dashboard-admin').hidden = mode !== 'admin';
  $('network-viewer-bar').hidden = mode !== 'network';
  $('mode-btn-admin').hidden = !state.isAdmin;
  // Met de extra admin-knop iets compacter, zodat alles op één regel past
  const size = state.isAdmin ? 'text-[11px] px-1.5' : 'text-xs px-2';
  const base = `py-1.5 ${size} rounded-lg font-bold transition-all text-center`;
  const off = 'text-slate-300 hover:text-white';
  $('mode-btn-client').className = `flex-1 ${base} ${mode === 'client' ? 'bg-indigo-600 text-white shadow' : off}`;
  $('mode-btn-network').className = `flex-1 ${base} relative ${mode === 'network' ? 'bg-emerald-600 text-white shadow' : off}`;
  $('mode-btn-admin').className = `shrink-0 ${base} ${mode === 'admin' ? 'bg-amber-500 text-slate-950 shadow' : 'text-amber-300 hover:text-white'}`;

  if (mode === 'client') {
    stopPolling();
    await openClientDashboard();
  } else if (mode === 'network') {
    await openNetworkDashboard();
  } else {
    stopPolling();
    await openAdminDashboard();
  }
}

// =============================================================================
// DASHBOARD 1: CLIËNT – DATA
// =============================================================================
async function loadProfiles() {
  const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  state.profiles = data || [];
}

async function loadNetworks() {
  const { data, error } = await sb.rpc('list_my_networks');
  if (error) throw error;
  state.networks = data || [];
}

const LOADERS = {
  plans: (pid) => sb.from('signaling_plans').select('*').eq('profile_id', pid),
  goals: (pid) => sb.from('learning_goals').select('*').eq('profile_id', pid).order('created_at', { ascending: true }).order('id', { ascending: true }),
  members: (pid) => sb.from('network_members').select('*').eq('profile_id', pid).order('created_at', { ascending: true }).order('id', { ascending: true }),
  tasks: (pid) => sb.from('tasks').select('*').eq('profile_id', pid).order('created_at', { ascending: false }),
  choices: (pid) => sb.from('saved_choices').select('*').eq('profile_id', pid).order('created_at', { ascending: false }),
  notifications: (pid) => sb.from('notifications').select('*').eq('profile_id', pid).order('created_at', { ascending: false }).limit(100),
};

async function reload(...keys) {
  const pid = state.activeProfileId;
  if (!pid) return;
  const results = await Promise.all(keys.map((k) => LOADERS[k](pid)));
  if (pid !== state.activeProfileId) return; // ondertussen gewisseld
  results.forEach((res, i) => {
    if (res.error) throw res.error;
    const key = keys[i];
    if (key === 'plans') {
      state.plans = Object.fromEntries(COLOR_KEYS.map((c) => [c, res.data.find((p) => p.color === c) || emptyPlan(c)]));
    } else {
      state[key] = res.data || [];
    }
  });
}

async function reloadProfile() {
  const pid = state.activeProfileId;
  const { data, error } = await sb.from('profiles').select('*').eq('id', pid).single();
  if (error) throw error;
  const i = state.profiles.findIndex((p) => p.id === pid);
  if (i >= 0) state.profiles[i] = data;
}

async function openClientDashboard() {
  const p = activeProfile();
  const hasProfile = !!p;
  $('client-header').hidden = !hasProfile;
  $('client-main').hidden = !hasProfile;
  document.querySelector('#dashboard-client > nav').hidden = !hasProfile;
  $('client-no-profile').hidden = hasProfile;
  if (!hasProfile) {
    stopRealtime();
    renderNoProfile();
    return;
  }
  const ok = await ensureProfileDataLoaded();
  if (!ok) return;
  renderClient();
  switchClientTab(state.clientTab);
  if (state.realtimePid !== p.id) startRealtime();
}

async function setActiveProfile(id) {
  state.activeProfileId = id;
  state.loadedProfileId = null;
  local.set(userKey('activeProfile'), id);
  if (state.mode === 'client') await openClientDashboard();
  else await ensureProfileDataLoaded();
}

/** Laadt alle gegevens van het actieve profiel (één keer per profielwissel). */
async function ensureProfileDataLoaded() {
  const p = activeProfile();
  if (!p) return false;
  if (state.loadedProfileId === p.id) return true;
  try {
    await reload('plans', 'goals', 'members', 'tasks', 'choices', 'notifications');
  } catch (err) {
    toastError(err, 'Laden lukte niet');
    return false;
  }
  if (activeProfile()?.id !== p.id) return false;
  state.loadedProfileId = p.id;
  state.viewPhase = p.current_mood || 'green';
  state.scenarioKey = local.get(`scenario:${p.id}`) || (p.is_demo ? 'scooter' : 'custom');
  state.customScenario = null;
  $('custom-dilemma-title').value = '';
  $('custom-dilemma-cost').value = '';
  cancelTaskEdit();
  closeInviteForm();
  return true;
}

function renderNoProfile() {
  $('client-no-profile').innerHTML = `
    <div class="card space-y-3 text-center">
      <div class="text-4xl">🧭</div>
      <h2 class="text-base font-black text-slate-900">Je hebt nog geen eigen profiel</h2>
      <p class="text-xs text-slate-600 leading-relaxed">${state.networks.length
        ? 'Je kijkt nu alleen mee in het netwerk van iemand anders. Wil je EigenKoers ook zelf gebruiken, of begeleid je cliënten? Maak dan een profiel aan.'
        : 'Wil je EigenKoers zelf gebruiken, of begeleid je cliënten? Maak dan een profiel aan. Je kunt ook eerst het voorbeeldprofiel bekijken.'}</p>
      <button type="button" data-action="open-account" class="btn-primary w-full">✨ Blanco profiel maken</button>
      <button type="button" data-action="load-demo" class="btn-soft w-full border border-slate-300">🧪 Voorbeeld/Demo-profiel (Daan Vermeulen) laden</button>
    </div>
    <div class="card flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="text-[10px] font-bold uppercase text-slate-400">Ingelogd als</div>
        <div class="text-xs font-extrabold text-slate-900 truncate">${esc(state.user?.email || '')}</div>
      </div>
      <button type="button" data-action="logout" class="btn-small bg-white border border-slate-300 text-slate-700 shrink-0">Uitloggen</button>
    </div>`;
}

// =============================================================================
// DASHBOARD 1: CLIËNT – WEERGAVE
// =============================================================================
function renderClient() {
  if (!activeProfile()) return;
  renderHeader();
  renderStatusTab();
  renderKeuzeTab();
  renderTasksTab();
  renderCircleTab();
  updateBadges();
}

function renderHeader() {
  const p = activeProfile();
  const c = p.current_mood ? COLORS[p.current_mood] : null;
  $('client-title-name').textContent = p.full_name;
  $('header-supervisor').textContent = p.supervisor_name ? `Begeleider: ${p.supervisor_name}` : 'Begeleider: nog niet ingevuld';
  $('header-demo-badge').hidden = !p.is_demo;
  $('header-budget-text').textContent = `Weekgeld: ${p.weekly_budget === null ? '–' : euro(p.weekly_budget)}`;
  $('client-header').className = `${c ? c.header : 'bg-indigo-700'} text-white pt-4 pb-4 px-5 rounded-b-[24px] shadow-md transition-colors duration-500 shrink-0`;
  $('header-status-dot').className = `w-2.5 h-2.5 rounded-full shrink-0 ${c ? c.dot : 'bg-white/60'}`;
  $('header-status-text').textContent = c ? c.name : 'Nog niet ingevuld';
}

function renderStatusTab() {
  const p = activeProfile();
  // Stoplicht-knoppen
  COLOR_KEYS.forEach((k) => {
    const on = p.current_mood === k;
    const btn = $('btn-color-' + k);
    btn.className = on
      ? `p-3 rounded-2xl border-2 ${COLORS[k].btnOn} text-center transition-all flex flex-col items-center scale-105 shadow-sm`
      : `p-3 rounded-2xl border-2 border-slate-200 bg-slate-50 text-center transition-all flex flex-col items-center ${p.current_mood ? 'opacity-70' : ''}`;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  // Actuele status-update
  const box = $('current-reflection-box');
  const c = p.current_mood ? COLORS[p.current_mood] : null;
  box.className = `bg-white p-4 rounded-2xl shadow-sm border-l-4 ${c ? c.border : 'border-slate-300'} space-y-2`;
  if (!c) {
    box.innerHTML = `
      <div class="field-row" data-help-anchor>
        <span class="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Jouw status-update</span>${helpBtn('reflectie')}
      </div>
      <p class="text-xs text-slate-600 leading-relaxed">Je hebt je stoplicht nog niet ingevuld. Tik hierboven op <strong>Groen</strong>, <strong>Oranje</strong> of <strong>Rood</strong> om je eerste status te delen.</p>`;
  } else {
    const signals = Array.isArray(p.last_signals) ? p.last_signals : [];
    box.innerHTML = `
      <div class="field-row" data-help-anchor>
        <span class="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Jouw ingevulde status-update:</span>
        <span class="flex items-center gap-2"><span class="text-[10px] text-slate-400">${esc(fmtWhen(p.mood_updated_at))}</span>${helpBtn('reflectie')}</span>
      </div>
      ${signals.length ? `<div class="flex flex-wrap gap-1">${signals.map((s) => `<span class="text-[10px] font-bold ${c.badge} px-2 py-0.5 rounded-full">${esc(s)}</span>`).join('')}</div>` : ''}
      ${p.last_reason ? `<p class="text-xs font-bold text-slate-800 bg-slate-50 p-2.5 rounded-xl border border-slate-100 whitespace-pre-line">"${esc(p.last_reason)}"</p>` : ''}
      ${p.last_self_action ? `<div class="text-[11px] text-slate-600"><strong>Wat ik nu zelf doe:</strong> ${esc(p.last_self_action)}</div>` : ''}
      ${!p.last_reason && !p.last_self_action ? '<p class="text-[11px] text-slate-500">Geen toelichting. Dat is prima.</p>' : ''}`;
  }

  // Fasekiezer
  $('phase-tabs').innerHTML = COLOR_KEYS.map((k) => `
    <button type="button" data-action="view-phase" data-color="${k}" aria-pressed="${k === state.viewPhase}"
      class="phase-pill ${k === state.viewPhase ? COLORS[k].pillOn : 'border-slate-200 bg-slate-50 text-slate-500'}">
      ${COLORS[k].emoji} ${COLORS[k].label}${p.current_mood === k ? ' <span class="font-black">• nu</span>' : ''}
    </button>`).join('');

  renderReflectBanner();
  renderGoals();
  renderPlan();
}

function renderGoals() {
  const phase = COLORS[state.viewPhase];
  $('goals-color-label').textContent = phase.label;
  const goals = state.goals.filter((g) => g.color === state.viewPhase);
  const el = $('plan-daily-goals');
  if (!goals.length) {
    el.innerHTML = `<div class="empty-state">Nog geen leerdoelen ingevuld voor fase <strong>${phase.label}</strong>. Tik rechtsboven op <strong>+ Nieuw Leerdoel</strong> om je eerste doel toe te voegen!</div>`;
    return;
  }
  const done = goals.filter((g) => g.is_completed).length;
  el.innerHTML = `
    <div class="flex items-center gap-2 text-[10px] font-bold text-slate-500">
      <div class="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden"><div class="h-full bg-emerald-500 rounded-full transition-all" style="width:${Math.round((done / goals.length) * 100)}%"></div></div>
      <span>${done} van ${goals.length} gelukt</span>
    </div>
    ${goals.map((g) => `
      <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-start justify-between gap-2">
        <label class="flex items-start gap-2.5 flex-1 min-w-0 cursor-pointer">
          <input type="checkbox" ${g.is_completed ? 'checked' : ''} data-change="toggle-goal" data-id="${g.id}" class="w-4 h-4 accent-emerald-600 mt-1 rounded cursor-pointer shrink-0" aria-label="Leerdoel afvinken">
          <span class="min-w-0">
            ${g.category ? `<span class="text-[9px] font-extrabold uppercase text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">${esc(g.category)}</span>` : ''}
            <span class="block text-xs font-bold mt-1 break-words ${g.is_completed ? 'line-through text-slate-400' : 'text-slate-800'}">${esc(g.title)}</span>
          </span>
        </label>
        <div class="flex items-center gap-1 shrink-0">
          <button type="button" data-action="edit-goal" data-id="${g.id}" title="Leerdoel wijzigen" aria-label="Leerdoel wijzigen" class="icon-btn">✏️</button>
          <button type="button" data-action="delete-goal" data-id="${g.id}" title="Verwijderen" aria-label="Leerdoel verwijderen" class="icon-btn hover:bg-rose-50 text-rose-600">🗑️</button>
        </div>
      </div>`).join('')}`;
}

function renderPlan() {
  const phase = COLORS[state.viewPhase];
  const plan = state.plans[state.viewPhase] || emptyPlan(state.viewPhase);
  $('plan-phase-title').textContent = phase.name;
  const sig = $('plan-signals-text');
  if (plan.signals_text) {
    sig.textContent = plan.signals_text;
    sig.className = 'text-xs text-slate-600 leading-relaxed whitespace-pre-line';
  } else {
    sig.textContent = `Nog niet ingevuld. Tik op ✏️ Plan Wijzigen om te beschrijven hoe jij erbij zit in fase ${phase.label}.`;
    sig.className = 'text-xs text-slate-400 italic leading-relaxed';
  }
  $('plan-signal-chips').innerHTML = (plan.signal_chips || [])
    .map((s) => `<span class="text-[10px] font-bold bg-white border border-slate-200 text-slate-600 px-2 py-0.5 rounded-full">${esc(s)}</span>`)
    .join('');
  const list = (items, emptyText, emptyCls) =>
    items && items.length
      ? items.map((a) => `<li class="break-words">${esc(a)}</li>`).join('')
      : `<li class="list-none -ml-4 italic ${emptyCls}">${emptyText}</li>`;
  $('plan-self-actions').innerHTML = list(plan.self_actions, 'Nog geen eigen acties ingevuld.', 'text-indigo-900/50');
  $('plan-network-actions').innerHTML = list(plan.network_actions, 'Nog geen tips voor je netwerk ingevuld.', 'text-emerald-900/50');
}

function updateBadges() {
  const p = activeProfile();
  if (!p) return;
  const lastSeen = local.get(`seen:${p.id}`) || 0;
  const unread = state.notifications.filter((n) => n.from_network && new Date(n.created_at).getTime() > lastSeen).length;
  $('bell-badge').hidden = unread === 0;
  $('bell-badge').textContent = unread > 9 ? '9+' : String(unread);
  const counters = state.tasks.filter((t) => t.status === 'counter').length;
  $('tasks-badge').hidden = counters === 0;
  $('tasks-badge').textContent = String(counters);
}

function switchClientTab(tab) {
  state.clientTab = tab;
  ['status', 'keuze', 'taken', 'cirkel'].forEach((t) => {
    $('client-tab-' + t).hidden = t !== tab;
    $('cnav-' + t).className = t === tab
      ? 'flex flex-col items-center text-indigo-600 py-1 font-bold scale-105 transition-transform relative'
      : 'flex flex-col items-center text-slate-400 py-1 font-medium relative';
    $('cnav-' + t).setAttribute('aria-current', t === tab ? 'page' : 'false');
  });
  $('client-main').scrollTo({ top: 0 });
}

// =============================================================================
// STOPLICHT: VERPLICHTE REFLECTIE-CHECK
// =============================================================================
// =============================================================================
// STOPLICHT – zo licht mogelijk
// Groen: 1 tik. Oranje: 1 eigen actie kiezen, de rest mag.
// Rood: alleen bevestigen, met 112-tekst. Na Rood volgt later een
// vrijwillige terugblik ("reflectie achteraf").
// =============================================================================
const reflectKey = (pid) => userKey(`reflect:${pid}`);

function moodReceivers() {
  return state.members.filter((m) => m.can_see_mood).map((m) => firstName(m.name));
}

function openMoodModal(color) {
  const p = activeProfile();
  if (!p || !COLORS[color]) return;
  if (color === 'green') return saveMood({ color: 'green', signals: [], reason: '', action: '' });
  const plan = state.plans[color] || emptyPlan(color);
  state.moodDraft = {
    color,
    chips: [...(plan.signal_chips || [])],
    selected: new Set(),
    action: null, // index in plan.self_actions, 'custom' of null
    customAction: '',
    reason: '',
    moreOpen: false,
  };
  const c = COLORS[color];
  const badge = $('modal-target-badge');
  badge.textContent = p.current_mood === color ? `Nog steeds ${c.label}` : `Naar ${c.label}`;
  badge.className = `text-[10px] font-extrabold uppercase px-2 py-0.5 rounded ${c.badge}`;
  $('modal-target-title').textContent = color === 'red' ? '🔴 Te veel? Stop even.' : '🟠 Je hoofd raakt vol';
  const submit = $('mood-submit');
  submit.textContent = color === 'red' ? 'Ja, zet op Rood' : 'Zet op Oranje';
  submit.className = color === 'red' ? 'flex-1 btn-red' : 'flex-1 btn-dark';
  renderMoodBody();
  openModal('mood-modal');
}

function moodChoiceButtons(actions, d) {
  return actions.map((a, i) => {
    const on = d.action === i;
    return `<button type="button" data-action="pick-mood-action" data-index="${i}" aria-pressed="${on}" class="mood-choice ${on ? 'mood-choice-on' : ''}">${on ? '✓ ' : ''}${esc(a)}</button>`;
  }).join('');
}

function renderMoodBody() {
  const d = state.moodDraft;
  if (!d) return;
  const plan = state.plans[d.color] || emptyPlan(d.color);
  const actions = plan.self_actions || [];
  const receivers = moodReceivers();
  const who = receivers.length
    ? `<strong>${esc(receivers.join(', '))}</strong>`
    : 'nog niemand. Voeg mensen toe in <strong>Mijn Cirkel</strong>.';
  const el = $('mood-body');

  if (d.color === 'red') {
    el.innerHTML = `
      <div class="rounded-2xl bg-rose-50 border-2 border-rose-300 p-4 space-y-1.5">
        <p class="text-sm font-black text-rose-900">Tik op de rode knop. Dan ziet je netwerk dat je op Rood staat.</p>
        <p class="text-xs text-rose-900">Wie het ziet: ${who}</p>
      </div>
      <div class="rounded-2xl bg-slate-900 text-white p-4 space-y-2" role="note">
        <p class="text-sm font-black">EigenKoers is geen nooddienst.</p>
        <p class="text-xs leading-relaxed">Ben jij of iemand anders in gevaar? Bel dan meteen 112.</p>
        <a href="tel:112" class="inline-flex items-center gap-1.5 bg-white text-slate-900 font-black text-sm px-4 py-2 rounded-xl">📞 Bel 112</a>
      </div>
      ${actions.length ? `
        <div class="space-y-2">
          <p class="text-sm font-extrabold text-slate-800">Wat helpt jou nu? <span class="text-[11px] font-semibold text-slate-500">(mag, hoeft niet)</span></p>
          <div class="grid gap-2">${moodChoiceButtons(actions, d)}</div>
        </div>` : ''}`;
    return;
  }

  // Oranje
  const customOn = d.action === 'custom' || !actions.length;
  el.innerHTML = `
    <div class="space-y-2">
      <div class="field-row" data-help-anchor>
        <p class="text-sm font-extrabold text-slate-800">Wat ga je nu zelf doen?</p>${helpBtn('mood-actie', 'Uitleg eigen actie')}
      </div>
      <p class="text-[11px] text-slate-500">${actions.length ? 'Tik er één aan.' : 'Typ kort wat je gaat doen. Je mag ook inspreken met het microfoontje op je toetsenbord.'}</p>
      <div class="grid gap-2">
        ${moodChoiceButtons(actions, d)}
        ${actions.length ? `<button type="button" data-action="pick-mood-action" data-index="custom" aria-pressed="${d.action === 'custom'}" class="mood-choice ${d.action === 'custom' ? 'mood-choice-on' : ''}">${d.action === 'custom' ? '✓ ' : ''}✏️ Iets anders</button>` : ''}
      </div>
      <input type="text" id="mood-custom-action" maxlength="300" ${customOn ? '' : 'hidden'} value="${esc(d.customAction)}" placeholder="Bijvoorbeeld: even naar buiten" class="input">
      <p id="mood-action-error" hidden class="text-[11px] font-bold text-rose-700">Kies wat je zelf gaat doen.</p>
    </div>
    <div class="border-t border-slate-200 pt-3 space-y-2">
      <button type="button" data-action="toggle-mood-more" aria-expanded="${d.moreOpen}" class="text-xs font-bold text-indigo-700">${d.moreOpen ? '➖' : '➕'} Meer vertellen <span class="font-semibold text-slate-500">(mag)</span></button>
      ${d.moreOpen ? `
        ${d.chips.length ? `<div class="flex flex-wrap gap-1.5">${d.chips.map((chip, i) => {
          const on = d.selected.has(chip);
          return `<button type="button" data-action="toggle-mood-chip" data-index="${i}" aria-pressed="${on}" class="chip ${on ? 'chip-on' : ''}">${on ? '✓' : '+'} ${esc(chip)}</button>`;
        }).join('')}</div>` : ''}
        <textarea id="mood-reason" rows="2" maxlength="2000" placeholder="Wat wil je dat je netwerk weet? (mag leeg blijven)" class="input">${esc(d.reason)}</textarea>` : ''}
    </div>
    <p class="text-[11px] text-slate-500">Wie het ziet: ${who}</p>`;
}

function chosenMoodAction() {
  const d = state.moodDraft;
  const plan = state.plans[d.color] || emptyPlan(d.color);
  const actions = plan.self_actions || [];
  if (d.action === 'custom' || (!actions.length && d.color === 'orange')) return d.customAction.trim();
  if (typeof d.action === 'number') return actions[d.action] || '';
  return '';
}

async function confirmMoodChange(e) {
  e.preventDefault();
  const d = state.moodDraft;
  if (!d) return;
  const action = chosenMoodAction();
  if (d.color === 'orange' && !action) {
    $('mood-action-error').hidden = false;
    const input = $('mood-custom-action');
    if (input && !input.hidden) markInvalid(input);
    return;
  }
  const plan = state.plans[d.color] || emptyPlan(d.color);
  const isNewAction = d.color === 'orange' && action && !(plan.self_actions || []).includes(action);
  const btn = e.submitter || $('mood-submit');
  await withBusy(btn, async () => {
    const ok = await saveMood({
      color: d.color,
      signals: d.chips.filter((c) => d.selected.has(c)),
      reason: d.reason.trim(),
      action,
    });
    // Een zelf getypte actie bewaren we in het plan, zodat hij de volgende keer een knop is.
    if (ok && isNewAction && plan.id) {
      const patch = { self_actions: [...(plan.self_actions || []), action] };
      const { error } = await sb.from('signaling_plans').update(patch).eq('id', plan.id);
      if (!error) {
        Object.assign(plan, patch);
        renderPlan(); // het plan-scherm was al getekend vóór deze opslag
      }
    }
  });
}

async function saveMood({ color, signals, reason, action }) {
  const p = activeProfile();
  if (!p) return false;
  const prev = p.current_mood;
  const { data: updated, error } = await sb.from('profiles').update({
    current_mood: color,
    last_reason: reason,
    last_self_action: action,
    last_signals: signals,
    mood_updated_at: new Date().toISOString(),
  }).eq('id', p.id).select().single();
  if (error) {
    toastError(error, 'Opslaan lukte niet');
    return false;
  }
  Object.assign(p, updated);

  const c = COLORS[color];
  const receivers = moodReceivers();
  const receiverText = receivers.length ? receivers.join(', ') : 'alleen jouw logboek';
  await logNotification({
    kind: 'mood',
    recipient: receiverText,
    message: reason ? `${p.full_name} staat op ${c.upper}: "${reason}"` : `${p.full_name} staat op ${c.upper}`,
  });

  if (color === 'red') local.set(reflectKey(p.id), 'open');
  state.moodDraft = null;
  state.viewPhase = color;
  if (!$('mood-modal').hidden) closeModal('mood-modal');
  renderClient();
  toast(`Stoplicht op ${c.upper} 🚦`,
    receivers.length ? `Zichtbaar voor: ${receiverText}.` : 'Opgeslagen. Voeg mensen toe in Mijn Cirkel zodat zij het ook zien.',
    '🚦', 'success');

  if (prev === 'red' && color !== 'red' && local.get(reflectKey(p.id)) === 'open') openReflectModal();
  return true;
}

// --- Terugblik na Rood (altijd vrijwillig) ---------------------------------
function reflectionOpen(p) {
  return !!p && p.current_mood !== 'red' && local.get(reflectKey(p.id)) === 'open';
}

function renderReflectBanner() {
  const p = activeProfile();
  const el = $('reflect-banner');
  if (!el) return;
  if (!reflectionOpen(p)) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.innerHTML = `
    <div class="card border-l-4 border-rose-400 space-y-2">
      <p class="text-xs font-extrabold text-slate-800">Je stond op Rood. Wil je kort terugkijken?</p>
      <p class="text-[11px] text-slate-500">Dan weet je de volgende keer sneller wat helpt. Het hoeft niet.</p>
      <div class="flex gap-2">
        <button type="button" data-action="reflect-open" class="btn-small bg-slate-900 text-white">Nu doen</button>
        <button type="button" data-action="reflect-dismiss" class="btn-small btn-soft">Niet nodig</button>
      </div>
    </div>`;
}

function openReflectModal() {
  state.reflectDraft = { signals: new Set(), actions: new Set(), newSignal: '', newAction: '' };
  renderReflectBody();
  openModal('reflect-modal');
}

function renderReflectBody() {
  const r = state.reflectDraft;
  const plan = state.plans.red || emptyPlan('red');
  const chips = (items, kind) => items.map((t, i) => {
    const on = r[kind].has(t);
    return `<button type="button" data-action="reflect-toggle" data-kind="${kind}" data-index="${i}" aria-pressed="${on}" class="chip ${on ? 'chip-on' : ''}">${on ? '✓' : '+'} ${esc(t)}</button>`;
  }).join('');
  $('reflect-body').innerHTML = `
    <div class="space-y-2">
      <p class="text-sm font-extrabold text-slate-800">Wat merkte je toen het Rood werd?</p>
      ${(plan.signal_chips || []).length ? `<div class="flex flex-wrap gap-1.5">${chips(plan.signal_chips, 'signals')}</div>` : ''}
      <input type="text" id="reflect-new-signal" maxlength="80" value="${esc(r.newSignal)}" placeholder="Iets anders? (mag)" class="input">
    </div>
    <div class="space-y-2">
      <p class="text-sm font-extrabold text-slate-800">Wat hielp jou?</p>
      ${(plan.self_actions || []).length ? `<div class="flex flex-wrap gap-1.5">${chips(plan.self_actions, 'actions')}</div>` : ''}
      <input type="text" id="reflect-new-action" maxlength="300" value="${esc(r.newAction)}" placeholder="Iets anders? (mag)" class="input">
    </div>
    <p class="text-[11px] text-slate-500">Tip: je kunt ook inspreken met het microfoontje op je toetsenbord.</p>`;
}

async function saveReflection(e) {
  e.preventDefault();
  const p = activeProfile();
  const r = state.reflectDraft;
  const plan = state.plans.red || emptyPlan('red');
  if (!p || !r) return;
  const newSignal = r.newSignal.trim().slice(0, 80);
  const newAction = r.newAction.trim().slice(0, 300);
  const signals = [...r.signals, ...(newSignal ? [newSignal] : [])];
  const actions = [...r.actions, ...(newAction ? [newAction] : [])];
  if (!signals.length && !actions.length) return reflectLater();

  const btn = e.submitter || $('reflect-form').querySelector('[type=submit]');
  await withBusy(btn, async () => {
    const patch = {};
    if (newSignal && !(plan.signal_chips || []).some((c) => c.toLowerCase() === newSignal.toLowerCase())) {
      patch.signal_chips = [...(plan.signal_chips || []), newSignal];
    }
    if (newAction && !(plan.self_actions || []).includes(newAction)) {
      patch.self_actions = [...(plan.self_actions || []), newAction];
    }
    if (plan.id && Object.keys(patch).length) {
      const { error } = await sb.from('signaling_plans').update(patch).eq('id', plan.id);
      if (error) return toastError(error, 'Bewaren lukte niet');
      Object.assign(plan, patch);
    }
    const parts = [];
    if (signals.length) parts.push(`merkte: ${signals.join(', ')}`);
    if (actions.length) parts.push(`wat hielp: ${actions.join(', ')}`);
    await logNotification({
      kind: 'mood',
      recipient: moodReceivers().join(', ') || 'alleen jouw logboek',
      message: `Terugblik op Rood van ${p.full_name}: ${parts.join('. ')}`,
    });
    local.set(reflectKey(p.id), 'done');
    state.reflectDraft = null;
    closeModal('reflect-modal');
    renderClient();
    toast('Terugblik bewaard', 'Het staat in je plan voor Rood.', '💪', 'success');
  });
}

function reflectLater() {
  state.reflectDraft = null;
  closeModal('reflect-modal');
  renderReflectBanner();
}

// --- Voorlezen ----------------------------------------------------------------
function readAloud(el) {
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
    return toast('Voorlezen lukt niet', 'Dit apparaat ondersteunt voorlezen niet.', '🔇');
  }
  if (synth.speaking) {
    synth.cancel();
    return;
  }
  const root = (el.dataset.read && $(el.dataset.read)) || el.closest('.help-box');
  if (!root) return;
  const clone = root.cloneNode(true);
  clone.querySelectorAll('button[data-action="read-aloud"], button[data-action="close-modal"], input, textarea, select, [hidden]').forEach((n) => n.remove());
  const text = clone.innerText.replace(/[✓✕➕➖🔊💡•]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'nl-NL';
  u.rate = 0.9;
  const voice = synth.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith('nl'));
  if (voice) u.voice = voice;
  synth.speak(u);
}

async function logNotification({ kind, recipient, message, member_id = null }) {
  const p = activeProfile();
  if (!p) return;
  const { data, error } = await sb.from('notifications')
    .insert({ profile_id: p.id, kind, recipient: String(recipient || '').slice(0, 300), message: String(message).slice(0, 1000), member_id })
    .select().single();
  if (!error && data) state.notifications.unshift(data);
}

// =============================================================================
// LEERDOELEN
// =============================================================================
function openGoalEditor(goalId = null) {
  state.editingGoalId = goalId;
  const goal = goalId ? state.goals.find((g) => g.id === goalId) : null;
  $('goal-modal-heading').textContent = goal ? '✏️ Leerdoel Wijzigen' : '➕ Nieuw Leerdoel Toevoegen';
  $('goal-edit-color').value = goal ? goal.color : state.viewPhase;
  $('goal-edit-cat').value = goal?.category || '';
  $('goal-edit-title').value = goal?.title || '';
  openModal('goal-editor-modal');
}

async function saveGoal(e) {
  e.preventDefault();
  const color = $('goal-edit-color').value;
  const category = $('goal-edit-cat').value.trim();
  const title = $('goal-edit-title').value.trim();
  if (!title) {
    markInvalid($('goal-edit-title'));
    return toast('Leerdoel ontbreekt', 'Vul een korte omschrijving van het leerdoel in.', '⚠️', 'warn');
  }
  const btn = e.submitter || $('goal-form').querySelector('[type=submit]');
  await withBusy(btn, async () => {
    const res = state.editingGoalId
      ? await sb.from('learning_goals').update({ color, category, title }).eq('id', state.editingGoalId)
      : await sb.from('learning_goals').insert({ profile_id: state.activeProfileId, color, category, title });
    if (res.error) return toastError(res.error, 'Leerdoel opslaan lukte niet');
    await reload('goals');
    state.viewPhase = color;
    closeModal('goal-editor-modal');
    renderStatusTab();
    toast('Leerdoel Opgeslagen 🎯', `"${title}" staat bij fase ${COLORS[color].label}.`, '🎯', 'success');
  });
}

async function toggleGoal(el) {
  const goal = state.goals.find((g) => g.id === el.dataset.id);
  if (!goal) return;
  const value = el.checked;
  goal.is_completed = value;
  renderGoals();
  const { error } = await sb.from('learning_goals').update({ is_completed: value }).eq('id', goal.id);
  if (error) {
    goal.is_completed = !value;
    renderGoals();
    toastError(error, 'Afvinken lukte niet');
  } else if (value) {
    toast('Goed gedaan! 🌟', `"${goal.title}" is gelukt.`, '🎉', 'success');
  }
}

async function deleteGoal(id) {
  const goal = state.goals.find((g) => g.id === id);
  if (!goal) return;
  const ok = await confirmDialog({ title: 'Leerdoel verwijderen?', body: `"${goal.title}" wordt weggehaald.` });
  if (!ok) return;
  const { error } = await sb.from('learning_goals').delete().eq('id', id);
  if (error) return toastError(error, 'Verwijderen lukte niet');
  state.goals = state.goals.filter((g) => g.id !== id);
  renderGoals();
  toast('Leerdoel verwijderd', goal.title, '🗑️');
}

// =============================================================================
// SIGNALERINGSPLAN-EDITOR
// =============================================================================
const SIG_FIELDS = {
  signal_chips: { n: 2, title: 'Korte signalen om aan te tikken', help: 'sig-chips', placeholder: 'Bijv. Slecht geslapen', max: 80 },
  self_actions: { n: 3, title: 'Wat kun je ZELF doen? (één actie per regel)', help: 'sig-zelf', placeholder: 'Bijv. 30 minuten wandelen met muziek', max: 300 },
  network_actions: { n: 4, title: 'Wat moet je netwerk doen of laten? (één tip per regel)', help: 'sig-netwerk', placeholder: 'Bijv. Bel mij niet onverwacht over geld', max: 300 },
};

function openSignalingEditor() {
  const snapshot = {};
  COLOR_KEYS.forEach((c) => {
    const p = state.plans[c] || emptyPlan(c);
    snapshot[c] = {
      signals_text: p.signals_text || '',
      signal_chips: [...(p.signal_chips || [])],
      self_actions: [...(p.self_actions || [])],
      network_actions: [...(p.network_actions || [])],
    };
  });
  state.sigOriginal = JSON.stringify(snapshot);
  state.sigDrafts = JSON.parse(state.sigOriginal);
  state.sigEditing = null;
  $('sig-edit-color').value = state.viewPhase;
  renderSigEditor();
  openModal('signaling-editor-modal');
}

function sigDirty() {
  return state.sigDrafts && JSON.stringify(state.sigDrafts) !== state.sigOriginal;
}

function renderSigEditor() {
  const color = $('sig-edit-color').value;
  const draft = state.sigDrafts[color];
  $('sig-edit-signals').value = draft.signals_text;
  document.querySelectorAll('[data-list-editor]').forEach((wrap) => {
    const field = wrap.dataset.listEditor;
    const meta = SIG_FIELDS[field];
    const items = draft[field];
    wrap.innerHTML = `
      <div class="field-row" data-help-anchor>
        <span class="label">${meta.n}. ${meta.title}</span>${helpBtn(meta.help)}
      </div>
      <ul class="mt-1 space-y-1.5">
        ${items.length ? items.map((item, i) => {
          const editing = state.sigEditing && state.sigEditing.field === field && state.sigEditing.index === i;
          return editing
            ? `<li class="flex items-center gap-1.5 bg-indigo-50 border border-indigo-200 rounded-xl p-1.5">
                 <input type="text" class="input bg-white" data-sig-edit-input="${field}" data-index="${i}" maxlength="${meta.max}" value="${esc(item)}" aria-label="Tekst wijzigen">
                 <button type="button" data-action="sig-item-save" data-field="${field}" data-index="${i}" class="icon-btn" aria-label="Opslaan">💾</button>
                 <button type="button" data-action="sig-item-cancel" class="icon-btn" aria-label="Annuleren">✕</button>
               </li>`
            : `<li class="flex items-start gap-1.5 bg-slate-50 border border-slate-200 rounded-xl p-2">
                 <span class="flex-1 min-w-0 text-xs text-slate-800 leading-snug break-words pt-0.5">${esc(item)}</span>
                 <button type="button" data-action="sig-item-edit" data-field="${field}" data-index="${i}" class="icon-btn" aria-label="Wijzigen">✏️</button>
                 <button type="button" data-action="sig-item-delete" data-field="${field}" data-index="${i}" class="icon-btn hover:bg-rose-50 text-rose-600" aria-label="Verwijderen">🗑️</button>
               </li>`;
        }).join('') : '<li class="text-[11px] italic text-slate-400 px-1">Nog niets toegevoegd.</li>'}
      </ul>
      <div class="flex gap-2 mt-1.5">
        <input type="text" class="input" data-sig-add-input="${field}" maxlength="${meta.max}" placeholder="${esc(meta.placeholder)}" aria-label="Nieuw item">
        <button type="button" data-action="sig-item-add" data-field="${field}" class="btn-small bg-indigo-100 text-indigo-800 shrink-0">+ Toevoegen</button>
      </div>`;
  });
  $('sig-dirty-note').hidden = !sigDirty();
  if (state.sigEditing) {
    const inp = document.querySelector(`[data-sig-edit-input="${state.sigEditing.field}"][data-index="${state.sigEditing.index}"]`);
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }
}

function sigAdd(field) {
  const input = document.querySelector(`[data-sig-add-input="${field}"]`);
  const text = input.value.trim().slice(0, SIG_FIELDS[field].max);
  if (!text) return markInvalid(input);
  const draft = state.sigDrafts[$('sig-edit-color').value];
  if (draft[field].some((x) => x.toLowerCase() === text.toLowerCase())) {
    return toast('Staat er al', 'Deze tekst staat al in de lijst.', 'ℹ️', 'warn');
  }
  draft[field].push(text);
  renderSigEditor();
  const again = document.querySelector(`[data-sig-add-input="${field}"]`);
  if (again) again.focus();
}

function sigSaveItem(field, index) {
  const input = document.querySelector(`[data-sig-edit-input="${field}"][data-index="${index}"]`);
  const text = input.value.trim().slice(0, SIG_FIELDS[field].max);
  if (!text) return markInvalid(input);
  state.sigDrafts[$('sig-edit-color').value][field][index] = text;
  state.sigEditing = null;
  renderSigEditor();
}

async function saveSignalingPlan(e) {
  e.preventDefault();
  if (state.sigEditing) {
    sigSaveItem(state.sigEditing.field, state.sigEditing.index);
  }
  // Ingetypte maar niet toegevoegde regels alsnog meenemen
  document.querySelectorAll('[data-sig-add-input]').forEach((inp) => {
    const text = inp.value.trim();
    if (text) {
      const draft = state.sigDrafts[$('sig-edit-color').value];
      const f = inp.dataset.sigAddInput;
      if (!draft[f].includes(text)) draft[f].push(text.slice(0, SIG_FIELDS[f].max));
    }
  });
  const original = JSON.parse(state.sigOriginal);
  const changed = COLOR_KEYS.filter((c) => JSON.stringify(state.sigDrafts[c]) !== JSON.stringify(original[c]));
  if (!changed.length) {
    closeModal('signaling-editor-modal');
    return toast('Niets gewijzigd', 'Je signaleringsplan was al up-to-date.', 'ℹ️');
  }
  const btn = e.submitter || $('sig-form').querySelector('[type=submit]');
  await withBusy(btn, async () => {
    for (const c of changed) {
      const plan = state.plans[c];
      if (!plan?.id) continue;
      const { error } = await sb.from('signaling_plans').update(state.sigDrafts[c]).eq('id', plan.id);
      if (error) return toastError(error, 'Opslaan lukte niet');
    }
    await reload('plans');
    state.sigOriginal = JSON.stringify(state.sigDrafts);
    state.viewPhase = $('sig-edit-color').value;
    closeModal('signaling-editor-modal');
    renderStatusTab();
    toast('Signaleringsplan Aangepast 📋', `Bijgewerkt: ${changed.map((c) => COLORS[c].label).join(', ')}.`, '📋', 'success');
  });
}

async function requestCloseSigEditor() {
  if (state.sigEditing || sigDirty()) {
    const ok = await confirmDialog({
      title: 'Wijzigingen weggooien?',
      body: 'Je hebt dingen aangepast in je signaleringsplan die nog niet zijn opgeslagen.',
      ok: 'Ja, weggooien',
      cancel: 'Nee, verder bewerken',
    });
    if (!ok) return;
  }
  state.sigEditing = null;
  closeModal('signaling-editor-modal');
}

// =============================================================================
// KEUZE-TAFEL
// =============================================================================
function currentScenario() {
  const p = activeProfile();
  if (state.scenarioKey === 'custom') {
    if (!state.customScenario) return null;
    return buildCustomScenario({ ...state.customScenario, budget: p.weekly_budget, goal: p.savings_goal });
  }
  return VISUAL_SCENARIOS[state.scenarioKey] || VISUAL_SCENARIOS.scooter;
}

function renderKeuzeTab() {
  ['scooter', 'werk_stoppen', 'geld_uitlenen', 'custom'].forEach((k) => {
    const btn = $('scen-btn-' + k);
    const on = k === state.scenarioKey;
    btn.className = on
      ? 'p-2.5 rounded-2xl border-2 border-indigo-600 bg-indigo-50 flex flex-col items-center text-center transition-all scale-105 shadow-sm'
      : 'p-2.5 rounded-2xl border-2 border-slate-200 bg-slate-50 flex flex-col items-center text-center transition-all opacity-75';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  $('custom-scenario-box').hidden = state.scenarioKey !== 'custom';
  renderComparison();
  renderSavedChoices();
}

function stars(n) {
  return `<span aria-label="${n} van 5 sterren">${'⭐'.repeat(n)}<span class="opacity-20">${'⭐'.repeat(5 - n)}</span></span>`;
}

function padCard(pad, letter, tone) {
  const t = tone === 'A'
    ? { card: 'border-rose-200', head: 'bg-rose-50 border-rose-200', headText: 'text-rose-950', val: 'text-rose-700', bar1: 'bg-rose-500', bar2: 'bg-amber-500', step: 'bg-rose-50/50 border-rose-100', time: 'text-rose-600', btn: 'border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-900' }
    : { card: 'border-emerald-400', head: 'bg-emerald-50 border-emerald-200', headText: 'text-emerald-950', val: 'text-emerald-700', bar1: 'bg-emerald-500', bar2: 'bg-emerald-500', step: 'bg-emerald-50/50 border-emerald-100', time: 'text-emerald-700', btn: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow' };
  return `
    <div class="bg-white border-2 ${t.card} rounded-2xl p-3.5 space-y-3 shadow-sm">
      <div class="${t.head} border px-3 py-2 rounded-xl flex justify-between items-center gap-2">
        <span class="text-xs font-black ${t.headText}">${esc(pad.badge)}</span>
        ${letter === 'B' ? '<span class="text-[9px] font-extrabold bg-emerald-600 text-white px-1.5 py-0.5 rounded shrink-0">SLIM</span>' : ''}
      </div>
      <div class="space-y-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 text-[11px]">
        <div class="flex justify-between items-center gap-2">
          <span class="font-bold text-slate-600">😊 Blijdschap nu:</span>
          <span class="font-bold text-slate-800 text-right">${stars(pad.joyStars)}<span class="block text-[10px] text-slate-500 font-semibold">${esc(pad.joyLabel)}</span></span>
        </div>
        <div>
          <div class="flex justify-between font-bold mb-1 gap-2">
            <span class="text-slate-600 shrink-0">💰 Weekgeld over:</span>
            <span class="${t.val} text-right">${esc(pad.budgetText)}</span>
          </div>
          <div class="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pad.budgetPct}" aria-label="Weekgeld over">
            <div class="h-full ${t.bar1} rounded-full transition-all duration-700" style="width:${pad.budgetPct}%"></div>
          </div>
        </div>
        <div>
          <div class="flex justify-between font-bold mb-1 gap-2">
            <span class="text-slate-600 shrink-0">🧠 Rust in hoofd:</span>
            <span class="${t.val} text-right">${esc(pad.calmText)}</span>
          </div>
          <div class="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pad.calmPct}" aria-label="Rust in hoofd">
            <div class="h-full ${t.bar2} rounded-full transition-all duration-700" style="width:${pad.calmPct}%"></div>
          </div>
        </div>
      </div>
      <ol class="space-y-2" aria-label="Tijdlijn">
        ${pad.steps.map((s) => `
          <li class="flex items-start gap-2.5 ${t.step} p-2 rounded-xl border">
            <span class="text-lg bg-white w-8 h-8 rounded-lg flex items-center justify-center shadow-sm shrink-0" aria-hidden="true">${esc(s.icon)}</span>
            <div class="min-w-0">
              <span class="text-[9px] font-black uppercase ${t.time}">${esc(s.time)}</span>
              <p class="text-[11px] font-bold text-slate-800 leading-snug break-words">${esc(s.text)}</p>
            </div>
          </li>`).join('')}
      </ol>
      <button type="button" data-action="choose-path" data-pad="${letter}" class="w-full py-2.5 rounded-xl ${t.btn} text-xs font-extrabold">
        ${letter === 'B' ? '✅ Kies Pad B' : 'Kies Pad A'}
      </button>
    </div>`;
}

function renderComparison() {
  const container = $('scenario-comparison-container');
  const data = currentScenario();
  if (!data) {
    container.innerHTML = `<div class="empty-state bg-white">✏️ Vul hierboven in wat je wilt doen en hoeveel het kost. Tik daarna op <strong>🎨 Teken Gevolgen</strong>. Dan zie je de twee paden naast elkaar.</div>`;
    return;
  }
  const p = activeProfile();
  const budgetNote = state.scenarioKey === 'custom' && (p.weekly_budget === null || Number(p.weekly_budget) <= 0)
    ? `<div class="text-[11px] bg-amber-50 border border-amber-200 text-amber-900 p-2.5 rounded-xl">💡 Vul je weekgeld in bij <strong>👤 Account</strong>. Dan rekent de Keuze-Tafel precies uit wat je overhoudt.</div>`
    : '';
  container.innerHTML = `
    <div class="bg-white px-4 py-3 rounded-2xl border border-slate-200">
      <span class="text-xs font-extrabold text-slate-800 break-words">🔍 ${esc(data.title)}</span>
    </div>
    ${budgetNote}
    <div class="grid grid-cols-1 gap-3">
      ${padCard(data.padA, 'A', 'A')}
      ${padCard(data.padB, 'B', 'B')}
    </div>`;
}

function renderSavedChoices() {
  const list = $('saved-choices-list');
  if (!state.choices.length) {
    list.innerHTML = '<p class="text-xs text-slate-400 italic">Nog geen keuzes vastgelegd op de Keuze-Tafel.</p>';
    return;
  }
  list.innerHTML = state.choices.map((c) => `
    <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 flex justify-between items-center gap-2">
      <div class="min-w-0">
        <span class="text-[10px] font-bold text-slate-400 break-words">${esc(fmtWhen(c.created_at))} • ${esc(c.title)}</span>
        <p class="text-xs font-extrabold text-slate-800 mt-0.5 break-words">${esc(c.chosen_path)}</p>
      </div>
      <button type="button" data-action="delete-choice" data-id="${c.id}" aria-label="Keuze verwijderen" class="text-xs text-slate-400 hover:text-rose-600 p-1 shrink-0">✕</button>
    </div>`).join('');
}

function selectScenario(key) {
  state.scenarioKey = key;
  local.set(`scenario:${state.activeProfileId}`, key);
  renderKeuzeTab();
  if (key === 'custom' && !state.customScenario && window.matchMedia('(pointer: fine)').matches) $('custom-dilemma-title').focus();
}

function drawCustomScenario(e) {
  e.preventDefault();
  const title = $('custom-dilemma-title').value.trim();
  const costRaw = $('custom-dilemma-cost').value.trim().replace(',', '.');
  if (!title) {
    markInvalid($('custom-dilemma-title'));
    return toast('Wat wil je doen?', 'Schrijf eerst op wat je wilt doen of kopen.', '⚠️', 'warn');
  }
  const cost = costRaw === '' ? NaN : Number(costRaw);
  if (!Number.isFinite(cost) || cost < 0) {
    markInvalid($('custom-dilemma-cost'));
    return toast('Kosten ontbreken', 'Vul in hoeveel euro het ongeveer kost (0 mag ook).', '⚠️', 'warn');
  }
  state.customScenario = { title, cost };
  renderComparison();
  $('scenario-comparison-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function choosePath(pad, button) {
  const data = currentScenario();
  if (!data) return;
  const chosen = pad === 'A' ? data.padA.badge : data.padB.badge;
  await withBusy(button, async () => {
    const { error } = await sb.from('saved_choices').insert({
      profile_id: state.activeProfileId,
      title: data.title.slice(0, 300),
      chosen_path: chosen.slice(0, 300),
      scenario_key: state.scenarioKey in VISUAL_SCENARIOS || state.scenarioKey === 'custom' ? state.scenarioKey : null,
      pad: pad === 'A' ? 'A' : 'B',
    });
    if (error) return toastError(error, 'Keuze bewaren lukte niet');
    const viewers = state.members.filter((m) => m.can_see_finance).map((m) => firstName(m.name));
    await logNotification({
      kind: 'choice',
      recipient: viewers.length ? viewers.join(', ') : 'Mijn overzicht',
      message: `Op de Keuze-Tafel gekozen voor ${chosen} bij "${data.title}".`,
    });
    await reload('choices');
    renderSavedChoices();
    updateBadges();
    toast('Keuze Bewaard! ⚖️', `Je keuze (${chosen}) staat nu bij je gemaakte afspraken.`, '⚖️', 'success');
    $('saved-choices-list').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

async function deleteChoice(id) {
  const c = state.choices.find((x) => x.id === id);
  if (!c) return;
  const ok = await confirmDialog({ title: 'Keuze verwijderen?', body: `"${c.chosen_path}" bij "${c.title}" wordt weggehaald.` });
  if (!ok) return;
  const { error } = await sb.from('saved_choices').delete().eq('id', id);
  if (error) return toastError(error, 'Verwijderen lukte niet');
  state.choices = state.choices.filter((x) => x.id !== id);
  renderSavedChoices();
}

// =============================================================================
// OPDRACHTEN
// =============================================================================
function renderTaskTargetSelect(selected = null) {
  const select = $('task-input-target');
  const taskMembers = state.members.filter((m) => m.can_see_tasks);
  let extra = '';
  if (selected && selected !== 'OPEN' && !taskMembers.some((m) => m.id === selected)) {
    const m = state.members.find((x) => x.id === selected);
    if (m) extra = `<option value="${m.id}">👤 ${esc(m.name)} (mag opdrachten nu niet zien)</option>`;
  }
  select.innerHTML = `
    <option value="OPEN">📣 Opengooien voor hele groep (${taskMembers.length} ${taskMembers.length === 1 ? 'lid krijgt' : 'leden krijgen'} melding)</option>
    ${taskMembers.map((m) => `<option value="${m.id}">👤 Specifiek vragen aan: ${esc(m.name)} (${esc(m.role)})</option>`).join('')}
    ${extra}`;
  select.value = selected || 'OPEN';
  if (!select.value) select.value = 'OPEN';
}

function renderTasksTab() {
  if (!state.editingTaskId) renderTaskTargetSelect($('task-input-target').value || 'OPEN');
  const list = $('client-tasks-list');
  if (!state.tasks.length) {
    list.innerHTML = '<div class="empty-state">Je hebt nog geen opdrachten geplaatst. Vul hierboven het formulier in om een kleine of grote hulpvraag uit te zetten!</div>';
    return;
  }
  list.innerHTML = state.tasks.map((t) => {
    let statusBadge = '';
    let extraBlock = '';
    if (t.status === 'open') {
      statusBadge = '<span class="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-md shrink-0">⏳ Openstaand</span>';
    } else if (t.status === 'accepted') {
      statusBadge = `<span class="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md text-right">✅ Geaccepteerd door ${esc(t.accepted_by)}</span>`;
    } else if (t.status === 'counter') {
      statusBadge = '<span class="text-[10px] font-bold bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-md shrink-0">🔄 Nieuw voorstel!</span>';
      extraBlock = `
        <div class="mt-2.5 p-3 rounded-xl bg-amber-50 border border-amber-300 space-y-2">
          <div class="text-[11px] font-extrabold text-amber-950">💬 Voorstel van ${esc(t.counter_by)}:</div>
          <p class="text-xs text-amber-900 italic break-words">"${esc(t.counter_note)}"</p>
          <div class="text-[11px] font-bold text-slate-800">Nieuwe dag/tijd: <span class="text-indigo-700 underline">${esc(t.counter_proposal_time)}</span></div>
          <div class="flex gap-2">
            <button type="button" data-action="approve-counter" data-id="${t.id}" class="flex-[2] bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-2 rounded-lg shadow">👍 Akkoord met ${esc(t.counter_proposal_time)}</button>
            <button type="button" data-action="reject-counter" data-id="${t.id}" class="flex-1 bg-white border border-amber-300 text-amber-900 text-xs font-bold py-2 rounded-lg">✋ Past niet</button>
          </div>
        </div>`;
    }
    const orphan = t.target_type === 'specific' && !t.target_member_id;
    return `
      <div class="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5">
        <div class="flex justify-between items-start gap-2">
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-[10px] font-extrabold bg-slate-200 text-slate-700 px-2 py-0.5 rounded">${esc(DURATIONS[t.duration] || t.duration)}</span>
            <span class="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">📅 ${esc(t.requested_time)}</span>
          </div>
          ${statusBadge}
        </div>
        <h4 class="text-xs font-extrabold text-slate-900 pt-0.5 break-words">${esc(t.title)}</h4>
        ${t.description ? `<p class="text-[11px] text-slate-600 break-words whitespace-pre-line">${esc(t.description)}</p>` : ''}
        ${orphan ? '<p class="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 p-2 rounded-lg">⚠️ Deze persoon staat niet meer in je cirkel. Tik op ✏️ Wijzigen en kies iemand anders.</p>' : ''}
        <div class="flex justify-between items-center pt-2 border-t border-slate-200/70 text-[11px] gap-2">
          <span class="text-slate-500 font-semibold min-w-0 truncate">Aan: <strong>${esc(t.target_type === 'open' ? 'Open voor hele groep' : t.target_name)}</strong></span>
          <div class="flex items-center gap-2 shrink-0">
            <button type="button" data-action="edit-task" data-id="${t.id}" class="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-slate-700 font-bold hover:bg-indigo-50">✏️ Wijzigen</button>
            <button type="button" data-action="delete-task" data-id="${t.id}" aria-label="Opdracht verwijderen" class="px-2.5 py-1 rounded-lg bg-white border border-rose-200 text-rose-600 font-bold hover:bg-rose-50">🗑️</button>
          </div>
        </div>
        ${extraBlock}
      </div>`;
  }).join('');
}

function startEditTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  state.editingTaskId = id;
  $('task-input-title').value = t.title;
  $('task-input-desc').value = t.description;
  $('task-input-duration').value = t.duration;
  $('task-input-datetime').value = t.requested_time;
  renderTaskTargetSelect(t.target_type === 'open' ? 'OPEN' : (t.target_member_id || 'OPEN'));
  $('task-form-heading').textContent = '✏️ Bestaande Opdracht Wijzigen';
  $('btn-submit-task').textContent = '💾 Wijzigingen Opslaan';
  $('btn-cancel-task-edit').hidden = false;
  $('client-main').scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelTaskEdit() {
  state.editingTaskId = null;
  $('task-input-title').value = '';
  $('task-input-desc').value = '';
  $('task-input-duration').value = 'hour';
  $('task-input-datetime').value = '';
  $('task-form-heading').textContent = '🤝 Hulpvraag of Opdracht Plaatsen';
  $('btn-submit-task').textContent = '📤 Opdracht Plaatsen & Melding Sturen';
  $('btn-cancel-task-edit').hidden = true;
  renderTaskTargetSelect('OPEN');
}

async function saveTask(e) {
  e.preventDefault();
  const title = $('task-input-title').value.trim();
  const description = $('task-input-desc').value.trim();
  const duration = $('task-input-duration').value;
  const when = $('task-input-datetime').value.trim();
  const target = $('task-input-target').value;
  if (!title) {
    markInvalid($('task-input-title'));
    return toast('Nog niet compleet', 'Vul in wat de opdracht is.', '⚠️', 'warn');
  }
  if (!when) {
    markInvalid($('task-input-datetime'));
    return toast('Nog niet compleet', 'Vul in op welke dag en tijd je dit wilt doen.', '⚠️', 'warn');
  }
  const isOpen = target === 'OPEN';
  const member = isOpen ? null : state.members.find((m) => m.id === target);
  if (!isOpen && !member) return toast('Kies een persoon', 'Deze persoon staat niet meer in je cirkel.', '⚠️', 'warn');
  const row = {
    title,
    description,
    duration,
    requested_time: when,
    target_type: isOpen ? 'open' : 'specific',
    target_name: isOpen ? 'Open voor hele groep' : member.name,
    target_member_id: isOpen ? null : member.id,
  };
  const targetLabel = isOpen ? 'Hele groep' : member.name;
  const btn = e.submitter || $('btn-submit-task');

  await withBusy(btn, async () => {
    if (state.editingTaskId) {
      const old = state.tasks.find((t) => t.id === state.editingTaskId);
      let reset = false;
      if (old && old.status !== 'open' && (old.requested_time !== when || old.target_type !== row.target_type || old.target_member_id !== row.target_member_id)) {
        Object.assign(row, { status: 'open', accepted_by: '', accepted_by_member_id: null, counter_by: '', counter_by_member_id: null, counter_proposal_time: '', counter_note: '' });
        reset = true;
      }
      const { error } = await sb.from('tasks').update(row).eq('id', state.editingTaskId);
      if (error) return toastError(error, 'Opslaan lukte niet');
      await logNotification({ kind: 'task', recipient: targetLabel, message: `Opdracht gewijzigd: "${title}" (${when}).`, member_id: row.target_member_id });
      cancelTaskEdit();
      await reload('tasks');
      renderTasksTab();
      updateBadges();
      toast('Opdracht Gewijzigd ✏️', reset ? `"${title}" is aangepast. Omdat de dag/tijd of persoon is veranderd, moet iemand opnieuw bevestigen.` : `De aanpassingen aan "${title}" zijn opgeslagen.`, '✏️', 'success');
    } else {
      const { error } = await sb.from('tasks').insert({ profile_id: state.activeProfileId, ...row });
      if (error) return toastError(error, 'Opdracht plaatsen lukte niet');
      await logNotification({ kind: 'task', recipient: targetLabel, message: `Nieuwe opdracht (${DURATION_SHORT[duration]}): "${title}" op ${when}.`, member_id: row.target_member_id });
      cancelTaskEdit();
      await reload('tasks');
      renderTasksTab();
      updateBadges();
      const reach = state.members.filter((m) => m.can_see_tasks).length;
      if (isOpen && reach === 0) {
        toast('Opdracht Geplaatst 📤', 'Let op: er is nog niemand in je cirkel die opdrachten mag zien. Voeg iemand toe bij 🛡️ Mijn Cirkel.', '📤', 'warn');
      } else {
        toast('Opdracht Geplaatst 📤', isOpen ? `${reach} ${reach === 1 ? 'persoon ziet' : 'personen zien'} je vraag nu in hun Netwerk Weergave.` : `${member.name} ziet je vraag nu in de Netwerk Weergave.`, '📤', 'success');
      }
    }
  });
}

async function approveCounter(id, button) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t || t.status !== 'counter') return;
  await withBusy(button, async () => {
    const { error } = await sb.from('tasks').update({
      requested_time: t.counter_proposal_time,
      status: 'accepted',
      accepted_by: t.counter_by,
      accepted_by_member_id: t.counter_by_member_id,
      counter_by: '',
      counter_by_member_id: null,
      counter_proposal_time: '',
      counter_note: '',
    }).eq('id', id);
    if (error) return toastError(error, 'Goedkeuren lukte niet');
    await logNotification({
      kind: 'task',
      recipient: t.counter_by,
      message: `${firstName(activeProfile().full_name)} gaat akkoord met ${t.counter_proposal_time} voor "${t.title}". De afspraak staat vast!`,
      member_id: t.counter_by_member_id,
    });
    await reload('tasks');
    renderTasksTab();
    updateBadges();
    toast('Nieuwe Datum Bevestigd! ✅', `Afspraak met ${t.counter_by} staat nu vast op ${t.counter_proposal_time}.`, '✅', 'success');
  });
}

async function rejectCounter(id, button) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t || t.status !== 'counter') return;
  await withBusy(button, async () => {
    const { error } = await sb.from('tasks').update({
      status: 'open', counter_by: '', counter_by_member_id: null, counter_proposal_time: '', counter_note: '',
    }).eq('id', id);
    if (error) return toastError(error, 'Dat lukte niet');
    await logNotification({
      kind: 'task',
      recipient: t.counter_by,
      message: `${firstName(activeProfile().full_name)} kan niet op ${t.counter_proposal_time} voor "${t.title}". De vraag staat weer open op ${t.requested_time}.`,
      member_id: t.counter_by_member_id,
    });
    await reload('tasks');
    renderTasksTab();
    updateBadges();
    toast('Voorstel afgewezen', `"${t.title}" staat weer open op ${t.requested_time}.`, '✋');
  });
}

async function deleteTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const ok = await confirmDialog({ title: 'Opdracht verwijderen?', body: `"${t.title}" wordt weggehaald. Je netwerk ziet hem dan ook niet meer.` });
  if (!ok) return;
  const { error } = await sb.from('tasks').delete().eq('id', id);
  if (error) return toastError(error, 'Verwijderen lukte niet');
  if (state.editingTaskId === id) cancelTaskEdit();
  state.tasks = state.tasks.filter((x) => x.id !== id);
  renderTasksTab();
  updateBadges();
  toast('Opdracht verwijderd', t.title, '🗑️');
}

// =============================================================================
// MIJN CIRKEL
// =============================================================================
function fillRoleSelect(selected = ROLES[0]) {
  const select = $('invite-role');
  const roles = ROLES.includes(selected) ? ROLES : [...ROLES, selected];
  select.innerHTML = roles.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
  select.value = selected;
}

function openInviteForm(memberId = null) {
  state.editingMemberId = memberId;
  const m = memberId ? state.members.find((x) => x.id === memberId) : null;
  $('invite-form-heading').textContent = m ? `✏️ ${m.name} wijzigen` : '✉️ Nieuw Netwerklid Uitnodigen';
  $('btn-submit-invite').textContent = m ? '💾 Opslaan' : 'Uitnodigen & Koppelen';
  $('invite-name').value = m?.name || '';
  $('invite-email').value = m?.email || '';
  fillRoleSelect(m?.role || ROLES[0]);
  $('invite-person-box').hidden = false;
  $('invite-person-box').scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (window.matchMedia('(pointer: fine)').matches) $('invite-name').focus();
}

function closeInviteForm() {
  state.editingMemberId = null;
  $('invite-person-box').hidden = true;
  $('invite-name').value = '';
  $('invite-email').value = '';
}

async function saveMember(e) {
  e.preventDefault();
  const name = $('invite-name').value.trim();
  const role = $('invite-role').value;
  const email = $('invite-email').value.trim().toLowerCase();
  if (!name) {
    markInvalid($('invite-name'));
    return toast('Naam ontbreekt', 'Vul de naam van de persoon in.', '⚠️', 'warn');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    markInvalid($('invite-email'));
    return toast('E-mailadres klopt niet', 'Vul een geldig e-mailadres in, bijvoorbeeld naam@voorbeeld.nl.', '⚠️', 'warn');
  }
  const btn = e.submitter || $('btn-submit-invite');
  await withBusy(btn, async () => {
    if (state.editingMemberId) {
      const old = state.members.find((m) => m.id === state.editingMemberId);
      const { data, error } = await sb.from('network_members').update({ name, role, email }).eq('id', state.editingMemberId).select().single();
      if (error) return toastError(error, 'Opslaan lukte niet');
      closeInviteForm();
      await reload('members', 'tasks');
      renderCircleTab();
      renderTasksTab();
      if (old && old.email !== data.email) {
        toast('E-mailadres gewijzigd ✉️', `Er is een nieuwe uitnodigingscode gemaakt voor ${data.name}. Stuur de nieuwe uitnodiging.`, '✉️', 'warn');
        openInviteShare(data.id);
      } else {
        toast('Opgeslagen', `${data.name} is bijgewerkt.`, '✅', 'success');
      }
      return;
    }
    const can_see_finance = role === 'Bewindvoerder' || role === 'Ambulant Begeleider';
    const { data, error } = await sb.from('network_members')
      .insert({ profile_id: state.activeProfileId, name, role, email, can_see_mood: true, can_see_tasks: true, can_see_finance })
      .select().single();
    if (error) return toastError(error, 'Toevoegen lukte niet');
    await logNotification({ kind: 'circle', recipient: email, message: `Uitnodiging klaargezet voor ${name} (${email}).` });
    closeInviteForm();
    await reload('members');
    renderCircleTab();
    renderTasksTab();
    toast('Persoon Toegevoegd ✉️', `Stuur ${firstName(name)} nu de uitnodiging.`, '✉️', 'success');
    openInviteShare(data.id);
  });
}

function inviteLink(code) {
  return `${location.origin}${location.pathname}?uitnodiging=${encodeURIComponent(code)}`;
}

function inviteMessage(member) {
  const p = activeProfile();
  const code = formatCode(member.invite_code);
  return `Hoi ${firstName(member.name)},

Ik gebruik de app EigenKoers om bij te houden hoe het met me gaat. Ik wil graag dat jij meekijkt in mijn netwerk.

1. Open deze link: ${inviteLink(member.invite_code)}
2. Maak een account met dit e-mailadres: ${member.email}
3. Je wordt dan automatisch gekoppeld.

Lukt de link niet? Ga naar ${location.origin}${location.pathname}, log in en vul deze code in: ${code}

Groetjes,
${firstName(p.full_name)}`;
}

function openInviteShare(memberId) {
  const m = state.members.find((x) => x.id === memberId);
  if (!m) return;
  const p = activeProfile();
  const subject = `${firstName(p.full_name)} nodigt je uit voor EigenKoers`;
  const body = inviteMessage(m);
  const mailto = `mailto:${encodeURIComponent(m.email).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(body)}`;
  const canShare = typeof navigator.share === 'function';
  $('invite-share-body').innerHTML = `
    <p class="leading-relaxed text-slate-700">Stuur deze uitnodiging naar <strong>${esc(m.name)}</strong> (${esc(m.email)}). ${esc(firstName(m.name))} moet inloggen met <strong>dit e-mailadres</strong>.</p>
    ${m.user_id ? `<p class="text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 p-2.5 rounded-xl">✅ ${esc(firstName(m.name))} is al gekoppeld sinds ${esc(fmtWhen(m.joined_at))}.</p>` : ''}
    <div class="bg-slate-900 text-white rounded-2xl p-4 text-center">
      <div class="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Persoonlijke uitnodigingscode</div>
      <div class="text-2xl font-black tracking-[0.25em] mt-1 select-all">${esc(formatCode(m.invite_code))}</div>
    </div>
    <div>
      <div class="label mb-1">Uitnodigingslink</div>
      <div class="bg-slate-50 border border-slate-200 p-2.5 rounded-xl break-all text-[11px] text-slate-700 select-all">${esc(inviteLink(m.invite_code))}</div>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <a href="${esc(mailto)}" class="btn-primary text-center">✉️ Mail versturen</a>
      <a href="${esc(whatsapp)}" target="_blank" rel="noopener noreferrer" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-3 px-4 rounded-xl shadow text-center">💬 Via WhatsApp</a>
      <button type="button" data-action="copy-invite" data-id="${m.id}" class="btn-soft border border-slate-300">📋 Kopieer bericht</button>
      ${canShare ? `<button type="button" data-action="share-invite" data-id="${m.id}" class="btn-soft border border-slate-300">📤 Delen…</button>` : `<button type="button" data-action="copy-code" data-id="${m.id}" class="btn-soft border border-slate-300">🔢 Kopieer code</button>`}
    </div>
    <div class="bg-indigo-50 border border-indigo-200 p-3 rounded-xl text-[11px] text-indigo-950 leading-relaxed">
      <strong>Zo werkt het voor ${esc(firstName(m.name))}:</strong><br>
      1. De link openen (of de app openen en de code invullen).<br>
      2. Een account maken met ${esc(m.email)}.<br>
      3. Klaar: ${esc(firstName(m.name))} ziet alleen wat jij met de vinkjes hebt aangezet.
    </div>`;
  openModal('invite-share-modal');
}

function renderCircleTab() {
  const container = $('circle-members-list');
  if (!state.members.length) {
    container.innerHTML = '<div class="empty-state">Er zijn nog geen mensen gekoppeld aan dit profiel. Tik rechtsboven op <strong>+ Persoon</strong> om iemand met zijn of haar e-mailadres toe te voegen!</div>';
    return;
  }
  const p = activeProfile();
  container.innerHTML = state.members.map((m) => `
    <div class="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
      <div class="flex justify-between items-start gap-2">
        <div class="min-w-0">
          <h4 class="text-xs font-extrabold text-slate-900 break-words">${esc(m.name)} <span class="text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded ml-1 whitespace-nowrap">${esc(m.role)}</span></h4>
          <p class="text-[11px] text-slate-500 break-all">✉️ ${esc(m.email)}</p>
          ${m.user_id
            ? `<p class="text-[10px] font-bold text-emerald-700 mt-0.5">✅ Gekoppeld${m.joined_at ? ' sinds ' + esc(fmtWhen(m.joined_at)) : ''}</p>`
            : `<p class="text-[10px] font-bold text-amber-700 mt-0.5">⏳ Nog niet gekoppeld • code ${esc(formatCode(m.invite_code))}</p>`}
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button type="button" data-action="edit-member" data-id="${m.id}" class="icon-btn" aria-label="${esc(m.name)} wijzigen" title="Wijzigen">✏️</button>
          <button type="button" data-action="remove-member" data-id="${m.id}" class="icon-btn hover:bg-rose-50 text-rose-600" aria-label="${esc(m.name)} verwijderen" title="Verwijderen">🗑️</button>
        </div>
      </div>
      <div class="flex gap-2">
        <button type="button" data-action="share-member" data-id="${m.id}" class="flex-1 btn-small bg-white border border-indigo-200 text-indigo-800 py-1.5">✉️ ${m.user_id ? 'Uitnodiging bekijken' : 'Uitnodiging sturen'}</button>
        <button type="button" data-action="preview-member" data-id="${m.id}" class="flex-1 btn-small bg-white border border-slate-300 text-slate-700 py-1.5">👁️ Bekijk als ${esc(firstName(m.name))}</button>
      </div>
      <div class="pt-2 border-t border-slate-200/80 space-y-1.5 text-xs">
        ${[
          ['can_see_mood', '🚦 Mag mijn Stoplicht & Signaleringsplan zien', 'perm-mood'],
          ['can_see_tasks', '🤝 Krijgt melding bij Opdrachten & kan reageren', 'perm-tasks'],
          ['can_see_finance', '⚖️ Mag gemaakte Keuze-Tafel afspraken zien', 'perm-finance'],
        ].map(([field, label, help]) => `
          <div>
            <div class="flex justify-between items-center gap-2 text-slate-700" data-help-anchor>
              <label for="perm-${field}-${m.id}" class="flex-1 cursor-pointer">${label}</label>
              ${helpBtn(help)}
              <input id="perm-${field}-${m.id}" type="checkbox" ${m[field] ? 'checked' : ''} data-change="toggle-perm" data-id="${m.id}" data-field="${field}" class="w-4 h-4 accent-indigo-600 rounded cursor-pointer shrink-0">
            </div>
          </div>`).join('')}
      </div>
    </div>`).join('');
  if (p.is_demo) {
    container.insertAdjacentHTML('afterbegin', '<p class="text-[11px] bg-amber-50 border border-amber-200 text-amber-900 p-2.5 rounded-xl">🧪 Dit is het demo-profiel. Deze mensen bestaan niet echt. Tik op <strong>👁️ Bekijk als</strong> om te zien wat zij zien, en probeer daar zelf te reageren op een opdracht.</p>');
  }
}

async function togglePermission(el) {
  const m = state.members.find((x) => x.id === el.dataset.id);
  const field = el.dataset.field;
  if (!m || !['can_see_mood', 'can_see_tasks', 'can_see_finance'].includes(field)) return;
  const value = el.checked;
  el.disabled = true;
  const { error } = await sb.from('network_members').update({ [field]: value }).eq('id', m.id);
  el.disabled = false;
  if (error) {
    el.checked = !value;
    return toastError(error, 'Kijkrechten aanpassen lukte niet');
  }
  m[field] = value;
  renderTasksTab();
  const what = { can_see_mood: 'je stoplicht', can_see_tasks: 'je opdrachten', can_see_finance: 'je keuzes' }[field];
  toast('Kijkrechten aangepast 🛡️', `${firstName(m.name)} ${value ? 'mag nu' : 'mag niet meer'} ${what} zien.`, '🛡️', 'success');
}

async function removeMember(id) {
  const m = state.members.find((x) => x.id === id);
  if (!m) return;
  const ok = await confirmDialog({
    title: `${m.name} verwijderen?`,
    body: `${firstName(m.name)} kan daarna niets meer zien van dit profiel. Opdrachten die alleen aan ${firstName(m.name)} gevraagd waren, moet je opnieuw aan iemand toewijzen.`,
  });
  if (!ok) return;
  const { error } = await sb.from('network_members').delete().eq('id', id);
  if (error) return toastError(error, 'Verwijderen lukte niet');
  await reload('members', 'tasks');
  renderCircleTab();
  renderTasksTab();
  toast('Persoon verwijderd', `${m.name} staat niet meer in je cirkel.`, '🗑️');
}

// =============================================================================
// MELDINGEN (CLIËNT)
// =============================================================================
function openNotifications() {
  const p = activeProfile();
  if (!p) return;
  const lastSeen = local.get(`seen:${p.id}`) || 0;
  const list = $('notifications-list');
  list.innerHTML = state.notifications.length
    ? state.notifications.map((n) => {
        const isNew = n.from_network && new Date(n.created_at).getTime() > lastSeen;
        return `
          <div class="p-2.5 rounded-xl border text-xs ${n.from_network ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-200'}">
            <div class="flex justify-between gap-2 text-[10px] font-bold text-slate-400">
              <span class="truncate">${n.from_network ? '📥 Reactie van je netwerk' : `📤 Aan: ${esc(n.recipient)}`}</span>
              <span class="shrink-0">${isNew ? '<span class="text-rose-600">● nieuw</span> ' : ''}${esc(fmtWhen(n.created_at))}</span>
            </div>
            <p class="text-slate-700 font-medium mt-0.5 break-words">${esc(n.message)}</p>
          </div>`;
      }).join('')
    : '<div class="empty-state">Nog geen meldingen.</div>';
  local.set(`seen:${p.id}`, Date.now());
  updateBadges();
  openModal('notifications-modal');
}

// =============================================================================
// ACCOUNT-MODAL
// =============================================================================
function openAccountModal() {
  $('account-email').textContent = state.user?.email || '-';
  const list = $('accounts-switcher-list');
  list.innerHTML = state.profiles.length
    ? state.profiles.map((a) => `
        <div class="p-3 rounded-xl border ${a.id === state.activeProfileId ? 'border-indigo-600 bg-indigo-50/60' : 'border-slate-200 bg-slate-50'} flex justify-between items-center gap-2">
          <div class="min-w-0">
            <div class="text-xs font-extrabold text-slate-900 truncate">${esc(a.full_name)} ${a.is_demo ? '<span class="text-[9px] font-extrabold uppercase bg-slate-900 text-white px-1.5 py-0.5 rounded">Demo</span>' : ''}</div>
            <div class="text-[10px] text-slate-500 truncate">Begeleider: ${esc(a.supervisor_name || '–')} • Weekgeld: ${esc(euro(a.weekly_budget))}</div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            ${a.id === state.activeProfileId
              ? '<span class="text-[10px] font-extrabold bg-indigo-600 text-white px-2.5 py-1 rounded-lg">Actief</span>'
              : `<button type="button" data-action="switch-profile" data-id="${a.id}" class="text-xs font-bold bg-white border border-slate-300 px-2.5 py-1 rounded-lg hover:bg-indigo-50">Open</button>`}
            <button type="button" data-action="delete-profile" data-id="${a.id}" class="icon-btn hover:bg-rose-50 text-rose-600" aria-label="Profiel ${esc(a.full_name)} verwijderen" title="Verwijderen">🗑️</button>
          </div>
        </div>`).join('')
    : '<div class="empty-state">Je hebt nog geen cliënt-profiel. Maak er hieronder een aan.</div>';
  const p = activeProfile();
  $('form-edit-profile').hidden = !p;
  if (p) fillProfileFields('edit', p);
  fillProfileFields('new', null);
  openModal('account-modal');
}

async function switchProfile(id) {
  closeModal('account-modal');
  state.clientTab = 'status';
  await setActiveProfile(id);
  if (state.mode !== 'client') await switchMode('client');
  toast('Profiel Gewisseld 👤', `Je werkt nu in het profiel van ${activeProfile().full_name}.`, '👤');
}

async function saveEditedProfile(e) {
  e.preventDefault();
  const values = readProfileFields('edit');
  if (!values) return;
  const btn = e.submitter || $('form-edit-profile').querySelector('[type=submit]');
  await withBusy(btn, async () => {
    const { data, error } = await sb.from('profiles').update(values).eq('id', state.activeProfileId).select().single();
    if (error) return toastError(error, 'Opslaan lukte niet');
    const i = state.profiles.findIndex((p) => p.id === data.id);
    state.profiles[i] = data;
    closeModal('account-modal');
    renderClient();
    toast('Gegevens opgeslagen 💾', `${data.full_name} is bijgewerkt.`, '💾', 'success');
  });
}

async function createNewBlankProfile(e) {
  e.preventDefault();
  const values = readProfileFields('new');
  if (!values) return;
  const btn = e.submitter || $('form-new-profile').querySelector('[type=submit]');
  const created = await createProfile(values, btn);
  if (!created) return;
  closeModal('account-modal');
  state.clientTab = 'status';
  await setActiveProfile(created.id);
  if (state.mode !== 'client') await switchMode('client');
  toast('Blanco Account Klaar! ✨', `Welkom ${firstName(created.full_name)}! Alles is leeg en klaar om samen in te vullen.`, '✨', 'success');
}

async function onboardingCreate(e) {
  e.preventDefault();
  const values = readProfileFields('onb');
  if (!values) return;
  const btn = e.submitter || $('form-onboarding-profile').querySelector('[type=submit]');
  const created = await createProfile(values, btn);
  if (!created) return;
  local.set(userKey('activeProfile'), created.id);
  local.set(userKey('mode'), 'client');
  state.clientTab = 'status';
  await enterApp();
  toast('Je profiel staat klaar ✨', 'Begin met je stoplicht of vul samen je signaleringsplan in.', '✨', 'success');
}

async function loadDemo(button) {
  await withBusy(button, async () => {
    const { data: id, error } = await sb.rpc('create_demo_profile');
    if (error) return toastError(error, 'Demo laden lukte niet');
    await loadProfiles();
    closeModal('account-modal');
    local.set(userKey('activeProfile'), id);
    state.clientTab = 'status';
    if ($('screen-app').hidden) {
      local.set(userKey('mode'), 'client');
      await enterApp();
    } else {
      await setActiveProfile(id);
      if (state.mode !== 'client') await switchMode('client');
    }
    toast('Demo-profiel geladen 🧪', 'Je kijkt nu naar Daan Vermeulen (voorbeeld). Wissel terug via 👤 Account.', '🧪', 'success');
  });
}

async function deleteProfile(id) {
  const p = state.profiles.find((x) => x.id === id);
  if (!p) return;
  const ok = await confirmDialog({
    title: `Profiel "${p.full_name}" verwijderen?`,
    body: 'Alles in dit profiel wordt definitief verwijderd: stoplicht, signaleringsplan, leerdoelen, netwerk, opdrachten en keuzes. Dit kun je niet ongedaan maken.',
    ok: 'Ja, definitief verwijderen',
  });
  if (!ok) return;
  const { error } = await sb.from('profiles').delete().eq('id', id);
  if (error) return toastError(error, 'Verwijderen lukte niet');
  state.profiles = state.profiles.filter((x) => x.id !== id);
  local.remove(`seen:${id}`);
  local.remove(`scenario:${id}`);
  toast('Profiel verwijderd', p.full_name, '🗑️');
  if (state.activeProfileId === id) {
    stopRealtime();
    state.loadedProfileId = null;
    state.activeProfileId = state.profiles[0]?.id || null;
    local.set(userKey('activeProfile'), state.activeProfileId);
  }
  if (!state.profiles.length && !state.networks.length) {
    closeModal('account-modal');
    return showOnboarding();
  }
  if (state.mode === 'client') await openClientDashboard();
  openAccountModal();
}

// =============================================================================
// DASHBOARD 2: NETWERK WEERGAVE
// =============================================================================
async function openNetworkDashboard() {
  await ensureProfileDataLoaded();
  try {
    await loadNetworks();
  } catch (err) {
    toastError(err, 'Netwerken laden lukte niet');
  }
  populateNetworkSelect();
  await loadNetworkView();
  startPolling();
}

function networkOptions() {
  const opts = [];
  state.networks.forEach((n) => opts.push(n.member_id));
  if (activeProfile()) state.members.forEach((m) => opts.push(m.id));
  return opts;
}

function populateNetworkSelect() {
  const select = $('active-network-member-select');
  const p = activeProfile();
  const groups = [];
  if (state.networks.length) {
    groups.push(`<optgroup label="Ik ben netwerklid van">${state.networks.map((n) => `<option value="${n.member_id}">${esc(n.client_name)} — als ${esc(firstName(n.member_name))}</option>`).join('')}</optgroup>`);
  }
  if (p && state.members.length) {
    groups.push(`<optgroup label="Voorbeeld: zo ziet mijn netwerk ${esc(firstName(p.full_name))}">${state.members.map((m) => `<option value="${m.id}">👁️ ${esc(m.name)} (${esc(m.role)})</option>`).join('')}</optgroup>`);
  }
  const options = networkOptions();
  if (!options.length) {
    select.innerHTML = '<option value="">Nog geen netwerk gekoppeld</option>';
    select.disabled = true;
    state.networkMemberId = null;
    return;
  }
  select.disabled = false;
  select.innerHTML = groups.join('');
  if (!options.includes(state.networkMemberId)) state.networkMemberId = options[0];
  select.value = state.networkMemberId;
  local.set(userKey('networkMember'), state.networkMemberId);
}

async function loadNetworkView({ silent = false } = {}) {
  if (!state.networkMemberId) {
    state.networkView = null;
    return renderNetwork();
  }
  const memberId = state.networkMemberId;
  const { data, error } = await sb.rpc('get_network_view', { p_member_id: memberId });
  if (memberId !== state.networkMemberId) return;
  if (error) {
    if (!silent) toastError(error, 'Netwerk laden lukte niet');
    state.networkView = null;
    // Mogelijk ontkoppeld of verwijderd: lijst verversen
    if (!silent) {
      try { await loadNetworks(); } catch (_) { /* negeren */ }
      populateNetworkSelect();
      if (state.networkMemberId && state.networkMemberId !== memberId) return loadNetworkView();
    }
    return renderNetwork();
  }
  state.networkView = data;
  renderNetwork();
}

function lockedCard(title) {
  return `<div class="bg-white p-4 rounded-2xl border border-slate-200 text-xs text-slate-500">🔒 <strong>${title} afgeschermd:</strong> niet gedeeld met jou.</div>`;
}

function renderNetwork() {
  const v = state.networkView;
  const sections = ['net-section-mood', 'net-section-tasks', 'net-section-finance'];
  if (!v) {
    $('net-viewer-name').textContent = 'Nog geen netwerk';
    $('net-viewer-role').textContent = 'Netwerk Portaal';
    $('net-viewer-email').textContent = state.user?.email ? `Ingelogd met: ${state.user.email}` : '';
    $('net-client-name').textContent = '-';
    $('net-preview-banner').hidden = true;
    $('net-permissions-banner').innerHTML = `<span class="text-slate-600 leading-relaxed">${state.networkMemberId
      ? 'Dit netwerk kon niet geladen worden. Tik op ↻ Vernieuwen.'
      : 'Je kijkt nog bij niemand mee. Heb je een uitnodiging gekregen? Vul hieronder de code in. Wil je zien hoe je eigen netwerk jou ziet? Voeg dan eerst iemand toe in <strong>1. Mijn Dashboard → 🛡️ Mijn Cirkel</strong>.'}</span>`;
    sections.forEach((id) => { $(id).innerHTML = ''; });
    $('net-log-card').hidden = true;
    return;
  }
  $('net-log-card').hidden = false;
  const viewer = v.viewer;
  const clientFirst = firstName(v.client.full_name);
  $('net-viewer-name').textContent = viewer.name;
  $('net-viewer-role').textContent = viewer.role || 'Netwerklid';
  $('net-viewer-email').textContent = v.preview ? `Voorbeeld van: ${viewer.email}` : `Ingelogd met: ${viewer.email}`;
  $('net-client-name').textContent = v.client.full_name;

  const banner = $('net-preview-banner');
  banner.hidden = !v.preview;
  if (v.preview) {
    banner.innerHTML = v.can_act
      ? `👁️ <strong>Voorbeeldweergave (demo):</strong> zo ziet ${esc(firstName(viewer.name))} jouw gegevens. In het demo-profiel kun je ook namens ${esc(firstName(viewer.name))} reageren om het uit te proberen.`
      : `👁️ <strong>Voorbeeldweergave:</strong> zo ziet ${esc(firstName(viewer.name))} jouw gegevens. Reageren op opdrachten kan alleen ${esc(firstName(viewer.name))} zelf.`;
  }

  const pill = (on, label) => `<span class="px-2 py-0.5 rounded text-[10px] font-bold ${on ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400 line-through'}">${label}</span>`;
  $('net-permissions-banner').innerHTML = `
    <span class="font-bold text-slate-700">Opengezet door ${esc(clientFirst)}:</span>
    <div class="flex gap-1">${pill(viewer.can_see_mood, 'Stoplicht')}${pill(viewer.can_see_tasks, 'Opdrachten')}${pill(viewer.can_see_finance, 'Keuzes')}</div>`;

  // 1. Stoplicht
  const moodSec = $('net-section-mood');
  if (!v.mood) {
    moodSec.innerHTML = lockedCard('Stoplicht');
  } else if (!v.mood.color) {
    moodSec.innerHTML = `
      <div class="card space-y-2">
        <div class="field-row" data-help-anchor><span class="text-xs font-extrabold uppercase text-slate-500">Actueel Stoplicht</span>${helpBtn('net-mood')}</div>
        <p class="text-xs text-slate-500">${esc(clientFirst)} heeft het stoplicht nog niet ingevuld.</p>
      </div>`;
  } else {
    const c = COLORS[v.mood.color];
    const signals = Array.isArray(v.mood.signals) ? v.mood.signals : [];
    const actions = Array.isArray(v.mood.network_actions) ? v.mood.network_actions : [];
    moodSec.innerHTML = `
      <div class="bg-white p-4 rounded-2xl shadow-sm border-l-4 ${c.border} border-y border-r border-slate-200 space-y-3">
        <div class="field-row" data-help-anchor>
          <span class="text-xs font-extrabold uppercase text-slate-500">Actueel Stoplicht</span>
          <span class="flex items-center gap-1.5"><span class="text-[10px] font-bold px-2.5 py-0.5 rounded-full ${c.badge}">${c.emoji} ${esc(c.name)}</span>${helpBtn('net-mood')}</span>
        </div>
        <div class="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1.5">
          <div class="text-[10px] font-bold text-slate-400">Toelichting (${esc(fmtWhen(v.mood.updated_at))}):</div>
          ${signals.length ? `<div class="flex flex-wrap gap-1">${signals.map((s) => `<span class="text-[10px] font-bold ${c.badge} px-2 py-0.5 rounded-full">${esc(s)}</span>`).join('')}</div>` : ''}
          ${v.mood.reason ? `<p class="text-xs font-bold text-slate-800 break-words whitespace-pre-line">"${esc(v.mood.reason)}"</p>` : ''}
          ${v.mood.self_action ? `<p class="text-[11px] text-indigo-700 font-semibold pt-1 break-words">💪 Eigen actie: ${esc(v.mood.self_action)}</p>` : ''}
          ${!v.mood.reason && !v.mood.self_action ? '<p class="text-[11px] text-slate-500">Geen toelichting gegeven.</p>' : ''}
        </div>
        <div class="bg-emerald-50 p-3 rounded-xl border border-emerald-200 space-y-1">
          <div class="text-xs font-extrabold text-emerald-950">🤝 Wat helpt nu van jou (${esc(firstName(viewer.name))})?</div>
          ${actions.length
            ? `<ul class="text-xs text-emerald-900 list-disc pl-4 space-y-1">${actions.map((a) => `<li class="break-words">${esc(a)}</li>`).join('')}</ul>`
            : `<p class="text-xs text-emerald-900/60 italic">${esc(clientFirst)} heeft voor deze fase nog geen tips ingevuld.</p>`}
        </div>
      </div>`;
  }

  // 2. Opdrachten
  const tasksSec = $('net-section-tasks');
  if (!v.tasks) {
    tasksSec.innerHTML = lockedCard('Opdrachten');
  } else {
    const disabled = v.can_act ? '' : 'disabled';
    tasksSec.innerHTML = `
      <div class="card space-y-3">
        <div class="field-row" data-help-anchor>
          <h3 class="text-xs font-extrabold uppercase text-slate-700">🤝 Opdrachten &amp; Reageren</h3>${helpBtn('net-tasks')}
        </div>
        ${!v.tasks.length ? '<p class="text-xs text-slate-400 italic">Er staan nu geen opdrachten voor je klaar.</p>' : v.tasks.map((t) => {
          let statusBlock;
          if (t.status === 'accepted') {
            statusBlock = `<div class="p-2.5 rounded-xl bg-emerald-100 text-emerald-900 text-xs font-bold">✅ Ingepland door ${t.accepted_by_me ? 'jou' : esc(t.accepted_by)} (${esc(t.requested_time)})</div>`;
          } else {
            const counterInfo = t.status === 'counter'
              ? `<div class="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-950">🔄 ${t.counter_by_me ? 'Jij stelde' : `${esc(t.counter_by)} stelde`} voor: <strong>${esc(t.counter_proposal_time)}</strong>. Wacht op antwoord van ${esc(clientFirst)}.</div>`
              : '';
            statusBlock = `
              ${counterInfo}
              <div class="pt-2 border-t border-slate-200 space-y-2">
                <div class="flex gap-2">
                  <button type="button" data-action="net-accept" data-id="${t.id}" ${disabled} class="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold py-2 rounded-xl shadow">✅ Ik help (${esc(t.requested_time)})</button>
                  <button type="button" data-action="net-toggle-counter" data-id="${t.id}" ${disabled} class="flex-1 bg-white border border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-xs font-bold py-2 rounded-xl">🔄 Andere dag/tijd</button>
                </div>
                <form data-form="counter" data-id="${t.id}" hidden class="bg-indigo-50 p-3 rounded-xl border border-indigo-200 space-y-2" novalidate>
                  <div>
                    <div class="field-row" data-help-anchor><label for="counter-time-${t.id}" class="label">Wanneer kun jij wél?</label>${helpBtn('net-counter-time')}</div>
                    <input type="text" id="counter-time-${t.id}" maxlength="120" placeholder="Bijv. Donderdag 14:00" class="input bg-white mt-1">
                  </div>
                  <div>
                    <div class="field-row" data-help-anchor><label for="counter-note-${t.id}" class="label">Korte toelichting (mag leeg)</label>${helpBtn('net-counter-note')}</div>
                    <input type="text" id="counter-note-${t.id}" maxlength="1000" placeholder="Bijv. Woensdag moet ik werken" class="input bg-white mt-1">
                  </div>
                  <button type="submit" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-2 rounded-lg">Verstuur Voorstel</button>
                </form>
              </div>`;
          }
          return `
            <div class="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <div class="flex justify-between items-center gap-2">
                <span class="text-[10px] font-extrabold bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded">${esc(DURATIONS[t.duration] || t.duration)}</span>
                <span class="text-[11px] font-bold text-slate-700 text-right">Gewenst: ${esc(t.requested_time)}</span>
              </div>
              <h4 class="text-xs font-extrabold text-slate-900 break-words">${esc(t.title)}</h4>
              ${t.description ? `<p class="text-[11px] text-slate-600 break-words whitespace-pre-line">${esc(t.description)}</p>` : ''}
              <p class="text-[10px] font-bold text-slate-400">${t.target_type === 'open' ? '📣 Gevraagd aan de hele groep' : '👤 Speciaal aan jou gevraagd'}</p>
              ${statusBlock}
            </div>`;
        }).join('')}
      </div>`;
  }

  // 3. Keuze-Tafel afspraken
  const finSec = $('net-section-finance');
  if (!v.choices) {
    finSec.innerHTML = lockedCard('Keuzes');
  } else {
    finSec.innerHTML = `
      <div class="bg-white p-4 rounded-2xl shadow-sm border border-indigo-200 space-y-2">
        <div class="field-row" data-help-anchor>
          <h3 class="text-xs font-extrabold uppercase text-indigo-950">⚖️ Gemaakte Keuze-Tafel Afspraken</h3>${helpBtn('net-choices')}
        </div>
        ${v.savings_goal ? `<p class="text-[11px] text-slate-600">🎯 Spaardoel: <strong>${esc(v.savings_goal)}</strong></p>` : ''}
        ${!v.choices.length ? '<p class="text-xs text-slate-400 italic">Nog geen keuzes vastgelegd.</p>' : v.choices.map((c) => `
          <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
            <span class="text-[10px] font-bold text-slate-400 break-words">${esc(fmtWhen(c.created_at))} • ${esc(c.title)}</span>
            <p class="font-extrabold text-slate-800 break-words">${esc(c.chosen_path)}</p>
          </div>`).join('')}
      </div>`;
  }

  // 4. Meldingen
  const notes = Array.isArray(v.notifications) ? v.notifications : [];
  $('net-notifications-log').innerHTML = notes.length
    ? notes.map((n) => `
        <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
          <div class="flex justify-between gap-2 text-[10px] font-bold text-slate-400">
            <span class="truncate">Aan: ${esc(n.recipient || '-')}</span><span class="shrink-0">${esc(fmtWhen(n.created_at))}</span>
          </div>
          <p class="text-slate-700 font-medium mt-0.5 break-words">${esc(n.message)}</p>
        </div>`).join('')
    : '<p class="text-xs text-slate-400 italic">Nog geen meldingen voor jou.</p>';
}

async function networkAccept(taskId, button) {
  const v = state.networkView;
  await withBusy(button, async () => {
    const { error } = await sb.rpc('network_accept_task', { p_member_id: state.networkMemberId, p_task_id: taskId });
    if (error) {
      toastError(error, 'Accepteren lukte niet');
      return loadNetworkView({ silent: true });
    }
    const t = v.tasks.find((x) => x.id === taskId);
    await loadNetworkView({ silent: true });
    toast('Opdracht Geaccepteerd! 🎉', `${firstName(v.client.full_name)} ziet nu dat je helpt${t ? ` op ${t.requested_time}` : ''}.`, '🎉', 'success');
    if (v.preview && state.loadedProfileId) { await reload('tasks', 'notifications'); updateBadges(); }
  });
}

async function networkCounter(form) {
  const taskId = form.dataset.id;
  const timeEl = $(`counter-time-${taskId}`);
  const time = timeEl.value.trim();
  const note = $(`counter-note-${taskId}`).value.trim();
  if (!time) {
    markInvalid(timeEl);
    return toast('Wanneer kun je wel?', 'Vul in op welke dag en tijd je wel kunt helpen.', '⚠️', 'warn');
  }
  const v = state.networkView;
  await withBusy(form.querySelector('[type=submit]'), async () => {
    const { error } = await sb.rpc('network_counter_task', { p_member_id: state.networkMemberId, p_task_id: taskId, p_time: time, p_note: note });
    if (error) return toastError(error, 'Voorstel versturen lukte niet');
    await loadNetworkView({ silent: true });
    toast('Voorstel Verzonden 🔄', `${firstName(v.client.full_name)} kan jouw voorstel (${time}) nu met één tik goedkeuren.`, '🔄', 'success');
    if (v.preview && state.loadedProfileId) { await reload('tasks', 'notifications'); updateBadges(); }
  });
}

async function redeemInviteCode(form) {
  const input = form.querySelector('[name=code]');
  const code = normalizeCode(input.value);
  if (code.length !== 8) {
    markInvalid(input);
    return toast('Code klopt niet', 'Een uitnodigingscode heeft 8 tekens, bijvoorbeeld K7P2-9QXM.', '⚠️', 'warn');
  }
  await withBusy(form.querySelector('[type=submit]'), async () => {
    const { data, error } = await sb.rpc('accept_invite', { p_code: code });
    if (error) return toastError(error, 'Koppelen lukte niet');
    input.value = '';
    toast('Gekoppeld! 🎉', `Je kijkt nu mee in het netwerk van ${data.client_name}.`, '👥', 'success');
    state.networkMemberId = data.member_id;
    local.set(userKey('networkMember'), data.member_id);
    await loadNetworks();
    if ($('screen-app').hidden) {
      local.set(userKey('mode'), 'network');
      await enterApp();
    } else {
      await switchMode('network');
    }
  });
}

// =============================================================================
// DASHBOARD 3: SUPER ADMIN (anoniem impact-logboek)
// =============================================================================
const ADMIN_PAGE = 100;
const IMPACT_EVENTS = {
  STOPLICHT_TRANSITIE: { icon: '🚦', label: 'Stoplicht gewisseld', ring: 'border-indigo-500/40' },
  KEUZETAFEL_PAD_A: { icon: '⚡', label: 'Keuze-Tafel: Pad A (impuls)', ring: 'border-amber-500/40' },
  KEUZETAFEL_PAD_B: { icon: '🛡️', label: 'Keuze-Tafel: Pad B (slimme stap)', ring: 'border-emerald-500/40' },
  NETWERK_OPDRACHT_GEACCEPTEERD: { icon: '🤝', label: 'Netwerk-opdracht geaccepteerd', ring: 'border-sky-500/40' },
};
const nf = new Intl.NumberFormat('nl-NL');
const nf1 = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 });
const euroNl = (n) => `€ ${nf.format(Math.round(Number(n) || 0))}`;
const hoursNl = (minutes) => nf1.format((Number(minutes) || 0) / 60);

function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDay(value, addDays = 0) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + addDays);
}

// Periode als [van, tot) in UTC voor de database ("tot en met" = begin van de dag erna)
function adminRange() {
  const from = parseDay(state.admin.from);
  const to = parseDay(state.admin.to, 1);
  return { p_from: from ? from.toISOString() : null, p_to: to ? to.toISOString() : null };
}

function adminPeriodLabel() {
  const { from, to } = state.admin;
  const fmt = (s) => parseDay(s).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
  if (!from && !to) return 'Alle gegevens';
  if (from && to) return `${fmt(from)} t/m ${fmt(to)}`;
  return from ? `Vanaf ${fmt(from)}` : `Tot en met ${fmt(to)}`;
}

function adminLogQuery(select = '*', options) {
  const { p_from, p_to } = adminRange();
  let q = sb.from('anonymous_impact_logs').select(select, options);
  if (p_from) q = q.gte('created_at', p_from);
  if (p_to) q = q.lt('created_at', p_to);
  if (state.admin.type !== 'ALL') q = q.eq('event_type', state.admin.type);
  return q;
}

async function openAdminDashboard() {
  $('admin-email').textContent = state.user?.email || '-';
  $('admin-from').value = state.admin.from;
  $('admin-to').value = state.admin.to;
  $('admin-log-filter').value = state.admin.type;
  if (!state.admin.data) renderAdminLoading();
  await loadAdmin();
}

function renderAdminLoading() {
  $('admin-kpi-grid').innerHTML = '<div class="col-span-2 flex justify-center py-6"><div class="spinner"></div></div>';
  $('admin-mood-distribution').innerHTML = '';
  $('admin-stats').innerHTML = '';
  $('admin-events-log').innerHTML = '';
  $('admin-log-count').textContent = '';
}

async function loadAdmin({ silent = false } = {}) {
  const request = ++state.admin.request;
  const [dash, logs] = await Promise.all([
    sb.rpc('admin_dashboard', adminRange()),
    adminLogQuery('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(0, ADMIN_PAGE - 1),
  ]);
  if (request !== state.admin.request) return; // ondertussen ander filter gekozen
  const error = dash.error || logs.error;
  if (error) {
    if (!silent) toastError(error, 'Admin-gegevens laden lukte niet');
    if (error.code === '42501') {
      // Geen beheerder (meer): terug naar het eigen dashboard
      state.isAdmin = false;
      return switchMode('client');
    }
    return;
  }
  state.admin.data = dash.data;
  state.admin.logs = logs.data || [];
  state.admin.total = logs.count ?? state.admin.logs.length;
  renderAdmin();
}

async function loadMoreAdminLogs(button) {
  await withBusy(button, async () => {
    const start = state.admin.logs.length;
    const request = state.admin.request;
    const { data, error } = await adminLogQuery('*')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(start, start + ADMIN_PAGE - 1);
    if (request !== state.admin.request) return;
    if (error) return toastError(error, 'Meer laden lukte niet');
    state.admin.logs.push(...(data || []));
    renderAdminLog();
  });
}

function renderAdmin() {
  renderAdminPresets();
  renderAdminKpis();
  renderAdminMood();
  renderAdminStats();
  renderAdminLog();
}

function renderAdminPresets() {
  const active = adminActivePreset();
  document.querySelectorAll('#admin-presets [data-preset]').forEach((b) => {
    b.className = 'admin-chip' + (b.dataset.preset === active ? ' admin-chip-on' : '');
  });
}

function presetRange(preset) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case 'month': return { from: isoDay(new Date(y, m, 1)), to: isoDay(now) };
    case 'prev-month': return { from: isoDay(new Date(y, m - 1, 1)), to: isoDay(new Date(y, m, 0)) };
    case 'year': return { from: isoDay(new Date(y, 0, 1)), to: isoDay(now) };
    default: return { from: '', to: '' };
  }
}

function adminActivePreset() {
  const { from, to } = state.admin;
  return ['all', 'month', 'prev-month', 'year'].find((p) => {
    const r = presetRange(p);
    return r.from === from && r.to === to;
  }) || null;
}

function kpiCard(icon, title, value, sub) {
  return `
    <div class="admin-kpi">
      <div class="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1"><span>${icon}</span><span class="truncate">${title}</span></div>
      <div class="text-xl font-black text-white mt-1 leading-tight break-words">${value}</div>
      <div class="text-[10px] text-slate-400 mt-1 leading-snug">${sub}</div>
    </div>`;
}

function renderAdminKpis() {
  const d = state.admin.data;
  const choices = d.pad_a + d.pad_b;
  const pctB = choices ? Math.round((d.pad_b / choices) * 100) : null;
  $('admin-kpi-grid').innerHTML = [
    kpiCard('👥', 'Cliënten &amp; netwerk', `${nf.format(d.clients)} <span class="text-xs font-bold text-slate-400">cliënten</span>`,
      `${nf.format(d.members)} netwerkleden, waarvan ${nf.format(d.members_joined)} gekoppeld`),
    kpiCard('⏱️', 'Informele zorg', `${hoursNl(d.informal_minutes)} <span class="text-xs font-bold text-slate-400">uur</span>`,
      `${nf.format(d.network_tasks)} netwerk-opdrachten · ${nf.format(d.recoveries)}× herstel naar groen`),
    kpiCard('⚖️', 'Pad B gekozen', pctB === null ? '–' : `${pctB}%`,
      choices ? `${nf.format(d.pad_b)} van ${nf.format(choices)} keuzes op de Keuze-Tafel` : 'Nog geen keuzes in deze periode'),
    kpiCard('💶', 'Rekenvoorbeeld', euroNl(d.saved_euros), 'Aanname, niet gemeten: €45 per herstel, €55 per Pad B, €65 per uur netwerkhulp'),
  ].join('');
}

function renderAdminMood() {
  const mood = state.admin.data.mood;
  const total = mood.green + mood.orange + mood.red + mood.none;
  const rows = [
    { key: 'green', label: 'Groen', emoji: '🟢', bar: 'bg-emerald-500' },
    { key: 'orange', label: 'Oranje', emoji: '🟠', bar: 'bg-amber-500' },
    { key: 'red', label: 'Rood', emoji: '🔴', bar: 'bg-rose-500' },
    { key: 'none', label: 'Nog geen kleur', emoji: '⚪', bar: 'bg-slate-500' },
  ];
  $('admin-mood-distribution').innerHTML = total
    ? rows.map((r) => {
        const n = mood[r.key];
        const pct = total ? Math.round((n / total) * 100) : 0;
        return `
          <div>
            <div class="flex justify-between text-xs font-bold text-slate-200"><span>${r.emoji} ${r.label}</span><span>${nf.format(n)} <span class="text-slate-500 font-semibold">(${pct}%)</span></span></div>
            <div class="h-2 bg-slate-800 rounded-full mt-1 overflow-hidden"><div class="h-full ${r.bar} rounded-full" style="width:${pct}%"></div></div>
          </div>`;
      }).join('')
    : '<div class="text-xs text-slate-400 bg-slate-800/60 border border-dashed border-slate-700 rounded-xl p-3 text-center">Nog geen cliënt-profielen (demo-profielen tellen niet mee).</div>';
}

function renderAdminStats() {
  const d = state.admin.data;
  const row = (icon, label, value) => `
    <div class="flex justify-between items-center gap-3 text-xs bg-slate-800/60 border border-slate-800 rounded-xl px-3 py-2">
      <span class="text-slate-300 font-semibold">${icon} ${label}</span>
      <span class="font-extrabold text-white text-right shrink-0">${value}</span>
    </div>`;
  $('admin-stats').innerHTML = [
    row('🛡️', 'Pad B (slimme stap)', nf.format(d.pad_b)),
    row('⚡', 'Pad A (impuls)', nf.format(d.pad_a)),
    row('🚦', 'Stoplicht-wissels', nf.format(d.mood_events)),
    row('💚', 'Herstel naar groen (meegeteld)', nf.format(d.recoveries)),
    row('🤝', 'Netwerk-opdrachten opgepakt', `${nf.format(d.network_tasks)} · ${hoursNl(d.network_minutes)} uur`),
    row('🔑', 'Unieke cliënten in het logboek', nf.format(d.unique_clients)),
    row('👤', 'Accounts in totaal', nf.format(d.accounts)),
  ].join('') + `<p class="text-[10px] text-slate-500 pt-1">Periode: ${esc(adminPeriodLabel())}</p>`;
}

function renderAdminLog() {
  const { logs, total } = state.admin;
  $('admin-log-count').textContent = total
    ? `${nf.format(logs.length)} van ${nf.format(total)} gebeurtenissen · ${adminPeriodLabel()}`
    : '';
  $('admin-events-log').innerHTML = logs.length
    ? logs.map((l) => {
        const meta = IMPACT_EVENTS[l.event_type] || { icon: '•', label: l.event_type, ring: 'border-slate-700' };
        const badges = [
          l.informal_minutes ? `<span class="bg-indigo-500/20 text-indigo-200 px-1.5 py-0.5 rounded">+${nf.format(l.informal_minutes)} min</span>` : '',
          l.saved_euros ? `<span class="bg-emerald-500/20 text-emerald-200 px-1.5 py-0.5 rounded">+${euroNl(l.saved_euros)}</span>` : '',
        ].join('');
        return `
          <div class="bg-slate-800/60 border ${meta.ring} rounded-xl p-3 space-y-1">
            <div class="flex justify-between items-start gap-2">
              <span class="text-xs font-extrabold text-white">${meta.icon} ${esc(meta.label)}</span>
              <span class="text-[10px] text-slate-400 shrink-0">${esc(fmtWhen(l.created_at))}</span>
            </div>
            <p class="text-[11px] text-slate-300 leading-snug break-words">${esc(l.detail || '')}</p>
            <div class="flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
              <span class="text-slate-500 font-mono">Cliëntcode ${esc(String(l.client_hash).slice(0, 8))}</span>${badges}
            </div>
          </div>`;
      }).join('')
    : `<div class="text-xs text-slate-400 bg-slate-800/60 border border-dashed border-slate-700 rounded-xl p-4 text-center leading-relaxed">
        Nog geen gebeurtenissen${state.admin.type !== 'ALL' || state.admin.from || state.admin.to ? ' voor dit filter of deze periode' : ''}.<br>
        Gebeurtenissen komen vanzelf binnen als cliënten het stoplicht wisselen, op de Keuze-Tafel kiezen of als het netwerk een opdracht oppakt.
      </div>`;
  $('admin-load-more').hidden = logs.length >= total;
}

function setAdminPeriod(from, to) {
  if (from && to && from > to) [from, to] = [to, from];
  state.admin.from = from;
  state.admin.to = to;
  $('admin-from').value = from;
  $('admin-to').value = to;
  renderAdminPresets();
  return loadAdmin();
}

// --- CSV (Excel, Nederlandse instellingen: puntkomma + UTF-8 met BOM) ---------
function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // voorkom formules in Excel
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename, rows) {
  const content = '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportSuffix() {
  const { from, to } = state.admin;
  if (!from && !to) return `alles_${isoDay(new Date())}`;
  return `${from || 'begin'}_tm_${to || isoDay(new Date())}`;
}

async function exportAdminLog(button) {
  await withBusy(button, async () => {
    const rows = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await adminLogQuery('created_at, client_hash, event_type, detail, informal_minutes, saved_euros')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(start, start + 999);
      if (error) return toastError(error, 'Downloaden lukte niet');
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    if (!rows.length) return toast('Niets te downloaden', 'Er zijn geen gebeurtenissen voor deze periode of dit filter.', 'ℹ️', 'warn');
    const header = ['Datum', 'Tijd', 'Cliëntcode (anoniem)', 'Gebeurteniscode', 'Gebeurtenis', 'Toelichting', 'Informele zorg (minuten)', 'Rekenvoorbeeld besparing (euro, aanname)'];
    const body = rows.map((l) => {
      const d = new Date(l.created_at);
      return [
        isoDay(d),
        d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }),
        l.client_hash,
        l.event_type,
        IMPACT_EVENTS[l.event_type]?.label || l.event_type,
        l.detail || '',
        l.informal_minutes,
        l.saved_euros,
      ];
    });
    downloadCsv(`eigenkoers-impactlogboek_${exportSuffix()}.csv`, [header, ...body]);
    toast('Download klaar ⬇️', `${nf.format(rows.length)} gebeurtenissen opgeslagen als CSV (opent in Excel).`, '📄', 'success');
  });
}

async function exportAdminSummary(button) {
  await withBusy(button, async () => {
    const { data: d, error } = await sb.rpc('admin_dashboard', adminRange());
    if (error) return toastError(error, 'Downloaden lukte niet');
    const choices = d.pad_a + d.pad_b;
    const rows = [
      ['Onderdeel', 'Waarde'],
      ['Rapport', 'EigenKoers – Anonieme impact-samenvatting'],
      ['Periode', adminPeriodLabel()],
      ['Gemaakt op', new Date(d.generated_at).toLocaleString('nl-NL')],
      ['', ''],
      ['Cliënten (nu, zonder demo)', d.clients],
      ['Netwerkleden (nu)', d.members],
      ['Netwerkleden gekoppeld (nu)', d.members_joined],
      ['Stoplicht nu groen', d.mood.green],
      ['Stoplicht nu oranje', d.mood.orange],
      ['Stoplicht nu rood', d.mood.red],
      ['Nog geen kleur gekozen', d.mood.none],
      ['', ''],
      ['Gebeurtenissen in periode', d.events],
      ['Unieke cliënten in periode', d.unique_clients],
      ['Uren geactiveerde informele zorg', hoursNl(d.informal_minutes)],
      ['Rekenvoorbeeld besparing (euro) – aanname, geen gemeten besparing', d.saved_euros],
      ['Keuze-Tafel: Pad A (impuls)', d.pad_a],
      ['Keuze-Tafel: Pad B (slimme stap)', d.pad_b],
      ['Percentage Pad B', choices ? `${Math.round((d.pad_b / choices) * 100)}%` : '–'],
      ['Stoplicht-wissels', d.mood_events],
      ['Herstel naar groen (meegeteld)', d.recoveries],
      ['Netwerk-opdrachten opgepakt', d.network_tasks],
      ['Uren hulp door netwerk', hoursNl(d.network_minutes)],
      ['', ''],
      ['Rekenregel stoplicht', 'Herstel oranje/rood naar groen = 30 min informele zorg + €45 (max. 1x per dag per cliënt)'],
      ['Rekenregel Keuze-Tafel', 'Pad B = €55 bespaarde schadelast; Pad A = €0'],
      ['Rekenregel netwerk-opdracht', 'Kort 30 min, 1 uur 60 min, 2-3 uur 150 min, dagdeel 240 min; €65 per uur bespaarde WMO-kosten; 1x per opdracht'],
      ['Privacy', 'Anoniem: geen namen, e-mailadressen of eigen teksten. Demo-profielen tellen niet mee.'],
    ];
    downloadCsv(`eigenkoers-samenvatting_${exportSuffix()}.csv`, rows);
    toast('Download klaar ⬇️', 'De samenvatting is opgeslagen als CSV (opent in Excel).', '📋', 'success');
  });
}

// =============================================================================
// REALTIME & VERVERSEN
// =============================================================================
let reloadTimer = null;
function scheduleClientRefresh() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    if (state.mode !== 'client' || !state.loadedProfileId) return;
    try {
      await reload('tasks', 'notifications');
      if (!state.editingTaskId) renderTasksTab();
      else renderTasksListOnly();
      updateBadges();
    } catch (_) { /* stil */ }
  }, 400);
}

function renderTasksListOnly() {
  const keepTarget = $('task-input-target').value;
  renderTasksTab();
  $('task-input-target').value = keepTarget;
}

function startRealtime() {
  stopRealtime();
  const pid = state.activeProfileId;
  if (!pid) return;
  state.realtimePid = pid;
  state.realtimeChannel = sb.channel(`profiel-${pid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `profile_id=eq.${pid}` }, () => scheduleClientRefresh())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `profile_id=eq.${pid}` }, (payload) => {
      const n = payload.new;
      if (n?.from_network && state.mode === 'client' && pid === state.activeProfileId) {
        toast('Nieuwe reactie 🔔', n.message, '🔔');
      }
      scheduleClientRefresh();
    })
    .subscribe();
}

function stopRealtime() {
  if (state.realtimeChannel) {
    sb.removeChannel(state.realtimeChannel);
    state.realtimeChannel = null;
  }
  state.realtimePid = null;
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(() => {
    if (state.mode === 'network' && document.visibilityState === 'visible' && !document.querySelector('[data-form="counter"]:not([hidden])')) {
      loadNetworkView({ silent: true });
    }
  }, 30000);
}

function stopPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

// =============================================================================
// VRAAGTEKEN-UITLEG
// =============================================================================
function toggleHelp(btn) {
  const key = btn.dataset.help;
  let anchor = btn.closest('[data-help-anchor]') || btn.parentElement;
  // Nooit naast een element in een horizontale flex-rij plaatsen
  while (anchor.parentElement) {
    const cs = getComputedStyle(anchor.parentElement);
    if ((cs.display === 'flex' || cs.display === 'inline-flex') && !cs.flexDirection.startsWith('column')) anchor = anchor.parentElement;
    else break;
  }
  const next = anchor.nextElementSibling;
  if (next && next.classList.contains('help-box') && next.dataset.for === key) {
    next.remove();
    btn.setAttribute('aria-expanded', 'false');
    return;
  }
  if (next && next.classList.contains('help-box')) next.remove();
  const box = document.createElement('div');
  box.className = 'help-box' + (btn.hasAttribute('data-help-dark') ? ' help-box-dark' : '');
  box.dataset.for = key;
  box.setAttribute('role', 'note');
  box.innerHTML = `${HELP[key] || 'Hier komt binnenkort uitleg.'}<div class="mt-1.5"><button type="button" data-action="read-aloud" class="read-btn-inline">🔊 Lees voor</button></div>`;
  anchor.insertAdjacentElement('afterend', box);
  btn.setAttribute('aria-expanded', 'true');
}

// =============================================================================
// EVENTS
// =============================================================================
const ACTIONS = {
  'reload-page': () => location.reload(),
  'auth-tab': (el) => setAuthTab(el.dataset.tab),
  'forgot-password': () => infoDialog('Wachtwoord vergeten?', `
    <p>Geen probleem. Je wachtwoord kan (nog) niet via een e-mail worden hersteld.</p>
    <p>Vraag je begeleider om contact op te nemen met de beheerder van EigenKoers. Die stelt een nieuw tijdelijk wachtwoord voor je in.</p>`),
  logout: () => logout(),
  'switch-mode': (el) => switchMode(el.dataset.mode),
  'client-tab': (el) => switchClientTab(el.dataset.tab),
  'open-account': () => openAccountModal(),
  'open-notifications': () => openNotifications(),
  'close-modal': (el) => {
    const modal = el.closest('.modal');
    if (!modal) return;
    if (modal.id === 'signaling-editor-modal') return requestCloseSigEditor();
    if (modal.id === 'confirm-modal') return modal.dispatchEvent(new Event('modal-dismiss'));
    closeModal(modal.id);
  },
  'switch-profile': (el) => switchProfile(el.dataset.id),
  'delete-profile': (el) => deleteProfile(el.dataset.id),
  'load-demo': (el) => loadDemo(el),
  // Stoplicht
  'open-mood': (el) => openMoodModal(el.dataset.color),
  'toggle-mood-chip': (el) => {
    const d = state.moodDraft;
    const chip = d.chips[Number(el.dataset.index)];
    if (d.selected.has(chip)) d.selected.delete(chip);
    else d.selected.add(chip);
    renderMoodBody();
  },
  'pick-mood-action': (el) => {
    const d = state.moodDraft;
    const idx = el.dataset.index === 'custom' ? 'custom' : Number(el.dataset.index);
    // Bij Rood is kiezen vrijwillig: nog een keer tikken zet het weer uit.
    d.action = d.color === 'red' && d.action === idx ? null : idx;
    renderMoodBody();
    if (idx === 'custom') $('mood-custom-action')?.focus();
  },
  'toggle-mood-more': () => {
    state.moodDraft.moreOpen = !state.moodDraft.moreOpen;
    renderMoodBody();
    if (state.moodDraft.moreOpen) $('mood-reason')?.focus();
  },
  'reflect-open': () => openReflectModal(),
  'reflect-later': () => reflectLater(),
  'reflect-dismiss': () => {
    const p = activeProfile();
    if (p) local.set(reflectKey(p.id), 'done');
    renderReflectBanner();
  },
  'reflect-toggle': (el) => {
    const r = state.reflectDraft;
    const plan = state.plans.red || emptyPlan('red');
    const list = el.dataset.kind === 'signals' ? plan.signal_chips || [] : plan.self_actions || [];
    const item = list[Number(el.dataset.index)];
    const set = r[el.dataset.kind];
    if (set.has(item)) set.delete(item);
    else set.add(item);
    renderReflectBody();
  },
  'read-aloud': (el) => readAloud(el),
  'view-phase': (el) => {
    state.viewPhase = el.dataset.color;
    renderStatusTab();
  },
  // Leerdoelen
  'new-goal': () => openGoalEditor(null),
  'edit-goal': (el) => openGoalEditor(el.dataset.id),
  'delete-goal': (el) => deleteGoal(el.dataset.id),
  // Signaleringsplan
  'open-plan-editor': () => openSignalingEditor(),
  'sig-item-add': (el) => sigAdd(el.dataset.field),
  'sig-item-edit': (el) => {
    state.sigEditing = { field: el.dataset.field, index: Number(el.dataset.index) };
    renderSigEditor();
  },
  'sig-item-save': (el) => sigSaveItem(el.dataset.field, Number(el.dataset.index)),
  'sig-item-cancel': () => {
    state.sigEditing = null;
    renderSigEditor();
  },
  'sig-item-delete': (el) => {
    const draft = state.sigDrafts[$('sig-edit-color').value];
    draft[el.dataset.field].splice(Number(el.dataset.index), 1);
    state.sigEditing = null;
    renderSigEditor();
  },
  // Keuze-tafel
  'select-scenario': (el) => selectScenario(el.dataset.key),
  'choose-path': (el) => choosePath(el.dataset.pad, el),
  'delete-choice': (el) => deleteChoice(el.dataset.id),
  // Opdrachten
  'edit-task': (el) => startEditTask(el.dataset.id),
  'cancel-task-edit': () => cancelTaskEdit(),
  'delete-task': (el) => deleteTask(el.dataset.id),
  'approve-counter': (el) => approveCounter(el.dataset.id, el),
  'reject-counter': (el) => rejectCounter(el.dataset.id, el),
  // Cirkel
  'toggle-invite-form': () => {
    if ($('invite-person-box').hidden) openInviteForm(null);
    else closeInviteForm();
  },
  'edit-member': (el) => openInviteForm(el.dataset.id),
  'remove-member': (el) => removeMember(el.dataset.id),
  'share-member': (el) => openInviteShare(el.dataset.id),
  'preview-member': async (el) => {
    state.networkMemberId = el.dataset.id;
    local.set(userKey('networkMember'), el.dataset.id);
    await switchMode('network');
    $('network-main').scrollTo({ top: 0 });
  },
  'copy-invite': async (el) => {
    const m = state.members.find((x) => x.id === el.dataset.id);
    if (!m) return;
    const ok = await copyText(inviteMessage(m));
    toast(ok ? 'Gekopieerd 📋' : 'Kopiëren lukte niet', ok ? 'Plak het bericht in een e-mail, sms of app.' : 'Selecteer de link en kopieer hem zelf.', '📋', ok ? 'success' : 'warn');
  },
  'copy-code': async (el) => {
    const m = state.members.find((x) => x.id === el.dataset.id);
    if (!m) return;
    const ok = await copyText(formatCode(m.invite_code));
    toast(ok ? 'Code gekopieerd 🔢' : 'Kopiëren lukte niet', ok ? formatCode(m.invite_code) : 'Schrijf de code over.', '🔢', ok ? 'success' : 'warn');
  },
  'share-invite': async (el) => {
    const m = state.members.find((x) => x.id === el.dataset.id);
    if (!m) return;
    try {
      await navigator.share({ title: 'Uitnodiging EigenKoers', text: inviteMessage(m) });
    } catch (_) { /* geannuleerd */ }
  },
  // Netwerk
  'refresh-network': async (el) => {
    await withBusy(el, async () => {
      try { await loadNetworks(); } catch (_) { /* negeren */ }
      populateNetworkSelect();
      await loadNetworkView();
    });
  },
  // Admin
  'admin-refresh': (el) => withBusy(el, () => loadAdmin()),
  'admin-preset': (el) => {
    const r = presetRange(el.dataset.preset);
    return setAdminPeriod(r.from, r.to);
  },
  'admin-load-more': (el) => loadMoreAdminLogs(el),
  'admin-export-log': (el) => exportAdminLog(el),
  'admin-export-summary': (el) => exportAdminSummary(el),
  'net-accept': (el) => networkAccept(el.dataset.id, el),
  'net-toggle-counter': (el) => {
    const form = document.querySelector(`[data-form="counter"][data-id="${el.dataset.id}"]`);
    if (!form) return;
    form.hidden = !form.hidden;
    if (!form.hidden && window.matchMedia('(pointer: fine)').matches) $(`counter-time-${el.dataset.id}`).focus();
  },
};

const CHANGES = {
  'toggle-goal': (el) => toggleGoal(el),
  'toggle-perm': (el) => togglePermission(el),
  'network-select': (el) => {
    state.networkMemberId = el.value;
    local.set(userKey('networkMember'), el.value);
    loadNetworkView();
    $('network-main').scrollTo({ top: 0 });
  },
  'sig-color': () => {
    if (state.sigEditing) sigSaveItem(state.sigEditing.field, state.sigEditing.index);
    state.sigEditing = null;
    renderSigEditor();
  },
  'admin-period': () => setAdminPeriod($('admin-from').value, $('admin-to').value),
  'admin-filter': (el) => {
    state.admin.type = el.value;
    return loadAdmin();
  },
};

const SUBMITS = {
  'form-login': onLogin,
  'form-register': onRegister,
  'form-onboarding-profile': onboardingCreate,
  'form-edit-profile': saveEditedProfile,
  'form-new-profile': createNewBlankProfile,
  'mood-form': confirmMoodChange,
  'reflect-form': saveReflection,
  'goal-form': saveGoal,
  'sig-form': saveSignalingPlan,
  'custom-scenario-box': drawCustomScenario,
  'task-form': saveTask,
  'invite-person-box': saveMember,
};

function wireEvents() {
  document.addEventListener('click', async (e) => {
    const help = e.target.closest('.help-btn[data-help]');
    if (help) {
      e.preventDefault();
      toggleHelp(help);
      return;
    }
    const el = e.target.closest('[data-action]');
    if (el) {
      if (el.disabled) return;
      const handler = ACTIONS[el.dataset.action];
      if (handler) {
        e.preventDefault();
        try {
          await handler(el, e);
        } catch (err) {
          console.error(err);
          toastError(err);
        }
      }
      return;
    }
    // Klik op de donkere achtergrond van een modal = sluiten
    if (e.target.classList?.contains('modal') && e.target.id === topModal()) {
      const id = e.target.id;
      if (id === 'signaling-editor-modal') requestCloseSigEditor();
      else if (id === 'confirm-modal') e.target.dispatchEvent(new Event('modal-dismiss'));
      else closeModal(id);
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (el && CHANGES[el.dataset.change]) CHANGES[el.dataset.change](el, e);
  });

  document.addEventListener('submit', async (e) => {
    const form = e.target;
    try {
      if (SUBMITS[form.id]) return await SUBMITS[form.id](e);
      if (form.dataset.form === 'invite-code') {
        e.preventDefault();
        return await redeemInviteCode(form);
      }
      if (form.dataset.form === 'counter') {
        e.preventDefault();
        return await networkCounter(form);
      }
    } catch (err) {
      e.preventDefault();
      console.error(err);
      toastError(err);
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'sig-edit-signals' && state.sigDrafts) {
      state.sigDrafts[$('sig-edit-color').value].signals_text = e.target.value;
      $('sig-dirty-note').hidden = !sigDirty();
    }
    if (state.moodDraft && e.target.id === 'mood-custom-action') {
      state.moodDraft.customAction = e.target.value;
      $('mood-action-error').hidden = true;
    }
    if (state.moodDraft && e.target.id === 'mood-reason') state.moodDraft.reason = e.target.value;
    if (state.reflectDraft && e.target.id === 'reflect-new-signal') state.reflectDraft.newSignal = e.target.value;
    if (state.reflectDraft && e.target.id === 'reflect-new-action') state.reflectDraft.newAction = e.target.value;
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const id = topModal();
      if (!id) return;
      if (id === 'signaling-editor-modal') requestCloseSigEditor();
      else if (id === 'confirm-modal') $(id).dispatchEvent(new Event('modal-dismiss'));
      else closeModal(id);
      return;
    }
    if (e.key !== 'Enter' || e.isComposing) return;
    const t = e.target;
    if (t.matches?.('[data-sig-add-input]')) {
      e.preventDefault();
      sigAdd(t.dataset.sigAddInput);
    } else if (t.matches?.('[data-sig-edit-input]')) {
      e.preventDefault();
      sigSaveItem(t.dataset.sigEditInput, Number(t.dataset.index));
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.user) return;
    if (state.mode === 'client' && state.loadedProfileId) scheduleClientRefresh();
    if (state.mode === 'network' && !$('screen-app').hidden) loadNetworkView({ silent: true });
    if (state.mode === 'admin' && !$('screen-app').hidden) loadAdmin({ silent: true });
  });
}

init();
