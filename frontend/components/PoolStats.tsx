'use client'

import { useAccount, useReadContracts } from 'wagmi'
import { formatUnits } from 'viem'
import { poolAbi } from '@/abi/Pool'
import { erc20Abi } from '@/abi/ERC20'
import {
  POOL_ADDRESS,
  WETH_ADDRESS,
  WETH_DECIMALS,
  USDC_DECIMALS,
} from '@/lib/constants'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export function PoolStats() {
  const { address, isConnected } = useAccount()
  const poolEnabled = POOL_ADDRESS !== ZERO_ADDRESS

  const { data, isPending, isError, error } = useReadContracts({
    contracts: [
      {
        address: POOL_ADDRESS,
        abi: poolAbi,
        functionName: 'getReserves',
      },
      {
        address: POOL_ADDRESS,
        abi: poolAbi,
        functionName: 'token0',
      },
      {
        address: POOL_ADDRESS,
        abi: poolAbi,
        functionName: 'token1',
      },
      {
        address: POOL_ADDRESS,
        abi: poolAbi,
        functionName: 'totalSupply',
      },
      {
        address: POOL_ADDRESS,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address ?? ZERO_ADDRESS],
      },
    ],
    query: { enabled: poolEnabled },
  })

  const reservesResult = data?.[0]?.result as
    | readonly [bigint, bigint]
    | undefined
  const token0Result = data?.[1]?.result as `0x${string}` | undefined
  const totalSupplyResult = data?.[3]?.result as bigint | undefined
  const userLpBalance = data?.[4]?.result as bigint | undefined

  // Determine which reserve corresponds to which token
  const wethIsToken0 =
    token0Result?.toLowerCase() === WETH_ADDRESS.toLowerCase()

  const reserveWeth = reservesResult
    ? wethIsToken0
      ? reservesResult[0]
      : reservesResult[1]
    : undefined
  const reserveUsdc = reservesResult
    ? wethIsToken0
      ? reservesResult[1]
      : reservesResult[0]
    : undefined

  // Exchange rate: USDC per WETH
  // rate = (reserveUsdc / 10^6) / (reserveWeth / 10^18)
  let wethToUsdc: string | null = null
  let usdcToWeth: string | null = null

  if (
    reserveWeth !== undefined &&
    reserveUsdc !== undefined &&
    reserveWeth > 0n &&
    reserveUsdc > 0n
  ) {
    const wethAmount = parseFloat(formatUnits(reserveWeth, WETH_DECIMALS))
    const usdcAmount = parseFloat(formatUnits(reserveUsdc, USDC_DECIMALS))
    wethToUsdc = (usdcAmount / wethAmount).toFixed(6)
    usdcToWeth = (wethAmount / usdcAmount).toFixed(8)
  }

  const hasNoLiquidity =
    reservesResult === undefined ||
    totalSupplyResult === undefined ||
    totalSupplyResult <= 1000n ||
    reservesResult[0] === 0n ||
    reservesResult[1] === 0n

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">Pool Stats</h2>

      {!poolEnabled && (
        <p className="text-sm text-gray-500">Pool not deployed yet</p>
      )}

      {poolEnabled && isPending && (
        <div className="animate-pulse space-y-2">
          <div className="h-4 rounded bg-gray-200" />
          <div className="h-4 rounded bg-gray-200" />
          <div className="h-4 rounded bg-gray-200" />
          <div className="h-4 rounded bg-gray-200" />
        </div>
      )}

      {poolEnabled && isError && (
        <p className="text-sm text-red-600">
          Failed to load pool data
          {error && 'shortMessage' in error
            ? `: ${(error as { shortMessage: string }).shortMessage}`
            : ''}
        </p>
      )}

      {poolEnabled && !isPending && !isError && hasNoLiquidity && (
        <p className="text-sm text-gray-500">Pool has no liquidity</p>
      )}

      {poolEnabled && !isPending && !isError && data && !hasNoLiquidity && (
        <dl className="space-y-3">
          <div className="flex items-center justify-between">
            <dt className="text-sm font-medium text-gray-600">WETH Reserve</dt>
            <dd className="text-sm text-gray-900">
              {reserveWeth !== undefined
                ? parseFloat(formatUnits(reserveWeth, WETH_DECIMALS)).toFixed(8)
                : '—'}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-sm font-medium text-gray-600">USDC Reserve</dt>
            <dd className="text-sm text-gray-900">
              {reserveUsdc !== undefined
                ? parseFloat(formatUnits(reserveUsdc, USDC_DECIMALS)).toFixed(6)
                : '—'}
            </dd>
          </div>

          {(wethToUsdc || usdcToWeth) && (
            <div className="border-t border-gray-100 pt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Exchange Rate
              </p>
              {wethToUsdc && (
                <div className="flex items-center justify-between">
                  <dt className="text-sm text-gray-600">1 WETH</dt>
                  <dd className="text-sm text-gray-900">{wethToUsdc} USDC</dd>
                </div>
              )}
              {usdcToWeth && (
                <div className="mt-1 flex items-center justify-between">
                  <dt className="text-sm text-gray-600">1 USDC</dt>
                  <dd className="text-sm text-gray-900">{usdcToWeth} WETH</dd>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-gray-100 pt-3">
            <dt className="text-sm font-medium text-gray-600">Total LP Supply</dt>
            <dd className="text-sm text-gray-900">
              {totalSupplyResult !== undefined
                ? formatUnits(totalSupplyResult, 18)
                : '—'}
            </dd>
          </div>

          {/* User Pool Share */}
          {isConnected &&
            userLpBalance !== undefined &&
            totalSupplyResult !== undefined &&
            totalSupplyResult > 0n && (
              <div className="flex items-center justify-between">
                <dt className="text-sm font-medium text-gray-600">
                  Your Pool Share
                </dt>
                <dd className="text-sm">
                  {userLpBalance === 0n ? (
                    <span className="text-gray-400">0%</span>
                  ) : (
                    <span className="text-indigo-600 font-semibold">
                      {(() => {
                        const share =
                          (Number(userLpBalance) / Number(totalSupplyResult)) *
                          100
                        return share < 0.01 ? '<0.01' : share.toFixed(2)
                      })()}
                      %
                    </span>
                  )}
                </dd>
              </div>
            )}
        </dl>
      )}
    </section>
  )
}
