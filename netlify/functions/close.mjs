// Scheduled: 13:00, 13:10, 13:20 UAE (09:xx UTC). Later runs skip once the vote is closed, so they are only a backup if Gemini was busy.
// Base: 0 9 * * * UTC (UAE is UTC+4). Use "Run now" in the Netlify Functions tab to test.
import { runClose } from '../../lib/agent.js';

export default async () => {
  try { console.log(JSON.stringify(await runClose())); }
  catch (e) { console.error(e); }
};

export const config = { schedule: '0,10,20 9 * * *' };
