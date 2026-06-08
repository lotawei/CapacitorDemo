<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { brCall } from '../composables/capacitor-bridge'

// ─────────── 类型 ───────────
interface Attachment {
  id: number
  name: string
  type: 'image' | 'video'
  localPath: string
  webPath?: string      // capacitor:// URL，WebView 可加载
  uploadStatus: 'pending' | 'uploading' | 'done' | 'failed'
  cdnUrl?: string
  thumbnail?: string
}

interface WorkOrder {
  id?: number
  title: string
  description: string
  status: string
  priority: string
  assignee?: string
  address?: string
  attachments: Attachment[]
}

// ─────────── 状态 ───────────
const orders = ref<WorkOrder[]>([])
const loading = ref(false)
const editing = ref<WorkOrder | null>(null)
const showForm = ref(false)
const statusFilter = ref('')
const networkStatus = ref<'online'|'offline'>('online')
const uploadingIds = ref<Set<number>>(new Set())

const TABLE = 'work_orders'
const UPLOAD_QUEUE_KEY = 'upload_queue'

const filtered = computed(() =>
  statusFilter.value
    ? orders.value.filter(o => o.status === statusFilter.value)
    : orders.value
)

const pendingCount = computed(() =>
  orders.value.reduce((sum, o) =>
    sum + (o.attachments?.filter(a => a.uploadStatus === 'pending' || a.uploadStatus === 'failed').length || 0), 0)
)

// ─────────── 网络监听 ───────────
async function checkNetwork() {
  const r = await brCall('device.network.status')
  const s = r.data?.status ?? 'unknown'
  networkStatus.value = s === 'offline' ? 'offline' : 'online'
  return networkStatus.value
}

let _netTimer: any = null
async function watchNetwork() {
  await checkNetwork()
  _netTimer = setInterval(async () => {
    const prev = networkStatus.value
    await checkNetwork()
    if (prev === 'offline' && networkStatus.value === 'online') {
      console.log('🔄 网络恢复，开始重试上传...')
      await retryAllUploads()
    }
  }, 5000)
}

// ─────────── CRUD ───────────
async function load() {
  loading.value = true
  try {
    const r = await brCall('database.query', { table: TABLE, orderBy: 'id DESC' }) as any
    if (r.ok) orders.value = (r.data?.rows || []).map((o: any) => ({
      ...o,
      attachments: o.attachments || [],
    }))
  } catch (e: any) { console.error(e) }
  finally { loading.value = false }
}

async function save() {
  if (!editing.value) return
  loading.value = true
  try {
    if (editing.value.id) {
      await brCall('database.update', { table: TABLE, id: editing.value.id, data: editing.value })
    } else {
      await brCall('database.insert', { table: TABLE, data: editing.value })
    }
    showForm.value = false
    await load()
    // 保存后触发上传
    if (editing.value.attachments?.length) {
      uploadAttachments(editing.value.attachments.filter(a => a.uploadStatus !== 'done'))
    }
  } finally { loading.value = false }
}

async function remove(id: number) {
  if (!confirm('确定删除这条工单？')) return
  await brCall('database.delete', { table: TABLE, id })
  await load()
}

function create() {
  editing.value = {
    title: '', description: '', status: 'pending', priority: 'medium',
    assignee: '', address: '', attachments: []
  }
  showForm.value = true
}
function edit(o: WorkOrder) {
  editing.value = {
    ...o,
    attachments: o.attachments ? o.attachments.map(a => ({ ...a })) : []
  }
  showForm.value = true
}
function cancel() { showForm.value = false; editing.value = null }

// ─────────── 附件：拍照 & 选图 ───────────
async function takePhoto() {
  const r = await brCall('device.camera.takePhoto', { quality: 80 })
  if (r.data?.cancelled || !r.data?.path) return
  addAttachment(r.data.path, r.data.webPath, r.data.name || 'photo.jpg', 'image')
}

async function pickFromGallery() {
  const r = await brCall('device.camera.pickPhoto')
  if (r.data?.cancelled || !r.data?.path) return
  addAttachment(r.data.path, r.data.webPath, r.data.name || 'photo.jpg', 'image')
}

function addAttachment(localPath: string, webPath: string | undefined, name: string, type: 'image' | 'video') {
  if (!editing.value) return
  const att: Attachment = {
    id: Date.now(),
    name,
    type,
    localPath,
    webPath,
    uploadStatus: 'pending',
    thumbnail: type === 'image' ? (webPath || localPath) : undefined,
  }
  editing.value.attachments.push(att)
}

function removeAttachment(index: number) {
  editing.value?.attachments.splice(index, 1)
}

// ─────────── 模拟上传 ───────────
function mockUpload(att: Attachment): Promise<{ cdnUrl: string }> {
  return new Promise((resolve, reject) => {
    const delay = 800 + Math.random() * 2200 // 0.8~3s
    const willFail = Math.random() < 0.15 // 15% 失败率模拟
    setTimeout(() => {
      if (willFail) {
        reject(new Error('模拟上传失败：服务器错误'))
      } else {
        const fakeCdnUrl = `https://cdn.persagy.com/attachments/${att.id}_${att.name}`
        resolve({ cdnUrl: fakeCdnUrl })
      }
    }, delay)
  })
}

async function uploadAttachments(atts: Attachment[]) {
  const status = await checkNetwork()
  for (const att of atts) {
    if (att.uploadStatus === 'done') continue
    if (status === 'offline') {
      att.uploadStatus = 'pending'
      console.log(`📴 离线: ${att.name} 标记为待上传`)
      continue
    }
    att.uploadStatus = 'uploading'
    uploadingIds.value.add(att.id)
    try {
      const result = await mockUpload(att)
      att.cdnUrl = result.cdnUrl
      att.uploadStatus = 'done'
      console.log(`✅ 上传成功: ${att.name} → ${result.cdnUrl}`)
    } catch (e: any) {
      att.uploadStatus = 'failed'
      console.error(`❌ 上传失败: ${att.name}`, e.message)
    } finally {
      uploadingIds.value.delete(att.id)
    }
  }
  // 上传完成后更新 DB
  if (editing.value?.id) {
    await brCall('database.update', { table: TABLE, id: editing.value.id, data: editing.value })
  }
  await load()
}

async function uploadSingleAttachment(att: Attachment) {
  if (!editing.value?.id) return
  await uploadAttachments([att])
}

async function retryAllUploads() {
  console.log('🔁 扫描待上传附件...')
  for (const o of orders.value) {
    const pending = o.attachments?.filter(a => a.uploadStatus === 'pending' || a.uploadStatus === 'failed')
    if (pending?.length) {
      for (const att of pending) {
        att.uploadStatus = 'uploading'
        uploadingIds.value.add(att.id)
        try {
          const result = await mockUpload(att)
          att.cdnUrl = result.cdnUrl
          att.uploadStatus = 'done'
          console.log(`✅ 重试成功: ${att.name}`)
        } catch (e: any) {
          att.uploadStatus = 'failed'
          console.error(`❌ 重试失败: ${att.name}`)
        } finally {
          uploadingIds.value.delete(att.id)
        }
      }
      await brCall('database.update', { table: TABLE, id: o.id, data: o })
    }
  }
  await load()
}

// ─────────── 辅助 ───────────
const statusLabels: Record<string, string> = { pending: '⏳ 待处理', in_progress: '🔧 处理中', completed: '✅ 已完成' }
const priorityLabels: Record<string, string> = { high: '🔴 高', medium: '🟡 中', low: '🟢 低' }
const uploadStatusLabels: Record<string, string> = {
  pending: '⏳', uploading: '📤', done: '✅', failed: '❌'
}
function isUploading(id: number) { return uploadingIds.value.has(id) }

onMounted(() => { load(); watchNetwork() })
onUnmounted(() => { if (_netTimer) clearInterval(_netTimer) })
</script>

<template>
  <div class="page">
    <!-- ── 顶栏 ── -->
    <div class="header-row">
      <h2>📋 离线工单</h2>
      <div class="header-right">
        <span class="net-badge" :class="networkStatus">
          {{ networkStatus === 'online' ? '🟢 在线' : '🔴 离线' }}
        </span>
        <span v-if="pendingCount" class="pending-badge" title="待上传附件">
          📎 {{ pendingCount }}
        </span>
        <button class="btn-sm" @click="create">+ 新建工单</button>
      </div>
    </div>

    <!-- ── 筛选 ── -->
    <div class="filters">
      <label
        v-for="(label, key) in { '': '全部', pending: '⏳ 待处理', in_progress: '🔧 处理中', completed: '✅ 已完成' }"
        :key="key"
        :class="{ active: statusFilter === key }"
        @click="statusFilter = key"
      >{{ label }}</label>
      <button v-if="pendingCount" class="btn-sm outline" @click="retryAllUploads" style="margin-left:auto; font-size:12px; padding:4px 10px">
        🔄 重试上传 ({{ pendingCount }})
      </button>
    </div>

    <div v-if="loading" class="loading">加载中...</div>

    <!-- ── 工单列表 ── -->
    <div v-else class="list">
      <div class="card" v-for="o in filtered" :key="o.id">
        <div class="card-head">
          <strong>{{ o.title }}</strong>
          <span class="prio">{{ priorityLabels[o.priority] || o.priority }}</span>
        </div>
        <p class="desc">{{ o.description }}</p>
        <div class="meta">
          <span>{{ statusLabels[o.status] || o.status }}</span>
          <span v-if="o.assignee">👤 {{ o.assignee }}</span>
          <span v-if="o.address">📍 {{ o.address }}</span>
          <span v-if="o.attachments?.length" :class="{ 'has-pending': o.attachments.some(a => a.uploadStatus !== 'done') }">
            📎 {{ o.attachments.length }} 附件
            <template v-if="o.attachments.some(a => a.uploadStatus !== 'done')">
              ({{ o.attachments.filter(a => a.uploadStatus !== 'done').length }} 待上传)
            </template>
          </span>
        </div>
        <!-- 缩略图横滑 -->
        <div v-if="o.attachments?.length" class="thumb-strip">
          <div
            v-for="att in o.attachments"
            :key="att.id"
            class="thumb-item"
            :class="att.uploadStatus"
          >
            <template v-if="att.type === 'image' && (att.webPath || att.thumbnail || att.cdnUrl)">
              <img :src="att.webPath || att.thumbnail || att.cdnUrl" class="thumb-img" />
            </template>
            <template v-else>
              <span class="thumb-placeholder">🎬</span>
            </template>
            <span class="thumb-badge">{{ uploadStatusLabels[att.uploadStatus] }}</span>
            <span v-if="isUploading(att.id)" class="spinner"></span>
          </div>
        </div>
        <div class="actions">
          <button class="btn-sm outline" @click="edit(o)">编辑</button>
          <button class="btn-sm danger" @click="remove(o.id!)">删除</button>
        </div>
      </div>
      <div v-if="!filtered.length" class="empty">暂无工单</div>
    </div>

    <!-- ── 表单弹窗 ── -->
    <div class="modal" v-if="showForm">
      <div class="modal-content">
        <h3>{{ editing!.id ? '编辑工单' : '新建工单' }}</h3>

        <label>标题 <input v-model="editing!.title" placeholder="工单标题" /></label>
        <label>描述 <textarea v-model="editing!.description" placeholder="详细描述" rows="2" /></label>

        <div class="row-2">
          <label>状态
            <select v-model="editing!.status">
              <option value="pending">待处理</option>
              <option value="in_progress">处理中</option>
              <option value="completed">已完成</option>
            </select>
          </label>
          <label>优先级
            <select v-model="editing!.priority">
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
          </label>
        </div>

        <label>负责人 <input v-model="editing!.assignee" placeholder="姓名" /></label>
        <label>地址 <input v-model="editing!.address" placeholder="工单地址" /></label>

        <!-- ── 附件区 ── -->
        <div class="attachments-section">
          <div class="att-header">
            <span>📎 附件 ({{ editing!.attachments.length }})</span>
            <div class="att-btns">
              <button class="btn-xs" @click="takePhoto">📷 拍照</button>
              <button class="btn-xs" @click="pickFromGallery">🖼️ 相册</button>
            </div>
          </div>

          <div v-if="!editing!.attachments.length" class="att-empty">暂无附件，点击上方按钮添加</div>

          <div v-for="(att, i) in editing!.attachments" :key="att.id" class="att-row">
            <div class="att-info">
              <template v-if="att.type === 'image' && (att.webPath || att.thumbnail || att.localPath)">
                <img :src="att.webPath || att.thumbnail || att.localPath" class="att-thumb" />
              </template>
              <template v-else>
                <span class="att-icon">🎬</span>
              </template>
              <div class="att-text">
                <span class="att-name">{{ att.name }}</span>
                <span class="att-status" :class="att.uploadStatus">
                  {{ uploadStatusLabels[att.uploadStatus] }}
                  {{ att.uploadStatus === 'pending' ? '待上传' : att.uploadStatus === 'uploading' ? '上传中' : att.uploadStatus === 'done' ? '已上传' : '上传失败' }}
                </span>
                <span v-if="att.cdnUrl" class="att-url">{{ att.cdnUrl }}</span>
              </div>
            </div>
            <div class="att-actions">
              <button
                v-if="att.uploadStatus === 'pending' || att.uploadStatus === 'failed'"
                class="btn-xs"
                @click="uploadSingleAttachment(att)"
              >上传</button>
              <button class="btn-xs danger" @click="removeAttachment(i)">✕</button>
            </div>
          </div>
        </div>

        <div class="form-actions">
          <button @click="cancel">取消</button>
          <button class="primary" @click="save">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { padding: 16px; padding-bottom: 80px; }
.header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.header-right { display: flex; align-items: center; gap: 8px; }
h2 { font-size: 20px; }
.net-badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; }
.net-badge.online { background: #dcfce7; color: #166534; }
.net-badge.offline { background: #fef2f2; color: #991b1b; }
.pending-badge { background: #fef3c7; color: #92400e; font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 600; }

.btn-sm { padding: 6px 14px; border: 0; border-radius: 6px; background: #2563eb; color: white; font-size: 13px; cursor: pointer; }
.btn-sm.outline { background: transparent; color: #2563eb; border: 1.5px solid #2563eb; }
.btn-sm.danger { background: #ef4444; }
.btn-xs { padding: 3px 8px; border: 0; border-radius: 4px; background: #e2e8f0; color: #334155; font-size: 11px; cursor: pointer; }
.btn-xs.danger { background: #fee2e2; color: #dc2626; }

.filters { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; align-items: center; }
.filters label { padding: 4px 10px; border-radius: 14px; font-size: 12px; background: #f1f5f9; color: #475569; cursor: pointer; }
.filters label.active { background: #2563eb; color: white; }

.loading { text-align: center; padding: 40px; color: #94a3b8; }
.empty { text-align: center; padding: 40px; color: #94a3b8; }

/* 卡片 */
.card { padding: 14px; background: #fff; border-radius: 8px; border: 1px solid #e7e9ef; margin-bottom: 10px; }
.card-head { display: flex; justify-content: space-between; margin-bottom: 6px; }
.card-head strong { font-size: 15px; }
.prio { font-size: 12px; }
.desc { font-size: 13px; color: #475569; margin-bottom: 8px; }
.meta { display: flex; gap: 12px; font-size: 12px; color: #94a3b8; flex-wrap: wrap; align-items: center; }
.meta .has-pending { color: #d97706; }
.actions { display: flex; gap: 8px; margin-top: 10px; }

/* 缩略图横滑 */
.thumb-strip { display: flex; gap: 6px; margin: 8px 0; overflow-x: auto; }
.thumb-item { position: relative; width: 48px; height: 48px; border-radius: 6px; overflow: hidden; border: 1.5px solid #e7e9ef; flex-shrink: 0; }
.thumb-item.done { border-color: #86efac; }
.thumb-item.failed { border-color: #fca5a5; }
.thumb-item.uploading { border-color: #93c5fd; }
.thumb-img { width: 100%; height: 100%; object-fit: cover; }
.thumb-placeholder { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-size: 18px; background: #f1f5f9; }
.thumb-badge { position: absolute; bottom: 1px; right: 1px; font-size: 8px; background: rgba(0,0,0,.6); color: #fff; padding: 0 3px; border-radius: 3px; }
.spinner { position: absolute; inset: 0; border: 2px solid #e2e8f0; border-top-color: #2563eb; border-radius: 6px; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* 弹窗 */
.modal { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: flex-start; justify-content: center; z-index: 100; padding-top: 40px; overflow-y: auto; }
.modal-content { background: #fff; border-radius: 12px; padding: 20px; width: 90%; max-width: 440px; margin-bottom: 40px; }
.modal-content h3 { margin-bottom: 14px; font-size: 17px; }
.modal-content label { display: block; margin-bottom: 8px; font-size: 12px; color: #475569; }
.modal-content input, .modal-content textarea, .modal-content select { width: 100%; padding: 7px 9px; margin-top: 3px; border: 1px solid #e7e9ef; border-radius: 6px; font-size: 14px; }
.modal-content textarea { resize: vertical; }
.row-2 { display: flex; gap: 10px; }
.row-2 label { flex: 1; }

/* 附件区 */
.attachments-section { margin: 12px 0; padding: 10px; background: #f8fafc; border-radius: 8px; border: 1px dashed #cbd5e1; }
.att-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 13px; font-weight: 600; color: #334155; }
.att-btns { display: flex; gap: 6px; }
.att-empty { font-size: 12px; color: #94a3b8; text-align: center; padding: 10px 0; }
.att-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #f1f5f9; }
.att-row:last-child { border-bottom: 0; }
.att-info { display: flex; align-items: center; gap: 8px; min-width: 0; }
.att-thumb { width: 36px; height: 36px; border-radius: 4px; object-fit: cover; flex-shrink: 0; }
.att-icon { font-size: 20px; flex-shrink: 0; }
.att-text { display: flex; flex-direction: column; min-width: 0; font-size: 11px; }
.att-name { font-weight: 500; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
.att-status { font-size: 10px; }
.att-status.pending { color: #d97706; }
.att-status.uploading { color: #2563eb; }
.att-status.done { color: #16a34a; }
.att-status.failed { color: #dc2626; }
.att-url { color: #94a3b8; font-size: 9px; word-break: break-all; }
.att-actions { display: flex; gap: 4px; flex-shrink: 0; }

.form-actions { display: flex; gap: 8px; margin-top: 16px; }
.form-actions button { flex: 1; padding: 10px; border: 0; border-radius: 6px; font-size: 14px; cursor: pointer; background: #f1f5f9; color: #475569; }
.form-actions button.primary { background: #2563eb; color: white; }
</style>
