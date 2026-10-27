// Run: npm run check   (no network; tests the logic that decides votes, pantry numbers and allergy flags)
import assert from 'node:assert/strict';
import { pickWinner, deduct, mergePantry, allergyHits, tonight, buyer, portionTotals } from '../lib/agent.js';

const opts = [{ name: 'A', missing_items: 5 }, { name: 'B', missing_items: 1 }, { name: 'C', missing_items: 3 }];
assert.equal(pickWinner(opts, [{ member: 'x', option: '1' }, { member: 'y', option: '1' }, { member: 'z', option: '3' }]).winner.name, 'A');
assert.equal(pickWinner(opts, []).winner.name, 'B', 'no votes: fewest purchases wins');
assert.equal(pickWinner(opts, [{ member: 'x', option: '1' }, { member: 'y', option: '3' }]).winner.name, 'C', 'tie: fewest purchases wins');
assert.equal(pickWinner(opts, [{ member: 'x', option: '1' }, { member: 'x', option: '3' }]).tally.join(), '0,0,1', 'changed vote counts once');

const pantry = [{ _row: 2, item: 'Onions', qty: '1', unit: 'kg' }, { _row: 3, item: 'rice', qty: '5', unit: 'kg' }];
const changed = deduct(pantry, [{ item: 'onion', qty: 0.3, unit: 'kg' }, { item: 'rice', qty: 9, unit: 'kg' }, { item: 'salt', qty: 1, unit: 'tsp' }]);
assert.equal(changed.length, 2);
assert.equal(pantry[0].qty, '0.7');
assert.equal(pantry[1].qty, '0', 'never below zero');

const { updates, adds } = mergePantry(pantry, [{ item: 'onion', qty: 2, unit: 'kg' }, { item: 'paneer', qty: 200, unit: 'g', category: 'fresh' }, { item: 'paneer', qty: 200, unit: 'g' }]);
assert.equal(pantry[0].qty, '2.7');
assert.equal(updates.length, 1);
assert.equal(adds.length, 1);
assert.equal(adds[0].qty, '400', 'same item twice on one bill merges');

const people = [{ name: 'Asha', allergies: 'Peanuts, prawns' }, { name: 'Ravi', allergies: 'none' }];
assert.deepEqual(allergyHits(people, [{ item: 'peanut oil' }, { item: 'onion' }, { item: 'prawn' }]), ['Asha: peanut oil', 'Asha: prawn']);
assert.deepEqual(allergyHits(people, [{ item: 'paneer' }]), []);

const fam = [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }];
const ctx = (changes) => ({ family: fam, changes });
assert.equal(tonight(ctx([]), 'd').portions, 8, '4 at dinner + 4 lunch');
const t = tonight(ctx([
  { date: 'd', member: 'A', type: 'away' }, { date: 'd', member: 'B', type: 'away' }, { date: 'd', member: 'B', type: 'home' },
  { date: 'd', member: 'A', type: 'guests', count: '5' }, { date: 'd', member: 'C', type: 'guests', count: '2' },
  { date: 'x', member: 'C', type: 'away' },
]), 'd');
assert.deepEqual(t.away, ['A'], 'B changed back to home; other dates ignored');
assert.equal(t.guests, 2, 'latest guests number wins');
assert.equal(t.portions, 3 + 2 + 4);

const ch = [{ date: 'd', member: 'A', type: 'buying' }, { date: 'd', member: 'B', type: 'buying' }];
assert.equal(buyer(ch, 'd'), 'A', 'first claim wins');
assert.equal(buyer([...ch, { date: 'd', member: 'B', type: 'release' }], 'd'), 'A', 'only the buyer can release');
assert.equal(buyer([...ch, { date: 'd', member: 'A', type: 'release' }], 'd'), null);
assert.equal(buyer([...ch, { date: 'd', member: 'A', type: 'release' }, { date: 'd', member: 'B', type: 'buying' }], 'd'), 'B');
assert.equal(buyer(ch, 'other'), null);

const pctx = { family: fam, changes: [
  { date: 'd', member: 'A', type: 'portion:roti:dinner', count: '4' }, { date: 'd', member: 'A', type: 'portion:roti:dinner', count: '3' },
  { date: 'd', member: 'B', type: 'portion:roti:lunch', count: '0' }, { date: 'd', member: 'C', type: 'away' }, { date: 'd', member: 'D', type: 'guests', count: '1' } ] };
const [roti] = portionTotals(pctx, [{ item: 'Rotis', per_person: 2 }], 'd');
assert.equal(roti.by.A.dinner, 3, 'latest count wins');
assert.equal(roti.by.C.dinner, 0, 'away person eats no dinner');
assert.equal(roti.dinner, 3 + 2 + 0 + 2 + 2, 'A 3, B 2, C away, D 2, plus 1 guest at 2');
assert.equal(roti.lunch, 2 + 0 + 2 + 2, 'B wants none for lunch');

console.log('All checks passed');
