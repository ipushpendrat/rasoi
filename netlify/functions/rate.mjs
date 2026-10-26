// Scheduled: 21:00 UAE (17:00 UTC). Reminds anyone who has not rated tonight's dinner.
import { runRateReminder } from '../../lib/agent.js';

export default async () => {
  try { console.log(JSON.stringify(await runRateReminder())); }
  catch (e) { console.error(e); }
};

export const config = { schedule: '0 17 * * *' };
