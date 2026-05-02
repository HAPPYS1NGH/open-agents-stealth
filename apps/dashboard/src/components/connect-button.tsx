'use client'

import { ConnectButton as RainbowConnectButton } from '@rainbow-me/rainbowkit'

/**
 * Thin wrapper around RainbowKit's ConnectButton. Centralizes label copy and
 * lets us swap the wallet library later without touching call sites.
 */
export function ConnectButton() {
  return (
    <RainbowConnectButton
      label="Connect wallet"
      accountStatus={{ smallScreen: 'avatar', largeScreen: 'full' }}
      chainStatus="icon"
      showBalance={false}
    />
  )
}
