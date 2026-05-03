import { afterEach, describe, expect, it, vi } from 'vitest'

describe('scanner worker', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('runs at least one tick and exits cleanly when stopping flips', async () => {
    vi.stubEnv('SCANNER_WORKER_INTERVAL_MS', '50')
    vi.stubEnv('SCANNER_WORKER_JITTER_MS', '0')
    vi.stubEnv(
      'DATABASE_URL',
      'postgres://open_agents:open_agents_dev@localhost:5434/open_agents',
    )
    vi.stubEnv('SCANNER_RPC', 'off')

    const runTickMock = vi.fn(async () => ({
      scannedAt: new Date().toISOString(),
      currentBlock: '0',
      agentsScanned: 0,
      perAgent: [],
    }))
    vi.doMock('../src/lib/run-tick.js', () => ({ runTick: runTickMock }))

    const { __test__ } = await import('../src/worker.js?worker-test=' + Date.now())

    // Race: schedule the stop signal after one interval, then await loop.
    setTimeout(() => __test__.requestStopForTest(), 120)
    await __test__.loop()

    expect(runTickMock).toHaveBeenCalled()
  }, 5_000)
})
