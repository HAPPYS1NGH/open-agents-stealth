export interface AgentResponse {
  id: string
  ownerEoa: string
  subnameLabel: string
  agentId: string | null
  baseAddr: string
  agentWalletEoa: string | null
  textRecords: Record<string, string>
  treasurySafeAddress: string | null
  viewKeyEncrypted?: string | null
  isActive?: boolean
  createdAt: string
  updatedAt?: string
}

export interface MeResponse {
  ownerEoa: string
  agents: AgentResponse[]
}

export interface SiweNonceResponse {
  nonce: string
}

export interface SiweVerifyResponse {
  token: string
  expiresAt: string
}

export interface CreateAgentBody {
  subnameLabel: string
  baseAddr: string
  agentId?: string
  agentWalletEoa?: string
  textRecords?: Record<string, string>
  viewKeyEncrypted?: string
}

export interface PatchAgentBody {
  baseAddr?: string
  agentWalletEoa?: string
  textRecords?: Record<string, string>
  treasurySafeAddress?: string
  viewKeyEncrypted?: string
}

export interface RegisterOnchainBody {
  agentId: string
  txHash: `0x${string}`
}

export interface RegisterOnchainResponse {
  id: string
  agentId: string
  agentWalletEoa: string
}

export interface TreasuryBody {
  safeAddress: `0x${string}`
  deployTxHash: `0x${string}`
}

export interface TreasuryResponse {
  id: string
  treasurySafeAddress: string
}
