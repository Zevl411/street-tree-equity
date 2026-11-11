// #145: isolated Chrome startup for the dependency-free CDP accessibility harness.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:net'

export async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function stop(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill()
  const hardStop = setTimeout(() => child.kill('SIGKILL'), 2000)
  await exited
  clearTimeout(hardStop)
}

export async function launchChrome(binary, { timeout = 30000, attempts = 3 } = {}) {
  const failures = []
  const ports = new Set()
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let port
    do { port = await freePort() } while (ports.has(port))
    ports.add(port)
    const profile = mkdtempSync(path.join(tmpdir(), 'ste-a11y-'))
    const args = ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run',
      '--no-default-browser-check', '--disable-dev-shm-usage', '--window-size=1400,900', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
      ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), 'about:blank']
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', spawnError = null, lastError = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => { spawnError = error })
    const deadline = Date.now() + timeout
    while (Date.now() < deadline && child.exitCode === null && child.signalCode === null && !spawnError) {
      try {
        // /json/version is the readiness gate; a process existing is not proof CDP is ready.
        const version = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })
        if (!version.ok || !(await version.json()).webSocketDebuggerUrl) throw new Error('DevTools version not ready')
        const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })).json()
        const page = pages.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
        if (page) return {
          webSocketUrl: page.webSocketDebuggerUrl,
          async close() { await stop(child); rmSync(profile, { recursive: true, force: true }) },
        }
        lastError = 'DevTools ready but no page target yet'
      } catch (error) { lastError = error.message }
      await pause(100)
    }
    await stop(child)
    failures.push(`Attempt ${attempt}/${attempts}: binary=${binary}\nargs=${JSON.stringify(args)}\nexit=${child.exitCode}, signal=${child.signalCode}\nerror=${spawnError?.message || lastError}\nstdout:\n${stdout || '(empty)'}\nstderr:\n${stderr || '(empty)'}`)
    rmSync(profile, { recursive: true, force: true })
  }
  throw new Error(`Chrome DevTools endpoint did not come up after ${attempts} attempts (up to ${timeout}ms each).\n${failures.join('\n\n')}`)
}
