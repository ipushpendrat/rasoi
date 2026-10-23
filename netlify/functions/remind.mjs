// Scheduled: 50 8 * * * UTC (UAE is UTC+4). Use "Run now" in the Netlify Functions tab to test.
import { runRemind } from '../../lib/agent.js';

export default async () => {
  try { console.log(JSON.stringify(await runRemind())); }
  catch (e) { console.error(e); }
};

export const config = { schedule: '50 8 * * *' };
