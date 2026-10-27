import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fundEndpoint from './fund-server.js'
import roofEndpoint from './roof-server.js'

// GitHub Pages serves the site at https://<user>.github.io/<repo>/.
// In GitHub Actions, GITHUB_REPOSITORY is "<user>/<repo>"; locally it is unset.
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = repo && !repo.endsWith('.github.io') ? `/${repo}/` : '/'

export default defineConfig({
  plugins: [react(), fundEndpoint(), roofEndpoint()],
  base,
})
