// The agent: daily vote (12:00), reminder (12:50), close + recipe + shopping (13:00), and actions from the app.
import * as S from './sheets.js';
import { askJSON, askText } from './ai.js';
import { notify } from './push.js';

export const J = (s, d) => { if (!s) return d; try { return JSON.parse(s); } catch { return d; } };
const uae = (o = 0) => new Date(Date.now() + 4 * 36e5 + o * 864e5); // UAE is UTC+4, no DST
export const today = (o = 0) => uae(o).toISOString().slice(0, 10);
const weekday = () => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][uae().getUTCDay()];

// ---------- data ----------

export async function load() {
  const [settings, members, pantry, days, votes, feedback, purchases, subs, changes] = await Promise.all([
    S.settings(), ...['Members', 'Pantry', 'Days', 'Votes', 'Feedback', 'Purchases', 'Subscriptions', 'Changes'].map(S.rows),
  ]);
  return {
    settings, members, pantry, days, votes, feedback, purchases, subs, changes,
    family: members.filter(m => m.role !== 'cook'),
    cook: members.find(m => m.role === 'cook'),
  };
}

const live = ctx => ctx.settings.LIVE === 'TRUE';
const names = people => people.filter(Boolean).map(m => m.name);
const tell = (ctx, people, title, body) => notify(ctx.subs, names(people), title, body);

export function budget(ctx) {
  const sum = (days, f) => ctx.purchases.filter(p => p.date >= today(-days)).reduce((a, p) => a + (+p[f] || 0), 0);
  const weeks = +ctx.settings.STAPLES_SPREAD_WEEKS || 4;
  return { spent: Math.round(sum(6, 'fresh') + sum(weeks * 7 - 1, 'staples') / weeks), limit: +ctx.settings.WEEKLY_BUDGET || 300 };
}

export function readiness(ctx) {
  const miss = [];
  for (const k of ['SHEET_ID', 'GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GEMINI_API_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'APP_PASSWORD'])
    if (!process.env[k]) miss.push(`Add ${k} in Netlify environment variables`);
  if (!ctx.family.length) miss.push('Add the family members');
  for (const m of ctx.family) if (!m.allergies) miss.push(`${m.name}: fill allergies (write "none" if none)`);
  const on = new Set(ctx.subs.filter(s => !s.status).map(s => s.member));
  for (const m of ctx.family) if (!on.has(m.name)) miss.push(`${m.name}: turn on notifications on their phone`);
  return miss;
}

const profiles = ctx => ctx.family.map(({ name, diet, no_meat_days, allergies, dislikes, favourites, spice, lunch, notes, diet_plan }) =>
  ({ name, diet: diet || 'not set yet', no_meat_days, allergies, dislikes, favourites, spice: spice || 'medium', lunch: lunch || 'varies', notes, diet_plan: diet_plan || 'none' }));
const maxMinutes = ctx => +ctx.settings.MAX_COOK_MINUTES || 120;

// Tonight's headcount from the Changes tab: latest away/home per person, latest guests number.
export function tonight(ctx, date = today()) {
  const rows = ctx.changes.filter(c => c.date === date), state = {};
  let guests = 0;
  for (const c of rows) {
    if (c.type === 'away' || c.type === 'home') state[c.member] = c.type;
    if (c.type === 'guests') guests = Math.max(0, +c.count || 0);
  }
  const away = ctx.family.filter(m => state[m.name] === 'away').map(m => m.name);
  const dinner = ctx.family.length - away.length + guests;
  return { away, guests, portions: dinner + ctx.family.length };
}
// Who claimed today's shopping: the first "buying" wins; only that person can release it.
// ponytail: two claims in the same second can both notify; the sheet order still decides one buyer.
export function buyer(changes, date) {
  let b = null;
  for (const c of changes) if (c.date === date) {
    if (c.type === 'buying' && !b) b = c.member;
    if (c.type === 'release' && c.member === b) b = null;
  }
  return b;
}

const headcount = ctx => {
  const t = tonight(ctx);
  return `Tonight: ${t.away.length ? t.away.join(', ') + ' not eating dinner (still eats tomorrow\'s lunch). ' : ''}${t.guests ? t.guests + ' guests for dinner. ' : ''}Make ${t.portions} portions in total (dinner tonight + lunch tomorrow).`;
};
const pantryList = ctx => ctx.pantry.filter(p => +p.qty > 0).map(p => `${p.item} ${p.qty} ${p.unit}`).join('; ') || 'empty';

export const modeFor = ctx => {
  const d = ctx.days.find(x => x.date === today());
  return d?.status === 'off' || weekday() === ctx.settings.COOK_OFF_DAY ? 'off' : 'cook';
};

// ---------- pure helpers (covered by scripts/check.mjs) ----------

export function pickWinner(options, votes) {
  const latest = {};
  for (const v of votes) latest[v.member] = +v.option; // a later vote replaces an earlier one
  const tally = options.map((_, i) => Object.values(latest).filter(n => n === i + 1).length);
  const top = Math.max(...tally);
  // ties and no votes: the option needing the fewest purchases wins
  const index = tally.map((_, i) => i).filter(i => tally[i] === top)
    .sort((a, b) => (+options[a].missing_items || 0) - (+options[b].missing_items || 0))[0];
  return { winner: options[index], index, tally };
}

export const norm = s => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/(es|s)$/, '');
// ponytail: exact name + unit matching only; add unit conversion if pantry numbers drift
const findItem = (pantry, x) => pantry.find(p => norm(p.item) === norm(x.item) && norm(p.unit) === norm(x.unit));

export function deduct(pantry, ingredients = []) {
  const changed = [];
  for (const ing of ingredients) {
    const p = findItem(pantry, ing);
    if (!p) continue;
    p.qty = String(Math.max(0, +(+p.qty - +ing.qty).toFixed(2)));
    p.updated_at = today(); p.source = 'cooked';
    changed.push(p);
  }
  return changed;
}

export function mergePantry(pantry, items = [], source = 'bill') {
  const updates = [], adds = [];
  for (const it of items) {
    const p = findItem(pantry, it) || adds.find(a => norm(a.item) === norm(it.item) && norm(a.unit) === norm(it.unit));
    if (p) { p.qty = String(+(+p.qty + +it.qty).toFixed(2)); p.updated_at = today(); p.source = source; if (p._row && !updates.includes(p)) updates.push(p); }
    else adds.push({ item: it.item, qty: String(it.qty), unit: it.unit, category: it.category || 'fresh', updated_at: today(), source });
  }
  return { updates, adds };
}

// Second line of defence after the AI: flag any ingredient whose name contains a listed allergy word.
// ponytail: plain word match ("dairy" will not catch "milk"); list allergies as concrete ingredients.
export function allergyHits(people, ingredients = []) {
  const hits = [];
  for (const p of people) {
    const words = String(p.allergies || '').split(/,|;|\/|\band\b/).map(norm).filter(a => a.length > 2 && a !== 'none');
    for (const i of ingredients) for (const a of words) if (norm(i.item).includes(a)) hits.push(`${p.name}: ${i.item}`);
  }
  return hits;
}

// ---------- AI prompts ----------

export async function makeOptions(ctx, mode, carry) {
  const max = maxMinutes(ctx);
  const ask = extra => askOptions(ctx, mode, carry, max, extra);
  let options = await ask('');
  if (options.some(o => +o.cook_minutes > max)) options = await ask(`Your last options took longer than ${max} minutes. Every option must take ${max} minutes or less in total.`);
  const fit = options.filter(o => !(+o.cook_minutes > max));
  return (fit.length ? fit : options).slice(0, 3);
}

async function askOptions(ctx, mode, carry, max, extra) {
  const recent = ctx.days.filter(d => d.date >= today(-(+ctx.settings.NO_REPEAT_DAYS || 14)) && d.winner)
    .map(d => ({ date: d.date, dish: J(d.winner, {}).name, international: J(d.winner, {}).international }));
  const ratings = ctx.feedback.slice(-40).map(f => `${f.dish}: ${f.member} ${f.rating}/5 ${f.comment}`);
  const b = budget(ctx);
  const task = mode === 'off'
    ? 'The cook is OFF today. Suggest 3 options for tonight\'s dinner and tomorrow\'s lunch: (1) a 20-30 minute meal a non-cook can make, (2) an order-in idea that fits the budget, (3) the simplest pantry-only meal.'
    : 'The cook makes ONE meal tonight that covers dinner tonight and lunch tomorrow. Each option is a full Indian combo: one sabzi (dry or gravy) + one dal + rice and/or roti. Suggest 3 combos.';
  const { options } = await askJSON(`You plan meals for an Indian household in Sharjah, UAE. Today is ${weekday()} ${today()}.
${task}

Family profiles: ${JSON.stringify(profiles(ctx))}
Pantry: ${pantryList(ctx)}
Dishes in the last ${ctx.settings.NO_REPEAT_DAYS || 14} days: ${JSON.stringify(recent)}
Ratings: ${ratings.join('; ') || 'none yet'}
Budget this week: AED ${b.spent} spent of ${b.limit}
Equipment: ${ctx.settings.EQUIPMENT}
Always at home (never count as missing): ${ctx.settings.ALWAYS_STOCKED}
${headcount(ctx)}

Rules:
- Every option must suit EVERY person at the table. Allergies are absolute: never include an allergen or anything made from it. Respect each diet, any no-meat day that matches today, and each person's diet_plan (foods to avoid or limit, portions). If a diet is "not set yet", keep that person's variant vegetarian.
- Prefer one base that everyone eats as is. Use variants or portion notes only when a diet or diet plan truly needs it.
- The cook's total time for the whole combo (prep + cooking, pressure cooker time included) must be at most ${max} minutes; aim for about ${Math.round(max * 0.75)}.
- When diets differ, use one shared base with variants (e.g. the same gravy with paneer for some and chicken for others).
- It must reheat well for tomorrow's lunch. Nothing that goes soggy or must be eaten fresh. People with lunch "tiffin" or "varies" may pack it: the sabzi must travel without leaking and reheat in an office microwave; the dal is packed separately.
- On international days the main can be international, paired with a sensible side instead of dal (e.g. soup).
- Only the listed equipment. Nothing that needs an oven.
- Never repeat a recent dish. At most ${ctx.settings.INTERNATIONAL_MAX_PER_WEEK || 2} international dishes in any 7 days (count the recent ones); adapt them to Indian taste.
- Use pantry items first. If the budget is near the limit, prefer options with few items to buy.
- Lean towards highly rated dishes and away from low-rated patterns.
${carry ? `- Option 1 must be "${carry}", moved from yesterday because the cook was off.` : ''}
${extra}
Return JSON: {"options":[{"name":"sabzi + dal + rice/roti, e.g. Bhindi masala + Dal tadka + Roti","cuisine":"","international":false,"summary":"one short line: what everyone eats, plus any variant or portion note","missing_items":0,"est_cost_aed":0,"cook_minutes":0}]} with exactly 3 options.`);
  return options.slice(0, 3);
}

async function makePlan(ctx, winner, mode) {
  const plan = await askJSON(`Write today's cooking plan for an Indian household in Sharjah, UAE.
Dish chosen by vote: ${JSON.stringify(winner)}
${mode === 'off'
    ? 'The cook is off: a family member makes it, or it is ordered in. If it is ordered in, return no ingredients and put ordering tips in the steps.'
    : 'The cook makes the full combo tonight (sabzi, dal, rice and/or roti). It must cover dinner tonight and lunch tomorrow.'}
Family (allergies are absolute): ${JSON.stringify(profiles(ctx))}
${headcount(ctx)}
Equipment: ${ctx.settings.EQUIPMENT}
Always at home (never list as missing): ${ctx.settings.ALWAYS_STOCKED}
Pantry: ${pantryList(ctx)}

Return JSON:
{"recipe":{"total_minutes":0,"variants_en":"","variants_hi":"","ingredients":[{"item":"","qty":0,"unit":""}],"steps_en":[""],"steps_hi":[""]},
 "missing":[{"item":"","qty":0,"unit":""}]}
Rules:
- For any ingredient already in the pantry, use exactly the pantry's item name and unit.
- "missing" lists only what the pantry lacks or does not have enough of.
- Respect each person's diet_plan through portion notes in variants_en and variants_hi (e.g. "Asha: 1 roti, no rice").
- The whole combo must be done in ${maxMinutes(ctx)} minutes or less. Put the total time in recipe.total_minutes.
- Steps cover every part of the combo in a sensible order (e.g. dal in the pressure cooker while the sabzi cooks), short and practical for a home cook. If some will pack lunch, add a last step on packing. Hindi fields in Devanagari.`);
  const hits = allergyHits(ctx.family, plan.recipe?.ingredients);
  if (hits.length) plan.recipe.warning = 'Check allergies before cooking: ' + hits.join(', ');
  return plan;
}

const BILL_PROMPT = `Read this grocery bill from the UAE. Return JSON:
{"store":"","total":0,"items":[{"item":"","qty":0,"unit":"g|kg|ml|l|pcs|pack","category":"staple|fresh","price":0}]}
- item: plain English grocery name, singular (e.g. "onion", "toor dal", "chicken breast").
- Convert pack sizes into qty and unit (2 x 1kg atta = qty 2, unit kg).
- staple = long-life items (atta, rice, dal, oil, ghee, spices, sugar, tea, salt). Everything else is fresh.
- Skip non-food items. price is the line total in AED.`;

// ---------- scheduled steps ----------

export async function runVote() {
  const ctx = await load();
  if (!live(ctx)) return { skipped: 'not live' };
  const yest = ctx.days.find(d => d.date === today(-1));
  if (yest?.status === 'decided') await markCooked(ctx, yest); // nobody tapped "cooked" yesterday
  const date = today();
  const day = ctx.days.find(d => d.date === date);
  if (day && day.status !== 'off') return { skipped: day.status === 'skip' ? 'no cooking today' : 'already ran today' };
  const mode = modeFor(ctx);
  const prev = ctx.days.find(d => d.date === today(-1));
  const carry = mode === 'cook' && prev?.status === 'postponed' ? J(prev.winner, {}).name : null;
  const options = await makeOptions(ctx, mode, carry);
  const row = { date, mode, status: 'voting', options, winner: '', recipe: '', missing: '', note: '' };
  day ? await S.update('Days', day._row, row) : await S.append('Days', row);
  await tell(ctx, ctx.family, mode === 'off' ? 'Cook is off today, pick a plan' : 'Today\'s menu vote',
    options.map((o, i) => `${i + 1}. ${o.name}`).join('  ') + '. Vote before 1pm.');
  return { date, mode, options };
}

export async function runRemind() {
  const ctx = await load();
  const day = ctx.days.find(d => d.date === today());
  if (!live(ctx) || day?.status !== 'voting') return { skipped: 'no open vote' };
  const voted = new Set(ctx.votes.filter(v => v.date === day.date).map(v => v.member));
  const late = ctx.family.filter(m => !voted.has(m.name));
  await tell(ctx, late, 'Reminder: vote for today\'s menu', 'Voting closes at 1pm.');
  return { reminded: names(late) };
}

export async function runClose() {
  const ctx = await load();
  const day = ctx.days.find(d => d.date === today());
  if (!live(ctx) || day?.status !== 'voting') return { skipped: 'no open vote' };
  const { winner, tally } = pickWinner(J(day.options, []), ctx.votes.filter(v => v.date === day.date));

  if (day.note === 'cook_off' || day.note === 'skip') {
    await S.update('Days', day._row, { ...day, status: 'postponed', winner });
    await tell(ctx, ctx.family, day.note === 'skip' ? 'No cooking today' : 'Cook is off today', `${winner.name} won the vote and moves to tomorrow.`);
    return { postponed: winner.name };
  }

  const plan = await makePlan(ctx, winner, day.mode);
  const missing = plan.missing || [];
  await S.update('Days', day._row, { ...day, status: 'decided', winner, recipe: plan.recipe, missing });
  const warn = plan.recipe.warning ? ' ' + plan.recipe.warning : '';
  await tell(ctx, ctx.family, `Today: ${winner.name}`, (missing.length ? `${missing.length} items to buy. Tap "I am buying" so only one person orders.` : 'Everything is at home.') + ' Share the recipe with the cook from the app.' + warn);
  return { winner: winner.name, tally };
}

// ---------- actions from the app (member = the person using the phone) ----------

const fail = msg => { throw Object.assign(new Error(msg), { status: 400 }); };
const who = (ctx, name) => ctx.members.find(m => m.name === name) || fail('Choose who you are first.');

export async function vote(ctx, name, n) {
  const m = who(ctx, name);
  const day = ctx.days.find(d => d.date === today());
  if (m.role === 'cook') fail('Only the family votes. The recipe comes to you at 1pm.');
  if (day?.status !== 'voting') fail('There is no open vote right now. The next one is at 12:00.');
  if (![1, 2, 3].includes(+n)) fail('Pick option 1, 2 or 3.');
  await S.append('Votes', { date: day.date, member: m.name, option: +n, at: new Date().toISOString() });
}

export async function cooked(ctx) {
  const d = [today(), today(-1)].map(x => ctx.days.find(y => y.date === x)).find(x => x?.status === 'decided');
  if (!d) fail('There is no decided dish to mark as cooked.');
  return markCooked(ctx, d);
}

async function markCooked(ctx, d) {
  const changed = deduct(ctx.pantry, J(d.recipe, {}).ingredients);
  for (const p of changed) await S.update('Pantry', p._row, p);
  await S.update('Days', d._row, { ...d, status: 'cooked' });
  return { pantryUpdated: changed.length };
}

export async function rate(ctx, name, n, comment = '') {
  const m = who(ctx, name);
  const last = [...ctx.days].reverse().find(d => d.status === 'cooked') || fail('Nothing to rate yet.');
  if (!(n >= 1 && n <= 5)) fail('Rating must be 1 to 5.');
  await S.append('Feedback', { date: last.date, dish: J(last.winner, {}).name, member: m.name, rating: +n, comment: String(comment).slice(0, 200) });
}

// reason "cook_off": off-day options instead of a cooked meal. reason "skip": family eats out, no vote at all.
export async function skipToday(ctx, name, reason) {
  who(ctx, name);
  if (!['cook_off', 'skip'].includes(reason)) fail('Unknown reason.');
  const date = today();
  const day = ctx.days.find(d => d.date === date);
  const title = reason === 'skip' ? 'No cooking today' : 'Cook is off today';
  if (!day) await S.append('Days', { date, mode: 'off', status: reason === 'skip' ? 'skip' : 'off' });
  else if (day.status === 'voting') await S.update('Days', day._row, { ...day, note: reason });
  else if (day.status === 'decided') {
    await S.update('Days', day._row, { ...day, status: 'postponed' });
    await tell(ctx, ctx.family, title, `${J(day.winner, {}).name} moves to tomorrow. Groceries bought today will be used then.`);
  } else fail('Today is already marked.');
}

export async function claimBuying(ctx, name, release) {
  const m = who(ctx, name);
  const date = today();
  const day = ctx.days.find(d => d.date === date);
  if (day?.status !== 'decided') fail('There is no shopping list for today yet.');
  const current = buyer(ctx.changes, date);
  if (release) {
    if (current !== m.name) fail('Only the person buying can hand it back.');
    await S.append('Changes', { date, member: m.name, type: 'release', count: 0 });
    return tell(ctx, ctx.family.filter(x => x.name !== m.name), 'Shopping is free again', `${m.name} cannot buy today's items. Can someone else?`);
  }
  if (current) fail(current === m.name ? 'You are already buying.' : `${current} is already buying.`);
  await S.append('Changes', { date, member: m.name, type: 'buying', count: 0 });
  await tell(ctx, ctx.family.filter(x => x.name !== m.name), `${m.name} is buying today's items`, 'No need to order them.');
}

export async function setTonight(ctx, name, type, count = 0) {
  const m = who(ctx, name);
  if (!['away', 'home', 'guests'].includes(type)) fail('Unknown change.');
  if (type !== 'guests' && m.role === 'cook') fail('Only family members can mark themselves away.');
  if (type === 'guests' && !(count >= 0 && count <= 30)) fail('Guests must be 0 to 30.');
  await S.append('Changes', { date: today(), member: m.name, type, count: +count || 0 });
}

export async function addPantryBulk(ctx, name, items) {
  who(ctx, name);
  const clean = (items || []).filter(i => i.item && +i.qty > 0).slice(0, 200);
  if (!clean.length) fail('Nothing to add. Use one item per line, like: toor dal 2 kg');
  const { updates, adds } = mergePantry(ctx.pantry, clean, 'app');
  for (const p of updates) await S.update('Pantry', p._row, p);
  if (adds.length) await S.append('Pantry', adds);
  return { added: adds.length, updated: updates.length };
}

export async function addSpend(ctx, name, total, category, note = '') {
  who(ctx, name);
  if (!(+total > 0 && +total < 5000)) fail('Enter an amount in AED.');
  const fresh = category === 'staple' ? 0 : +total, staples = category === 'staple' ? +total : 0;
  await S.append('Purchases', { date: today(), store: String(note).slice(0, 60) || 'No bill', total: +total, staples, fresh, items: [] });
}

export async function addBill(ctx, name, image) {
  who(ctx, name);
  if (!/^image\/(jpeg|png|webp)$/.test(image?.mime) || !image.data) fail('Send a JPEG, PNG or WEBP photo of the bill.');
  const bill = await askJSON(BILL_PROMPT, image);
  const items = bill.items || [];
  if (!items.length) fail('No food items found on that photo. Try a clearer, straight photo of the bill.');
  const { updates, adds } = mergePantry(ctx.pantry, items);
  for (const p of updates) await S.update('Pantry', p._row, p);
  if (adds.length) await S.append('Pantry', adds);
  const sum = cat => items.filter(i => i.category === cat).reduce((a, i) => a + (+i.price || 0), 0).toFixed(2);
  await S.append('Purchases', { date: today(), store: bill.store, total: bill.total, staples: sum('staple'), fresh: sum('fresh'), items });
  return { store: bill.store, total: bill.total, count: items.length };
}

export async function subscribe(ctx, name, subscription) {
  who(ctx, name);
  if (!subscription?.endpoint?.startsWith('https://')) fail('That notification subscription is not valid.');
  const same = ctx.subs.find(s => J(s.subscription, {}).endpoint === subscription.endpoint);
  const row = { member: name, subscription, created_at: new Date().toISOString(), status: '' };
  same ? await S.update('Subscriptions', same._row, row) : await S.append('Subscriptions', row);
}

export async function chat(ctx, name, messages) {
  const m = who(ctx, name);
  const history = (Array.isArray(messages) ? messages : []).slice(-12)
    .filter(x => (x?.role === 'user' || x?.role === 'model') && typeof x.text === 'string')
    .map(x => ({ role: x.role, text: x.text.slice(0, 4000) }));
  if (history.at(-1)?.role !== 'user') fail('Type a question.');
  const day = ctx.days.find(d => d.date === today());
  const system = `You are Rasoi, the food assistant of an Indian family living in Sharjah, UAE. You are talking to ${m.name}${m.role === 'cook' ? ', the family cook' : ''}.
Family (allergies are absolute; follow each diet_plan): ${JSON.stringify(profiles(ctx))}
Pantry: ${pantryList(ctx)}
Always at home: ${ctx.settings.ALWAYS_STOCKED}
Kitchen: ${ctx.settings.EQUIPMENT}. The cook spends at most ${maxMinutes(ctx)} minutes on a meal.
Today's meal: ${day?.winner ? J(day.winner, {}).name : 'not decided yet'}

Answer questions about food, recipes, cooking, nutrition, groceries and the family's diet plans.
- Short and practical. Recipes as a short ingredient list and numbered steps, metric units, Indian names where common.
- Never suggest anything that breaks someone's allergy; if asked, explain why not and give a safe swap.
- When a suggestion is for the whole family, make sure it suits everyone.
- For medical questions, give general guidance and suggest checking with their doctor or dietitian.
- Do not write any web addresses yourself.
- If a video would help (a recipe or technique), end with one last line exactly like: YOUTUBE: <short search query>`;
  const r = await askText(system, history, true);
  let text = r.text, youtube = null;
  const yt = text.match(/^\s*YOUTUBE:\s*(.+?)\s*$/m);
  if (yt) { youtube = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(yt[1]); text = text.replace(yt[0], '').trim(); }
  return { text, sources: r.sources, youtube };
}

export async function setDietPlan(ctx, name, memberName, { file, text, remove } = {}) {
  who(ctx, name);
  const m = ctx.members.find(x => x.name === memberName) || fail('Unknown family member.');
  if (remove) return S.update('Members', m._row, { ...m, diet_plan: '', diet_plan_updated: '' });
  if (file && !/^(application\/pdf|image\/(jpeg|png|webp))$/.test(file.mime || '')) fail('Upload a PDF or a photo of the diet plan.');
  if (!file && !String(text || '').trim()) fail('Upload a file or paste the diet plan.');
  const { summary } = await askJSON(`This is ${m.name}'s diet plan. Summarise it for planning shared Indian family dinners and next-day lunches.
Keep: daily targets if given (calories, protein, carbs); foods to include; foods to limit; foods to avoid; portion guidance (rotis, rice, oil, ghee); meal timing; any medical note the cook must respect.
Short plain lines, at most 1200 characters. Return JSON {"summary":""}.${file ? '' : '\n\nPlan:\n' + String(text).slice(0, 20000)}`, file);
  if (!summary) fail('Could not read a diet plan from that. Try a clearer file or paste the text.');
  await S.update('Members', m._row, { ...m, diet_plan: summary.slice(0, 2000), diet_plan_updated: today() });
  return { summary };
}

export const testPush = (ctx, name) => tell(ctx, [who(ctx, name)], 'Rasoi notifications are on', 'You will get the menu vote here at 12:00.');
