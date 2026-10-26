// Google Sheets as the database. Service-account JWT signed with node:crypto, no SDK.
import crypto from 'node:crypto';

export const TABS = {
  Settings: ['key', 'value', 'note'],
  Members: ['name', 'role', 'diet', 'no_meat_days', 'allergies', 'dislikes', 'favourites', 'spice', 'lunch', 'notes', 'diet_plan', 'diet_plan_updated', 'pin_hash'],
  Pantry: ['item', 'qty', 'unit', 'category', 'updated_at', 'source', 'use_by'],
  Days: ['date', 'mode', 'status', 'options', 'winner', 'recipe', 'missing', 'note'],
  Votes: ['date', 'member', 'option', 'at'],
  Feedback: ['date', 'dish', 'member', 'rating', 'comment'],
  Purchases: ['date', 'store', 'total', 'staples', 'fresh', 'items'],
  Changes: ['date', 'member', 'type', 'count'],
  Wishes: ['date', 'member', 'dish', 'status'],
  Lists: ['date', 'kind', 'data'],
  Subscriptions: ['member', 'subscription', 'created_at', 'status'],
};

const DEFAULTS = [
  ['LIVE', 'FALSE', 'Changed by the Go live / Pause buttons in the app'],
  ['WEEKLY_BUDGET', '300', 'AED per week'],
  ['STAPLES_SPREAD_WEEKS', '4', 'Staples (atta, rice, oil...) are averaged over this many weeks'],
  ['COOK_OFF_DAY', 'Sunday', 'Weekly day off'],
  ['NO_REPEAT_DAYS', '14', 'A dish is not suggested again within this many days'],
  ['INTERNATIONAL_MAX_PER_WEEK', '2', ''],
  ['ALWAYS_STOCKED', 'milk, curd, eggs, bread, tea, sugar, salt, cooking oil, onion, tomato, ginger, garlic, green chilli', 'Assumed always at home: never on the shopping list, not tracked'],
  ['MAX_COOK_MINUTES', '120', 'Longest total cooking time the cook should spend on the full combo'],
  ['EQUIPMENT', 'pressure cooker, air fryer, microwave, stovetop. No oven', ''],
];

let token, tokenExp = 0;
async function auth() {
  if (token && Date.now() < tokenExp) return token;
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: process.env.GOOGLE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  });
  const key = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Google sign-in failed: ' + (j.error_description || j.error));
  token = j.access_token; tokenExp = Date.now() + 3300e3;
  return token;
}

async function api(path, opts = {}) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.SHEET_ID}${path}`, {
    ...opts, headers: { authorization: 'Bearer ' + await auth(), 'content-type': 'application/json' },
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Google Sheets: ' + (j.error?.message || r.status));
  return j;
}

const q = encodeURIComponent;
const toRow = (tab, o) => TABS[tab].map(h => o[h] == null ? '' : typeof o[h] === 'object' ? JSON.stringify(o[h]) : String(o[h]));

export async function rows(tab) {
  const j = await api(`/values/${q(tab + '!A1:Z')}`);
  const [head = [], ...data] = j.values || [];
  return data.map((v, i) => ({ _row: i + 2, ...Object.fromEntries(head.map((h, k) => [h, v[k] ?? ''])) }));
}

export const append = (tab, objs) => api(`/values/${q(tab + '!A1')}:append?valueInputOption=RAW`, {
  method: 'POST', body: JSON.stringify({ values: [].concat(objs).map(o => toRow(tab, o)) }),
});

export const update = (tab, row, obj) => api(`/values/${q(`${tab}!A${row}`)}?valueInputOption=RAW`, {
  method: 'PUT', body: JSON.stringify({ values: [toRow(tab, obj)] }),
});

export async function settings() {
  return Object.fromEntries((await rows('Settings')).map(r => [r.key, r.value]));
}

export async function setSetting(key, value) {
  const r = (await rows('Settings')).find(x => x.key === key);
  return r ? update('Settings', r._row, { ...r, value }) : append('Settings', { key, value });
}

export async function init() {
  const meta = await api('?fields=sheets.properties.title');
  const have = meta.sheets.map(s => s.properties.title);
  const add = Object.keys(TABS).filter(t => !have.includes(t));
  if (add.length) await api(':batchUpdate', {
    method: 'POST', body: JSON.stringify({ requests: add.map(title => ({ addSheet: { properties: { title } } })) }),
  });
  for (const t of Object.keys(TABS)) await api(`/values/${q(t + '!A1')}?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ values: [TABS[t]] }),
  });
  const s = await settings();
  const missing = DEFAULTS.filter(([k]) => !(k in s));
  if (missing.length) await append('Settings', missing.map(([key, value, note]) => ({ key, value, note })));
}
