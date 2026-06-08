<template>
  <div class="view">
    <h2 @click="onTapTitle">👤 注入数据 (__BR_Data__) <span v-if="tapCount > 0" class="tap-hint">{{ '🔘'.repeat(tapCount) }}</span></h2>

    <div class="card" v-if="brData.accessToken">
      <div class="row"><span class="label">Token</span><span class="value">{{ maskedToken }}</span></div>
      <div class="row"><span class="label">用户</span><span class="value">{{ str(obj(brData.user).name) }}</span></div>
      <div class="row"><span class="label">UserID</span><span class="value">{{ str(obj(brData.user).id) }}</span></div>
      <div class="row"><span class="label">语言</span><span class="value">{{ str(brData.lang) }}</span></div>
      <div class="row"><span class="label">App版本</span><span class="value">{{ str(brData.appVersion) }}</span></div>
      <div class="row"><span class="label">系统版本</span><span class="value">{{ str(brData.systemVersion) }}</span></div>
    </div>
    <div class="card" v-else>
      <p class="dim">⚠️ 未收到 Native 注入数据（可能不在 WebView 中）</p>
    </div>

    <!-- 调试开关 -->
    <div class="debug-section">
      <div class="card">
        <p class="dim" style="margin:0 0 8px">🔧 调试工具</p>
        <button class="debug-btn" @click="toggleConsole">
          {{ vConsoleOn ? '🔴 关闭 vConsole' : '🟢 开启 vConsole' }}
        </button>
        <p v-if="msg" class="msg">{{ msg }}</p>
        <p class="hint">💡 也可连续点标题 5 次切换</p>
      </div>
    </div>

    <pre class="log">完整数据:\n{{ JSON.stringify(brData, null, 2) }}</pre>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { getBRData } from '../composables/capacitor-bridge'
import { Preferences } from '@capacitor/preferences'

const brData = computed(() => getBRData())

const maskedToken = computed(() => {
  const t = brData.value.accessToken as string | undefined
  return t ? t.slice(0, 12) + '****' + t.slice(-4) : 'N/A'
})

function str(v: unknown, fallback = 'N/A') { return (v as string) || fallback }
function obj(v: unknown) { return (v as Record<string, unknown>) || {} }

// ─────── 彩蛋：连续点5次标题 切换 vConsole ───────
const tapCount = ref(0)
const vConsoleOn = ref(false)
const msg = ref('')
let _tapTimer: any = null

async function onTapTitle() {
  tapCount.value++
  clearTimeout(_tapTimer)
  _tapTimer = setTimeout(() => { tapCount.value = 0 }, 2000)

  if (tapCount.value >= 5) {
    tapCount.value = 0
    await toggleConsole()
  }
}

async function toggleConsole() {
  const current = await Preferences.get({ key: 'vconsole_debug' })
  const newVal = current.value === '1' ? '0' : '1'
  await Preferences.set({ key: 'vconsole_debug', value: newVal })
  vConsoleOn.value = newVal === '1'

  if (newVal === '1') {
    msg.value = '✅ vConsole 已开启，刷新页面生效'
    // 如果还没加载，动态加载
    if (!(window as any).VConsole) {
      try {
        const { default: VConsole } = await import('vconsole')
        new VConsole()
      } catch { /* ignore */ }
    }
  } else {
    msg.value = '🔴 vConsole 已关闭，刷新页面生效'
  }

  setTimeout(() => { msg.value = '' }, 2000)
}

// 启动时检查状态
Preferences.get({ key: 'vconsole_debug' }).then(r => {
  vConsoleOn.value = r.value === '1'
}).catch(() => {})
</script>

<style scoped>
h2 { margin-bottom: 16px; cursor: default; user-select: none; }
.tap-hint { font-size: 12px; vertical-align: middle; opacity: 0.6; }
.card { padding: 16px; background: #fff; border-radius: 8px; border: 1px solid #e7e9ef; }
.row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f0f1f5; font-size: 14px; }
.row:last-child { border-bottom: none; }
.label { color: #667085; }
.value { font-weight: 600; }
.dim { color: #98a2b3; text-align: center; }
pre.log { margin-top: 14px; padding: 12px; border: 1px solid #e7e9ef; border-radius: 8px; background: #fff; white-space: pre-wrap; font-size: 12px; }
.debug-section { margin-top: 14px; }
.debug-btn { width: 100%; padding: 10px; border: 2px dashed #cbd5e1; border-radius: 8px; background: #f8fafc; font-size: 14px; cursor: pointer; }
.debug-btn:active { background: #e2e8f0; }
.msg { margin-top: 6px; font-size: 12px; color: #2563eb; text-align: center; }
.hint { margin-top: 4px; font-size: 10px; color: #94a3b8; text-align: center; }
</style>
