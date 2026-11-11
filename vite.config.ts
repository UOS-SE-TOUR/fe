import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { configDefaults } from 'vitest/config'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, '')
  // 로컬 개발 서버가 /api 요청을 넘길 서버(README "서버 연결")
  const apiProxyTarget = env.API_PROXY_TARGET || 'http://localhost:8080'
  const claudeDir = path.resolve(import.meta.dirname, '.claude')

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      tsconfigPaths: true,
    },
    server: {
      // 서버 API는 모두 /api/v1로 시작하니 경로를 떼지 않고(rewrite 없이) 그대로 넘긴다
      proxy: {
        '^/api(/|\\?|$)': { target: apiProxyTarget, changeOrigin: true },
      },
      // 이 레포의 .claude/(/issue 워크트리 = 다른 브랜치)는 감시하지 않는다. 워크트리 안에서 띄워도 자기 src는 감시하도록 루트에 고정한다
      watch: { ignored: (file: string) => file === claudeDir || file.startsWith(claudeDir + path.sep) },
    },
    test: {
      exclude: [...configDefaults.exclude, '.claude/**'],
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  }
})
