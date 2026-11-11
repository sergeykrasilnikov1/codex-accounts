import type { BackendCommand } from './contracts'

export function backendCommandTimeout(command: BackendCommand): number {
  if (command === 'exportAccounts' || command === 'importAccounts') return 180_000
  if (command === 'getLimits' || command === 'refreshLimits') return 180_000
  if (command === 'switchProfile' || command === 'captureProfile' || command === 'restoreBackup' || command === 'prepareLogin') return 60_000
  return 30_000
}
