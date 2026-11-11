import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { EventEmitter } from 'node:events'
import type { MenuItemConstructorOptions, Rectangle } from 'electron'
import helperPath from '../../build/linux-indicator.py?asset'

/** Use Ubuntu's native indicator implementation rather than Chromium's SNI shim. */
export class LinuxIndicator extends EventEmitter {
  private readonly child: ChildProcessWithoutNullStreams
  private items: MenuItemConstructorOptions[] = []
  private generation = 0
  private destroyed = false
  private unavailable = false

  constructor(iconPath: string) {
    super()
    const unpack = (path: string) => path.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
    this.child = spawn('/usr/bin/python3', [unpack(helperPath), unpack(iconPath)], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stderr.resume()
    this.child.stdin.on('error', () => { /* Exit is handled below. */ })
    createInterface({ input: this.child.stdout }).on('line', line => {
      try {
        const action = JSON.parse(line) as { generation?: number; id?: number }
        if (action.generation !== this.generation || !Number.isInteger(action.id)) return
        const item = this.items[action.id!]
        if (item && item.enabled !== false) item.click?.({} as never, {} as never, {} as never)
      } catch { /* Ignore malformed helper output. */ }
    })
    this.child.on('error', () => this.failed())
    this.child.on('exit', () => this.failed())
  }

  private failed(): void {
    if (!this.destroyed && !this.unavailable) { this.unavailable = true; this.emit('unavailable') }
  }

  setMenu(items: MenuItemConstructorOptions[]): void {
    this.items = items
    this.generation += 1
    this.child.stdin.write(JSON.stringify({ generation: this.generation,
      items: items.map(({ label, type, checked, enabled }) => ({ label, type, checked, enabled })) }) + '\n')
  }

  setToolTip(_title: string): void { /* AppIndicator exposes its application title. */ }
  getBounds(): Rectangle { return { x: 0, y: 0, width: 0, height: 0 } }
  destroy(): void {
    this.destroyed = true
    this.child.stdin.end()
    this.child.kill()
    this.removeAllListeners()
  }
}
