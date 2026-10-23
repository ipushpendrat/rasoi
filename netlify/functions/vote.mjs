// Scheduled: 0 8 * * * UTC (UAE is UTC+4). Use "Run now" in the Netlify Functions tab to test.
import { runVote } from '../../lib/agent.js';

export default async () => {
  try { console.log(JSON.stringify(await runVote())); }
  catch (e) { console.error(e); }
};

export const config = { schedule: '0 8 * * *' };
