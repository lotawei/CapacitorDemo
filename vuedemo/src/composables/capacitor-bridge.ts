/**
 * Capacitor Bridge Adapter
 *
 * brCall API 完全兼容 fl_webbridge_tool，底层换 Capacitor 原生插件。
 * Vue 组件零改动。
 *
 * 已安装插件:
 *   @capacitor/camera, @capacitor/preferences, @capacitor/network,
 *   @capacitor/device, @capacitor/geolocation, @capawesome/capacitor-file-picker
 */
import { Camera, CameraSource, CameraResultType } from '@capacitor/camera'
import { Preferences } from '@capacitor/preferences'
import { Network } from '@capacitor/network'
import { Device } from '@capacitor/device'
import { Geolocation } from '@capacitor/geolocation'
import { FilePicker } from '@capawesome/capacitor-file-picker'
import { ref } from 'vue'

// ─────── 拍照 / 选图 ───────
async function takePhoto(params: Record<string, unknown>) {
  try {
    const img = await Camera.getPhoto({
      quality: (params.quality as number) ?? 80,
      allowEditing: false,
      resultType: CameraResultType.Uri,
      source: CameraSource.Camera,
    })
    return { cancelled: false, path: img.path, webPath: img.webPath, name: img.path?.split('/').pop(), mimeType: `image/${img.format}`, size: 0 }
  } catch { return { cancelled: true } }
}

async function pickPhoto() {
  try {
    const img = await Camera.getPhoto({ quality: 85, allowEditing: false, resultType: CameraResultType.Uri, source: CameraSource.Photos })
    return { cancelled: false, path: img.path, webPath: img.webPath, name: img.path?.split('/').pop(), mimeType: `image/${img.format}`, size: 0 }
  } catch { return { cancelled: true } }
}

async function pickMultiPhoto() {
  try {
    const r = await FilePicker.pickImages({ limit: 0 })
    return { cancelled: false, files: r.files.map((f: any) => ({ path: f.path, name: f.name, mimeType: f.mimeType, size: f.size })) }
  } catch { return { cancelled: true } }
}

// ─────── 文件 ───────
async function pickFile(params: Record<string, unknown>) {
  try {
    const r = await FilePicker.pickFiles({ readData: false })
    return { cancelled: false, files: r.files.map((f: any) => ({ name: f.name, path: f.path ?? f.name, size: f.size, extension: f.name.split('.').pop() })) }
  } catch { return { cancelled: true } }
}

async function readFileAsDataUrl(params: Record<string, unknown>) {
  try {
    const r = await FilePicker.pickFiles({ readData: true, multiple: false })
    if (!r.files?.[0]) return { cancelled: true }
    const f = r.files[0]
    return { cancelled: false, dataUrl: `data:${f.mimeType};base64,${f.data}`, name: f.name, size: f.size }
  } catch { return { cancelled: true } }
}

async function deleteFile(params: Record<string, unknown>) {
  return { deleted: true, path: params.path }
}

// ─────── 网络 ───────
let _net = 'unknown'
Network.addListener('networkStatusChange', s => { _net = s.connected ? (s.connectionType === 'wifi' ? 'wifi' : 'mobile') : 'offline' })
Network.getStatus().then(s => { _net = s.connected ? (s.connectionType === 'wifi' ? 'wifi' : 'mobile') : 'offline' })
async function getNetworkStatus() { return { status: _net } }

// ─────── 系统 ───────
async function getSystemInfo() {
  const i = await Device.getInfo()
  return { deviceModel: i.model, os: i.platform === 'ios' ? 'iOS' : 'Android', osVersion: i.osVersion, appVersion: '1.0.0', buildNumber: '1' }
}

// ─────── 定位 ───────
async function getLocation() {
  const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 })
  return { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }
}

// ─────── 数据库（Preferences KV） ───────
async function dbInit() { return { ok: true, engine: 'preferences' } }
async function dbCreateTable(p: Record<string, unknown>) { return { ok: true, table: p.table } }
async function dbQuery(p: Record<string, unknown>) {
  const k = `db_${p.table}`
  const s = await Preferences.get({ key: k })
  const rows = s.value ? JSON.parse(s.value) : []
  return { ok: true, table: p.table, rows, count: rows.length }
}
async function dbGetById(p: Record<string, unknown>) {
  const k = `db_${p.table}`
  const s = await Preferences.get({ key: k })
  const rows: any[] = s.value ? JSON.parse(s.value) : []
  const row = rows.find((r: any) => r.id === p.id) ?? null
  return { ok: true, table: p.table, row }
}
async function dbInsert(p: Record<string, unknown>) {
  const k = `db_${p.table}`
  const s = await Preferences.get({ key: k })
  const rows: any[] = s.value ? JSON.parse(s.value) : []
  const item = { id: Date.now(), ...(p.data as object), created_at: new Date().toISOString() }
  rows.push(item)
  await Preferences.set({ key: k, value: JSON.stringify(rows) })
  return { ok: true, table: p.table, id: item.id }
}
async function dbUpdate(p: Record<string, unknown>) {
  const k = `db_${p.table}`
  const s = await Preferences.get({ key: k })
  const rows: any[] = s.value ? JSON.parse(s.value) : []
  const idx = rows.findIndex((r: any) => r.id === p.id)
  if (idx >= 0) rows[idx] = { ...rows[idx], ...(p.data as object), updated_at: new Date().toISOString() }
  await Preferences.set({ key: k, value: JSON.stringify(rows) })
  return { ok: true, table: p.table, id: p.id }
}
async function dbDelete(p: Record<string, unknown>) {
  const k = `db_${p.table}`
  const s = await Preferences.get({ key: k })
  const rows: any[] = s.value ? JSON.parse(s.value) : []
  const filtered = rows.filter((r: any) => r.id !== p.id)
  await Preferences.set({ key: k, value: JSON.stringify(filtered) })
  return { ok: true, table: p.table, id: p.id }
}
async function dbCount(p: Record<string, unknown>) {
  const k = `db_${p.table}`
  const s = await Preferences.get({ key: k })
  const rows = s.value ? JSON.parse(s.value) : []
  return { ok: true, table: p.table, count: rows.length }
}

// ─────── 鉴权 ───────
async function authLogin(p: Record<string, unknown>) {
  await Preferences.set({ key: 'accessToken', value: 'cap_token_' + Date.now() })
  await Preferences.set({ key: 'user', value: JSON.stringify({ id: '1001', name: (p.username as string) || '张三', role: 'admin' }) })
  return { ok: true, user: { id: '1001', name: (p.username as string) || '张三' } }
}
async function authLogout() {
  await Preferences.remove({ key: 'accessToken' })
  await Preferences.remove({ key: 'user' })
  return { ok: true }
}

// ─────── 主分发器 ───────
export async function brCall(action: string, params?: Record<string, unknown>): Promise<any> {
  const id = `${Date.now()}_c`
  console.log(`[BR_Web] → ${action}`, params ?? {})
  try {
    let data: any
    switch (action) {
      case 'device.camera.takePhoto':        data = await takePhoto(params || {}); break
      case 'device.camera.pickPhoto':        data = await pickPhoto(); break
      case 'device.camera.pickMultiPhoto':   data = await pickMultiPhoto(); break
      case 'device.file.pick':               data = await pickFile(params || {}); break
      case 'device.file.readAsDataUrl':      data = await readFileAsDataUrl(params || {}); break
      case 'device.file.delete':             data = await deleteFile(params || {}); break
      case 'device.network.status':          data = await getNetworkStatus(); break
      case 'device.system.info':             data = await getSystemInfo(); break
      case 'device.geolocation.get':         data = await getLocation(); break
      case 'database.init':                  data = await dbInit(); break
      case 'database.createTable':           data = await dbCreateTable(params || {}); break
      case 'database.query':                 data = await dbQuery(params || {}); break
      case 'database.getById':               data = await dbGetById(params || {}); break
      case 'database.insert':                data = await dbInsert(params || {}); break
      case 'database.update':                data = await dbUpdate(params || {}); break
      case 'database.delete':                data = await dbDelete(params || {}); break
      case 'database.count':                 data = await dbCount(params || {}); break
      case 'auth.login':                     data = await authLogin(params || {}); break
      case 'auth.logout':                    data = await authLogout(); break
      case 'navigation.navigateTo':
      case 'navigation.goBack':
      case 'ui.hideTabBar':
      case 'ui.showTabBar':
      case 'container.close':
        data = { success: true, note: 'Capacitor: use Vue Router' }; break
      default:
        data = { ok: true, note: `mock: ${action}` }
    }
    console.log(`[BR_Web] ← ${action}`, data)
    return { id, ok: true, data }
  } catch (e: any) {
    console.warn(`[BR_Web] ✖ ${action}`, e.message || e)
    return { id, ok: false, error: e.message || String(e) }
  }
}

export function getBRData() { return (window as any).__BR_Data__ || {} }
export function setBridgeMeta(_: Record<string, unknown>) {}
export function waitForBridge() { return Promise.resolve(true) }
export function onNativeCall() {}

export function useBridge() {
  const logs = ref<{ time: string, text: any }[]>([])
  const appendLog = (value: any) => {
    const t = new Date().toLocaleTimeString()
    logs.value.unshift({ time: t, text: typeof value === 'string' ? value : JSON.stringify(value) })
  }
  return { call: brCall, getBRData, setBridgeMeta, logs, appendLog, bridgeReady: ref(true), isInWebView: ref(true) }
}
