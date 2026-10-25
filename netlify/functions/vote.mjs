// Scheduled: 12:00, 12:15, 12:30 UAE (08:xx UTC). Later runs skip once the vote is out, so they are only a backup if Gemini was busy.
// Base: 0 8 * * * UTC (UAE is UTC+4). Use "Run now" in the Netlify Functions tab to test.
import { runVote } from '../../lib/agent.js';

export default async () => {
  try { console.log(JSON.stringify(await runVote())); }
  catch (e) { console.error(e); }
};

export const config = { schedule: '0,15,30 8 * * *' };
