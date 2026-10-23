// Data and actions for the web app. Every request needs the x-app-key header to match APP_PASSWORD.
import * as S from '../../lib/sheets.js';
import * as A from '../../lib/agent.js';

const allowed = req => !!process.env.APP_PASSWORD && req.headers.get('x-app-key') === process.env.APP_PASSWORD;
const err = (error, status, extra) => Response.json({ error, ...extra }, { status });
const ok = (x = {}) => Response.json({ ok: true, ...x });
const save = (tab, row) => row._row ? S.update(tab, +row._row, row) : S.append(tab, row);

export default async (req) => {
  if (!allowed(req)) return err('Wrong password', 401);

  if (req.method === 'GET') {
    try {
      const ctx = await A.load();
      return Response.json({
        ...ctx, subs: ctx.subs.filter(s => !s.status).map(s => ({ member: s.member })),
        tonight: A.tonight(ctx), buyer: A.buyer(ctx.changes, A.today()), budget: A.budget(ctx), readiness: A.readiness(ctx), today: A.today(), vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
      });
    } catch (e) {
      return Response.json({ error: e.message, needsInit: true });
    }
  }

  const { action, me, row, settings, n, comment, image, subscription, reason, type, count, items, total, category, note } = await req.json();
  try {
    if (action === 'init') { await S.init(); return ok(); }
    const ctx = await A.load();
    switch (action) {
      case 'saveMember':
        if (!row?.name?.trim()) return err('Name is required', 400);
        if (!row._row && ctx.members.some(m => m.name === row.name.trim())) return err('That name is already used', 400);
        await save('Members', { ...row, name: row.name.trim() }); return ok();
      case 'savePantry':
        if (!row?.item || isNaN(+row.qty)) return err('Item and a numeric quantity are required', 400);
        await save('Pantry', { ...row, updated_at: A.today(), source: 'app' }); return ok();
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
      case 'testPush': return ok({ sent: await A.testPush(ctx, me) });
      default: return err('Unknown action', 400);
    }
  } catch (e) {
    if (e.status !== 400) console.error(e);
    return err(e.message, e.status || 500);
  }
};

export const config = { path: '/api/app' };
