// Scheduled: 0 9 * * * UTC (UAE is UTC+4). Use "Run now" in the Netlify Functions tab to test.
import { runClose } from '../../lib/agent.js';

export default async () => {
  try { console.log(JSON.stringify(await runClose())); }
  catch (e) { console.error(e); }
};

export const config = { schedule: '0 9 * * *' };
