const DB_NAME = 'iroha-push-keys';
const STORE = 'keys';
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    try {
      const encrypted = event.data.json();
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const key = await new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get('aes');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (!key) throw new Error('missing local key');
      const iv = Uint8Array.from(atob(encrypted.iv), c => c.charCodeAt(0));
      const cipher = Uint8Array.from(atob(encrypted.cipher), c => c.charCodeAt(0));
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
      const message = JSON.parse(new TextDecoder().decode(plain));
      await self.registration.showNotification(message.title || 'いろは帳', {
        body: message.body || '確認する予定があります。',
        icon: '/icon-192.png', badge: '/icon-192.png', data: { url: '/' }
      });
    } catch (error) {
      await self.registration.showNotification('いろは帳', { body: '通知があります。アプリを開いて確認してください。' });
    }
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const client of list) if ('focus' in client) return client.focus();
    return clients.openWindow('/');
  }));
});
