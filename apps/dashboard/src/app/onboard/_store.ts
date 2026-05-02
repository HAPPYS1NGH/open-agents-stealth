import { create } from 'zustand'

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 'done'

export interface WizardState {
  step: WizardStep

  agentRowId: string | null
  subnameLabel: string | null

  viewKeyHex: string | null

  agentIdOnchain: string | null
  registerTxHash: `0x${string}` | null

  treasurySafeAddress: `0x${string}` | null
  treasuryDeployTxHash: `0x${string}` | null

  setSubname: (id: string, label: string) => void
  setViewKey: (hex: string) => void
  setOnchain: (agentId: string, txHash: `0x${string}`) => void
  setTreasury: (safeAddress: `0x${string}`, deployTxHash: `0x${string}`) => void
  next: () => void
  reset: () => void
}

export const useWizardStore = create<WizardState>((set) => ({
  step: 1,
  agentRowId: null,
  subnameLabel: null,
  viewKeyHex: null,
  agentIdOnchain: null,
  registerTxHash: null,
  treasurySafeAddress: null,
  treasuryDeployTxHash: null,

  setSubname: (id, label) => set({ agentRowId: id, subnameLabel: label }),
  setViewKey: (hex) => set({ viewKeyHex: hex }),
  setOnchain: (agentId, txHash) => set({ agentIdOnchain: agentId, registerTxHash: txHash }),
  setTreasury: (safeAddress, deployTxHash) => set({ treasurySafeAddress: safeAddress, treasuryDeployTxHash: deployTxHash }),

  next: () =>
    set((s) => {
      if (s.step === 'done') return s
      const order: WizardStep[] = [1, 2, 3, 4, 5, 'done']
      const idx = order.indexOf(s.step)
      return { step: order[Math.min(idx + 1, order.length - 1)] ?? 'done' }
    }),
  reset: () =>
    set({
      step: 1,
      agentRowId: null,
      subnameLabel: null,
      viewKeyHex: null,
      agentIdOnchain: null,
      registerTxHash: null,
      treasurySafeAddress: null,
      treasuryDeployTxHash: null,
    }),
}))
