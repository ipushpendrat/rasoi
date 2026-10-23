// Web Push notifications to the installed app (free, no third party account).
import webpush from 'web-push';
import * as S from './sheets.js';

let ready = false;
const J = s => { try { return JSON.parse(s); } catch { return null; } };

export async function notify(subs, names, title, body, url = '/') {
  if (!ready) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:rasoi@example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    ready = true;
  }
  const targets = subs.filter(s => !s.status && names.includes(s.member) && J(s.subscription));
  await Promise.all(targets.map(async s => {
    try { await webpush.sendNotification(J(s.subscription), JSON.stringify({ title, body, url })); }
    catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await S.update('Subscriptions', s._row, { ...s, status: 'expired' });
      else console.error('Push failed for', s.member, e.statusCode, e.body);
    }
  }));
  return targets.length;
}
