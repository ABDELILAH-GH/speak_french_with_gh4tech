import { spawn } from 'node:child_process'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const processes = [
  spawn(npm, ['run', 'dev:client'], { stdio: 'inherit', shell: process.platform === 'win32' }),
  spawn(npm, ['run', 'dev:server'], { stdio: 'inherit', shell: process.platform === 'win32' }),
]

let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of processes) if (!child.killed) child.kill('SIGTERM')
  process.exitCode = code
}
for (const child of processes) child.on('exit', (code) => stop(code || 0))
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
