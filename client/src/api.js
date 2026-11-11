const TOKEN_KEY = 'oc_token';
const QUEUE_KEY = 'oc_sync_queue';

import { scheduleLocalBackup } from './localBackup.js';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function handle(res) {
  if (res.status === 401) {
    setToken(null);
    if (!location.hash.startsWith('#/login')) location.hash = '#/login';
    throw new Error('Sessão expirada. Entre novamente.');
  }
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch { /* corpo vazio */ }
    throw new Error(msg);
  }
  return ct.includes('json') ? res.json() : res.blob();
}

export async function api(path, { method = 'GET', body, formData, query, raw } = {}) {
  let url = '/api' + path;
  if (query) {
    const q = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, v); });
    const qs = q.toString();
    if (qs) url += '?' + qs;
  }
  const headers = { ...authHeaders() };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers,
    body: formData || (body ? JSON.stringify(body) : undefined)
  });
  if (raw) return res;
  const out = await handle(res);
  // Após cada mudança, agenda uma cópia local automática (conta + dados).
  if (method !== 'GET' && getToken()
      && !path.startsWith('/auth') && !path.startsWith('/backup')) {
    scheduleLocalBackup();
  }
  return out;
}

export function downloadUrl(path, query) {
  let url = '/api' + path;
  const q = new URLSearchParams(query || {});
  const t = getToken();
  if (t) q.set('token', t);
  const qs = q.toString();
  return qs ? `${url}?${qs}` : url;
}

/* ---------- fila offline: status de conferência sincronizados depois ---------- */
export function queueOfflineOp(op) {
  const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  q.push({ ...op, ts: Date.now() });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

export function pendingOfflineOps() {
  return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
}

export async function flushOfflineQueue() {
  const q = pendingOfflineOps();
  if (q.length === 0) return 0;
  const remaining = [];
  for (const op of q) {
    try {
      if (op.type === 'status') {
        await api(`/records/${op.record_id}/status`, { method: 'POST', body: { status: op.status, session_id: op.session_id } });
      } else if (op.type === 'quick') {
        await api('/conference/quick', { method: 'POST', body: op.body });
      }
    } catch {
      remaining.push(op);
    }
  }
  localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  return q.length - remaining.length;
}

window.addEventListener('online', () => { flushOfflineQueue().catch(() => {}); });

export function fmtDate(s) {
  if (!s) return '—';
  try {
    const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
    return d.toLocaleString('pt-BR', { date: 'short', time: 'short' });
  } catch { return s; }
}

export function fmtQty(rec) {
  if (rec.quantity == null) return '—';
  const n = Number(rec.quantity);
  const txt = Number.isInteger(n) ? String(n) : n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  return rec.unit ? `${txt} ${rec.unit}` : txt;
}
