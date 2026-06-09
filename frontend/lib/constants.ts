import { type Address } from 'viem'

// Contract addresses — populated after deployment (Phase 8)
// For now, use zero address as placeholder. Components gate reads on non-zero address.
export const POOL_ADDRESS = (process.env.NEXT_PUBLIC_POOL_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address
export const WETH_ADDRESS = (process.env.NEXT_PUBLIC_WETH_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address
export const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address
export const FACTORY_ADDRESS = (process.env.NEXT_PUBLIC_FACTORY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address

// Token metadata (known from contract source)
export const WETH_DECIMALS = 18
export const USDC_DECIMALS = 6
