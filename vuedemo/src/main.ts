import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

// ─────────── vConsole 移动端调试面板 ───────────
// 触发方式（任一即可）：
//   ① dev 模式（npm run dev）→ 自动开启
//   ② 浏览器 / Capacitor：URL 任意位置含 debug=1（query 或 hash 都行）
//      dev: http://172.16.2.158:5173?debug=1
//      cap: capacitor://localhost/index.html#/?debug=1
//   ③ localStorage 设 vconsole_enabled = '1'
//   ④ Capacitor Preferences 设 vconsole_debug = '1'（持久化，杀进程重启仍在）
const enableVConsole =
  import.meta.env.DEV ||
  location.href.includes('debug=1') ||
  localStorage.getItem('vconsole_enabled') === '1'

if (enableVConsole) {
  import('vconsole').then(({ default: VConsole }) => {
    new VConsole()
    console.log('🟢 vConsole 已启动')
  })
}
// ─────────────────────────────────────────────

// 启动时异步检查 Preferences 里的调试开关
import('@capacitor/preferences').then(({ Preferences }) => {
  Preferences.get({ key: 'vconsole_debug' }).then(r => {
    if (r.value === '1' && !(window as any).__vconsole_loaded) {
      ;(window as any).__vconsole_loaded = true
      import('vconsole').then(({ default: VConsole }) => {
        new VConsole()
        console.log('🟢 vConsole 已启动 (via Preferences)')
      })
    }
  }).catch(()=>{})
}).catch(()=>{})

const app = createApp(App)
app.use(router)
app.mount('#app')
