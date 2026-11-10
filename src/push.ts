export type Notice = { id: string; date: string; time: string }
export type PushJob = { id: string; at: string; payload: { title: string; body: string } }
const API = '/api'
const CLIENT_KEY = 'iroha-client-id'
const DB_NAME = 'iroha-push-keys'
const STORE = 'keys'

function clientId() {
  let id = localStorage.getItem(CLIENT_KEY)
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(CLIENT_KEY, id) }
  return id
}
function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function getKey(): Promise<CryptoKey> {
  const db = await openKeyDb()
  const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get('aes')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  if (existing) return existing
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(key, 'aes')
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
  })
  return key
}
async function encrypt(payload: { title: string; body: string }) {
  const key = await getKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes)
  return { iv: btoa(String.fromCharCode(...iv)), cipher: btoa(String.fromCharCode(...new Uint8Array(cipher))) }
}
export async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('このブラウザはWeb Pushに対応していません。')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('通知が許可されませんでした。ブラウザの設定を確認してください。')
  const config = await fetch(`${API}/public-key`).then(r => { if (!r.ok) throw new Error('通知サーバーの設定がまだ完了していません。'); return r.json() })
  const registration = await navigator.serviceWorker.register('/sw.js')
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(config.publicKey) })
  const response = await fetch(`${API}/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: clientId(), subscription: subscription.toJSON() }) })
  if (!response.ok) throw new Error('通知の登録に失敗しました。')
  await getKey()
  localStorage.setItem('iroha-push-enabled', '1')
  return true
}
export async function syncPushJobs(jobs: PushJob[]) {
  if (Notification.permission !== 'granted') return
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return
  const encryptedJobs = await Promise.all(jobs.map(async job => ({ id: job.id, at: job.at, encrypted: await encrypt(job.payload) })))
  await fetch(`${API}/schedule`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: clientId(), jobs: encryptedJobs }) })
}
export function hasPushSubscription() { return localStorage.getItem('iroha-push-enabled') === '1' && typeof Notification !== 'undefined' && Notification.permission === 'granted' }
function urlBase64ToBytes(base64: string) {
  const padding = '='.repeat((4 - base64.length % 4) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}
