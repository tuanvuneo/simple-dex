import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { defineChain } from 'viem'
import { sepolia } from 'viem/chains'

export const localAnvil = defineChain({
  id: 31338,
  name: 'Anvil Local',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: ['http://127.0.0.1:8545'] },
  },
})

export const config = getDefaultConfig({
  appName: 'SimpleDEX',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? 'dev-project-id',
  chains: [sepolia, localAnvil],
  ssr: true,
})
