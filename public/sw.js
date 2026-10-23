// Shows push notifications and opens the app when one is tapped.
self.addEventListener('push', e => {
  const d = e.data ? e.data.json() : { title: 'Rasoi', body: '' };
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(list => {
    const open = list.find(c => 'focus' in c);
    return open ? open.focus() : clients.openWindow(e.notification.data.url);
  }));
});
