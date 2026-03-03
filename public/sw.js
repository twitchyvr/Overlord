'use strict';
// OVERLORD Service Worker — Web Push Notifications
// Handles push events from the server and shows OS-level notifications
// that appear on lock screens, even when the tab/app is not active.

const SW_VERSION = 'overlord-sw-v1';

// ── Push received from server ─────────────────────────────────────────────
self.addEventListener('push', event => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }

    const title   = data.title   || 'OVERLORD';
    const body    = data.body    || 'Action required';
    const tag     = data.tag     || 'overlord-push';
    const url     = data.url     || self.registration.scope;
    const urgent  = !!data.requireInteraction;

    const options = {
        body,
        tag,
        icon:               '/favicon.ico',
        data:               { url },
        requireInteraction: urgent,   // stays on screen until dismissed when true
        vibrate:            urgent ? [300, 100, 300, 100, 300] : [200, 100, 200],
        // Action buttons (supported on Android Chrome, desktop Chrome/Edge)
        actions: urgent
            ? [
                { action: 'open',    title: '📂 Open'   },
                { action: 'dismiss', title: '✖ Dismiss' }
              ]
            : [
                { action: 'open',    title: '📂 Open'   }
              ]
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

// ── Notification clicked ──────────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
    event.notification.close();

    if (event.action === 'dismiss') return; // user explicitly dismissed

    const targetUrl = (event.notification.data && event.notification.data.url)
        ? event.notification.data.url
        : self.registration.scope;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            // If an OVERLORD tab is already open, focus it
            for (const client of windowClients) {
                if ('focus' in client) {
                    client.focus();
                    return;
                }
            }
            // Otherwise open a new tab
            return clients.openWindow(targetUrl);
        })
    );
});

// ── Push subscription changed (browser rotated keys) ─────────────────────
// Automatically re-subscribes and posts the new subscription to the server
self.addEventListener('pushsubscriptionchange', event => {
    event.waitUntil(
        self.registration.pushManager.subscribe(event.oldSubscription.options)
            .then(sub => {
                // Notify all controlled clients so they can re-register with server
                return clients.matchAll({ type: 'window' }).then(cs => {
                    cs.forEach(c => c.postMessage({ type: 'push_resubscribe', subscription: sub.toJSON() }));
                });
            })
            .catch(() => {}) // silent — user may have revoked permission
    );
});

// ── Install / activate ────────────────────────────────────────────────────
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(clients.claim()));
