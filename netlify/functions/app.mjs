// Data and actions for the web app. Every request needs the x-app-key header to match APP_PASSWORD.
import * as S from '../../lib/sheets.js';
import * as A from '../../lib/agent.js';
import crypto from 'node:crypto';

// Personal PINs: only an HMAC is stored; device tokens stop working when the PIN changes.
const mac = text => crypto.createHmac('sha256', process.env.APP_PASSWORD || '').update(text).digest('hex');
const pinHash = (name, pin) => mac(`pin:${name}:${pin}`);
const tokenFor = m => mac(`token:${m.name}:${m.pin_hash}`);
const validPin = pin => /^\d{4,6}$/.test(String(pin || ''));
function same(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const allowed = req => !!process.env.APP_PASSWORD && req.headers.get('x-app-key') === process.env.APP_PASSWORD;
const err = (error, status, extra) => Response.json({ error, ...extra }, { status });
const ok = (x = {}) => Response.json({ ok: true, ...x });
const save = (tab, row) => row._row ? S.update(tab, +row._row, row) : S.append(tab, row);

// Admin = whoever knows ADMIN_PIN (sent as x-admin-pin on top of the household password).
const isAdmin = req => !!process.env.ADMIN_PIN && req.headers.get('x-admin-pin') === process.env.ADMIN_PIN;
const ADMIN_ONLY = new Set(['init', 'saveSettings', 'goLive', 'pause', 'preview', 'startVote', 'closeVote', 'resetPin', 'deleteMember']);
const NO_PIN_CHECK = new Set(['init', 'verifyPin', 'setPin']);
const slow = () => new Promise(r => setTimeout(r, 600));

export default async (req) => {
  if (!allowed(req)) return err('Wrong password', 401);
  const admin = isAdmin(req);

  if (req.method === 'GET') {
    try {
      const ctx = await A.load();
      return Response.json({
        ...ctx, members: ctx.members.map(({ pin_hash, ...m }) => ({ ...m, has_pin: !!pin_hash })),
        subs: ctx.subs.filter(s => !s.status).map(s => ({ member: s.member })),
        tonight: A.tonight(ctx), buyer: A.buyer(ctx.changes, A.today()), budget: A.budget(ctx),
        readiness: admin ? A.readiness(ctx) : [], today: A.today(), vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
        isAdmin: admin, adminEmail: process.env.ADMIN_EMAIL || '',
      });
    } catch (e) {
      return Response.json({ error: e.message, needsInit: true, isAdmin: admin });
    }
  }

  const { action, me, row, settings, n, comment, image, subscription, reason, type, count, items, total, category, note, messages, member, file, text, remove, pin, dish, tab, values } = await req.json();
  if (ADMIN_ONLY.has(action) && !admin) return err('Only the admin can do this. Enter the admin PIN in Setup.', 403);
  try {
    if (action === 'init') { await S.init(); return ok(); }
    const ctx = await A.load();
    const meRow = ctx.members.find(m => m.name === me);
    // A person with a PIN must send the token that matches it.
    if (!NO_PIN_CHECK.has(action) && meRow?.pin_hash && !same(req.headers.get('x-member-token'), tokenFor(meRow)))
      return err('Enter your PIN again.', 401, { pin: true });
    switch (action) {
      case 'verifyPin': {
        if (!meRow?.pin_hash) return err('No PIN is set for this person yet.', 400);
        if (!same(pinHash(me, pin), meRow.pin_hash)) { await slow(); return err('That PIN is not right.', 403); }
        return ok({ token: tokenFor(meRow) });
      }
      case 'setPin': {
        if (!meRow) return err('Choose who you are first.', 400);
        if (meRow.pin_hash && !same(req.headers.get('x-member-token'), tokenFor(meRow))) return err('Enter your current PIN first.', 401, { pin: true });
        if (!validPin(pin)) return err('Use 4 to 6 digits.', 400);
        const updated = { ...meRow, pin_hash: pinHash(me, pin) };
        await S.update('Members', meRow._row, updated);
        return ok({ token: tokenFor(updated) });
      }
      case 'resetPin': {
        const m = ctx.members.find(x => x.name === member);
        if (!m) return err('Unknown person.', 400);
        await S.update('Members', m._row, { ...m, pin_hash: '' }); return ok();
      }
      case 'saveMember': {
        if (!row?.name?.trim()) return err('Name is required', 400);
        if (!admin) {
          // Family members edit only their own card, and cannot rename themselves or change role.
          const own = ctx.members.find(m => m.name === me);
          if (!own || +row._row !== own._row) return err('You can only edit your own profile. Ask the admin for others.', 403);
          await save('Members', { ...own, ...row, name: own.name, role: own.role, _row: own._row, pin_hash: own.pin_hash }); return ok();
        }
        if (!row._row && ctx.members.some(m => m.name === row.name.trim())) return err('That name is already used', 400);
        const existing = row._row ? ctx.members.find(m => m._row === +row._row) : null;
        await save('Members', { ...existing, ...row, name: row.name.trim(), pin_hash: existing?.pin_hash || '' }); return ok();
      }
      case 'savePantry': // new items only; changes go through 'change'
        if (!row?.item || isNaN(+row.qty)) return err('Item and a numeric quantity are required', 400);
        await S.append('Pantry', { item: row.item, qty: row.qty, unit: row.unit, category: row.category, use_by: row.use_by || '', updated_at: A.today(), source: 'app', added_by: me }); return ok();
      case 'change': await A.changeOwned(ctx, me, admin, tab, row, values, remove); return ok();
      case 'deleteMember': {
        const m = ctx.members.find(x => x._row === +row) || ctx.members.find(x => x.name === member);
        if (!m) return err('Unknown person.', 400);
        await S.update('Members', m._row, { ...m, deleted: '1' }); return ok();
      }
      case 'saveSettings':
        for (const [k, v] of Object.entries(settings || {})) if (k !== 'LIVE' && ctx.settings[k] !== v) await S.setSetting(k, v);
        return ok();
      case 'preview': return ok({ options: await A.makeOptions(ctx, A.modeFor(ctx)) });
      case 'goLive': {
        const missing = A.readiness(ctx);
        if (missing.length) return err('Finish the setup checklist first', 400, { missing });
        await S.setSetting('LIVE', 'TRUE'); return ok();
      }
      case 'pause': await S.setSetting('LIVE', 'FALSE'); return ok();
      case 'vote': await A.vote(ctx, me, n); return ok();
      case 'cooked': return ok(await A.cooked(ctx));
      case 'rate': await A.rate(ctx, me, +n, comment); return ok();
      case 'skipToday': await A.skipToday(ctx, me, reason); return ok();
      case 'buying': await A.claimBuying(ctx, me, false); return ok();
      case 'release': await A.claimBuying(ctx, me, true); return ok();
      case 'tonight': await A.setTonight(ctx, me, type, +count); return ok();
      case 'pantryBulk': return ok(await A.addPantryBulk(ctx, me, items));
      case 'spend': await A.addSpend(ctx, me, total, category, note); return ok();
      case 'bill': return ok(await A.addBill(ctx, me, image));
      case 'subscribe': await A.subscribe(ctx, me, subscription); return ok();
      case 'chat': return ok(await A.chat(ctx, me, messages));
      case 'dietPlan':
        if (!admin && member !== me) return err('You can only change your own diet plan.', 403);
        return ok(await A.setDietPlan(ctx, me, member, { file, text, remove }));
      case 'startVote': return ok(await A.runVote(true));
      case 'closeVote': return ok(await A.runClose(true));
      case 'addWish': await A.addWish(ctx, me, dish); return ok();
      case 'weeklyList': return ok(await A.weeklyList(ctx, me));
      case 'scanPantry': return ok(await A.scanPantry(ctx, me, image));
      case 'testPush': return ok({ sent: await A.testPush(ctx, me) });
      default: return err('Unknown action', 400);
    }
  } catch (e) {
    if (e.status !== 400) console.error(e);
    return err(e.message, e.status || 500);
  }
};

export const config = { path: '/api/app' };
