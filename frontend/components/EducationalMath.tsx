'use client'

import { useState, useEffect } from 'react'
import { useReadContracts } from 'wagmi'
import { formatUnits } from 'viem'
import { poolAbi } from '@/abi/Pool'
import {
  POOL_ADDRESS,
  WETH_ADDRESS,
  WETH_DECIMALS,
  USDC_DECIMALS,
} from '@/lib/constants'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export function EducationalMath() {
  const poolEnabled = POOL_ADDRESS !== ZERO_ADDRESS

  // --- Live Pool Data ---
  const { data: poolData } = useReadContracts({
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
    ],
    query: { enabled: poolEnabled, refetchInterval: 5000 },
  })

  const reserves = poolData?.[0]?.result as readonly [bigint, bigint] | undefined
  const token0 = poolData?.[1]?.result as `0x${string}` | undefined
  const wethIsToken0 = token0?.toLowerCase() === WETH_ADDRESS.toLowerCase()

  const reserveWeth = reserves ? (wethIsToken0 ? reserves[0] : reserves[1]) : 0n
  const reserveUsdc = reserves ? (wethIsToken0 ? reserves[1] : reserves[0]) : 0n

  const wethResNum = parseFloat(formatUnits(reserveWeth, WETH_DECIMALS))
  const usdcResNum = parseFloat(formatUnits(reserveUsdc, USDC_DECIMALS))
  const liveK = wethResNum * usdcResNum

  // --- Active Interactive Form State (from custom window events) ---
  const [activeSwap, setActiveSwap] = useState<{
    inputAmount: string
    inputToken: string
    amountOut: string
    priceImpact: number
    reserveIn: string
    reserveOut: string
  } | null>(null)

  useEffect(() => {
    const handleSwapChange = (e: Event) => {
      const customEvent = e as CustomEvent
      setActiveSwap(customEvent.detail)
    }

    window.addEventListener('activeSwapChanged', handleSwapChange)

    return () => {
      window.removeEventListener('activeSwapChanged', handleSwapChange)
    }
  }, [])

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">DeFi Math Lab</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          See the mathematical mechanics under the hood of constant product AMMs.
        </p>
      </div>

      {/* --- SECTION 1: x * y = k Invariant --- */}
      <div className="rounded-lg border border-indigo-50 bg-indigo-50/50 p-4 space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold text-indigo-900 uppercase tracking-wider">
            Constant Product Formula
          </h3>
          <span className="text-xs px-2 py-0.5 bg-indigo-100 rounded-full font-mono text-indigo-800">
            x * y = k
          </span>
        </div>
        <div className="text-xs text-indigo-950 leading-relaxed">
          <p>
            The core engine of this AMM is the equation <code className="font-semibold font-mono">x * y = k</code>, where:
          </p>
          <ul className="list-disc pl-4 mt-1 space-y-1">
            <li><code className="font-semibold font-mono">x</code> is the WETH reserve balance in the pool.</li>
            <li><code className="font-semibold font-mono">y</code> is the USDC reserve balance in the pool.</li>
            <li><code className="font-semibold font-mono">k</code> is the invariant constant.</li>
          </ul>
        </div>

        {poolEnabled && liveK > 0 && (
          <div className="rounded border border-indigo-100 bg-white p-3 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">
              Live Pool Invariant
            </p>
            <div className="flex flex-wrap items-center justify-between text-xs font-mono font-medium text-indigo-950 gap-2">
              <span className="text-gray-600">
                {wethResNum.toFixed(8)} x<sub>WETH</sub>
              </span>
              <span className="text-gray-400">×</span>
              <span className="text-gray-600">
                {usdcResNum.toFixed(6)} y<sub>USDC</sub>
              </span>
              <span className="text-gray-400">=</span>
              <span className="text-indigo-600 font-bold bg-indigo-50 px-1.5 py-0.5 rounded">
                k = {liveK.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <p className="text-[10px] text-gray-500 leading-normal">
              💡 Swaps trade along the curve, keeping <code className="font-mono text-indigo-600">k</code> constant (or slightly growing due to the 0.3% fee!). Adding liquidity multiplies both sides, shifting the curve outward.
            </p>
          </div>
        )}
      </div>

      {/* --- SECTION 2: Dynamic Trade Breakdown --- */}
      {activeSwap && activeSwap.inputAmount && parseFloat(activeSwap.inputAmount) > 0 && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wider">
            Live Swap Math Breakdown
          </h3>

          <div className="text-xs space-y-3 text-gray-600 font-mono">
            {/* Step 1: Fee */}
            <div>
              <p className="font-sans font-semibold text-gray-700">1. Deduct 0.3% Swap Fee</p>
              <p className="text-[11px] mt-1">
                dx (Input) = {activeSwap.inputAmount} {activeSwap.inputToken}
              </p>
              <p className="text-[11px]">
                Fee = {activeSwap.inputAmount} × 0.003 ={' '}
                {(parseFloat(activeSwap.inputAmount) * 0.003).toFixed(8)} {activeSwap.inputToken}
              </p>
              <p className="text-[11px] font-semibold text-green-700">
                dx<sub>eff</sub> = {activeSwap.inputAmount} × 0.997 ={' '}
                {(parseFloat(activeSwap.inputAmount) * 0.997).toFixed(8)} {activeSwap.inputToken}
              </p>
            </div>

            {/* Step 2: Swap formula */}
            <div className="border-t border-gray-200 pt-2.5">
              <p className="font-sans font-semibold text-gray-700">2. Apply Constant Product Invariant</p>
              <p className="text-[10px] text-gray-500 font-sans italic my-1">
                Formula: dy = (dx_eff * y) / (x + dx_eff)
              </p>
              <div className="bg-white p-2 rounded border border-gray-100 text-[11px] leading-relaxed">
                <div>
                  x (Reserve In) = {parseFloat(activeSwap.reserveIn).toFixed(8)}
                </div>
                <div>
                  y (Reserve Out) = {parseFloat(activeSwap.reserveOut).toFixed(6)}
                </div>
                <div className="mt-1.5 pt-1.5 border-t border-dashed border-gray-200 text-indigo-700 font-bold">
                  dy = ({(parseFloat(activeSwap.inputAmount) * 0.997).toFixed(8)} ×{' '}
                  {parseFloat(activeSwap.reserveOut).toFixed(6)}) / (
                  {parseFloat(activeSwap.reserveIn).toFixed(8)} +{' '}
                  {(parseFloat(activeSwap.inputAmount) * 0.997).toFixed(8)})
                </div>
                <div className="mt-0.5 text-indigo-800 font-bold">
                  dy = {parseFloat(activeSwap.amountOut).toFixed(8)} {activeSwap.inputToken === 'WETH' ? 'USDC' : 'WETH'}
                </div>
              </div>
            </div>

          </div>
        </div>
      )}
    </section>
  )
}
