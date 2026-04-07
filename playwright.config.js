import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry"
  },
  webServer: {
    command:
      "node -e \"const {rmSync}=require('node:fs'); const {spawn}=require('node:child_process'); const path=require('node:path'); const root=process.cwd(); const persist=path.join(root,'.wrangler','playwright-state'); const cli=path.join(root,'node_modules','wrangler','bin','wrangler.js'); rmSync(persist,{recursive:true,force:true}); const child=spawn(process.execPath,[cli,'dev','--local','--port','4173','--persist-to',persist],{cwd:root,stdio:'inherit'}); child.on('exit',(code,signal)=>{ if(signal){ process.kill(process.pid,signal); return; } process.exit(code ?? 1); });\"",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 120000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
