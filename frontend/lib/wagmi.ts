import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { foundry } from 'wagmi/chains'

export const config = getDefaultConfig({
  appName: 'SimpleDEX',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? 'dev-project-id',
  chains: [foundry],
  ssr: true,
})
