'use client'

import { useAccount, useReadContracts } from 'wagmi'
import { formatUnits } from 'viem'
import { erc20Abi } from '@/abi/ERC20'
import {
  POOL_ADDRESS,
  WETH_ADDRESS,
  USDC_ADDRESS,
  WETH_DECIMALS,
  USDC_DECIMALS,
} from '@/lib/constants'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export function TokenBalances() {
  const { address, isConnected } = useAccount()

  const contractsEnabled =
    !!address && WETH_ADDRESS !== ZERO_ADDRESS

  const { data, isPending, isError, error } = useReadContracts({
    contracts: [
      {
        address: WETH_ADDRESS,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address ?? ZERO_ADDRESS],
      },
      {
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address ?? ZERO_ADDRESS],
      },
      {
        address: POOL_ADDRESS,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address ?? ZERO_ADDRESS],
      },
    ],
    query: { enabled: contractsEnabled },
  })

  const wethBalance = data?.[0]?.result
  const usdcBalance = data?.[1]?.result
  const lpBalance = data?.[2]?.result

  const formatWeth = (val: bigint) =>
    parseFloat(formatUnits(val, WETH_DECIMALS)).toFixed(8)
  const formatUsdc = (val: bigint) =>
    parseFloat(formatUnits(val, USDC_DECIMALS)).toFixed(6)
  const formatLp = (val: bigint) =>
    formatUnits(val, 18)

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">Token Balances</h2>

      {!isConnected && (
        <p className="text-sm text-gray-500">Connect wallet to view balances</p>
      )}

      {isConnected && WETH_ADDRESS === ZERO_ADDRESS && (
        <p className="text-sm text-gray-500">Contracts not deployed yet</p>
      )}

      {isConnected && WETH_ADDRESS !== ZERO_ADDRESS && isPending && (
        <div className="animate-pulse space-y-2">
          <div className="h-4 rounded bg-gray-200" />
          <div className="h-4 rounded bg-gray-200" />
          <div className="h-4 rounded bg-gray-200" />
        </div>
      )}

      {isConnected && WETH_ADDRESS !== ZERO_ADDRESS && isError && (
        <p className="text-sm text-red-600">
          Failed to load balances
          {error && 'shortMessage' in error
            ? `: ${(error as { shortMessage: string }).shortMessage}`
            : ''}
        </p>
      )}

      {isConnected &&
        WETH_ADDRESS !== ZERO_ADDRESS &&
        !isPending &&
        !isError &&
        data && (
          <dl className="space-y-3">
            <div className="flex items-center justify-between">
              <dt className="text-sm font-medium text-gray-600">WETH</dt>
              <dd className="text-sm text-gray-900">
                {wethBalance !== undefined ? formatWeth(wethBalance as bigint) : '—'}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-sm font-medium text-gray-600">MockUSDC</dt>
              <dd className="text-sm text-gray-900">
                {usdcBalance !== undefined ? formatUsdc(usdcBalance as bigint) : '—'}
              </dd>
            </div>
            <div className="flex items-center justify-between border-t border-gray-100 pt-3">
              <dt className="text-sm font-medium text-gray-600">LP Token</dt>
              <dd className="text-sm text-gray-900">
                {lpBalance !== undefined ? formatLp(lpBalance as bigint) : '—'}
              </dd>
            </div>
          </dl>
        )}
    </section>
  )
}


