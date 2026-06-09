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

  const [, setActiveLiquidity] = useState<{
    activeTab: 'add' | 'remove'
    wethInput: string
    usdcInput: string
    lpInput: string
    wethReturned: string
    usdcReturned: string
    lpEstimated: string
  } | null>(null)

  useEffect(() => {
    const handleSwapChange = (e: Event) => {
      const customEvent = e as CustomEvent
      setActiveSwap(customEvent.detail)
    }

    const handleLiqChange = (e: Event) => {
      const customEvent = e as CustomEvent
      setActiveLiquidity(customEvent.detail)
    }

    window.addEventListener('activeSwapChanged', handleSwapChange)
    window.addEventListener('activeLiquidityChanged', handleLiqChange)

    return () => {
      window.removeEventListener('activeSwapChanged', handleSwapChange)
      window.removeEventListener('activeLiquidityChanged', handleLiqChange)
    }
  }, [])

  // --- Impermanent Loss Calculator State ---
  const [priceRatio, setPriceRatio] = useState<number>(1.0) // 1.0 = 100% (no price change)

  // IL = (2 * sqrt(r)) / (1 + r) - 1
  const ilVal = (2 * Math.sqrt(priceRatio)) / (1 + priceRatio) - 1
  const ilPercent = (ilVal * 100).toFixed(2)

  // Hold Value vs LP Value assuming initial pool weight is 50/50 WETH/USDC
  const holdValue = (1 + priceRatio) / 2
  const lpValue = Math.sqrt(priceRatio)


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
                {wethResNum.toFixed(2)} x<sub>WETH</sub>
              </span>
              <span className="text-gray-400">×</span>
              <span className="text-gray-600">
                {usdcResNum.toFixed(2)} y<sub>USDC</sub>
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
                {(parseFloat(activeSwap.inputAmount) * 0.003).toFixed(6)} {activeSwap.inputToken}
              </p>
              <p className="text-[11px] font-semibold text-green-700">
                dx<sub>eff</sub> = {activeSwap.inputAmount} × 0.997 ={' '}
                {(parseFloat(activeSwap.inputAmount) * 0.997).toFixed(6)} {activeSwap.inputToken}
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
                  x (Reserve In) = {parseFloat(activeSwap.reserveIn).toFixed(4)}
                </div>
                <div>
                  y (Reserve Out) = {parseFloat(activeSwap.reserveOut).toFixed(2)}
                </div>
                <div className="mt-1.5 pt-1.5 border-t border-dashed border-gray-200 text-indigo-700 font-bold">
                  dy = ({(parseFloat(activeSwap.inputAmount) * 0.997).toFixed(4)} ×{' '}
                  {parseFloat(activeSwap.reserveOut).toFixed(2)}) / (
                  {parseFloat(activeSwap.reserveIn).toFixed(4)} +{' '}
                  {(parseFloat(activeSwap.inputAmount) * 0.997).toFixed(4)})
                </div>
                <div className="mt-0.5 text-indigo-800 font-bold">
                  dy = {parseFloat(activeSwap.amountOut).toFixed(4)} {activeSwap.inputToken === 'WETH' ? 'USDC' : 'WETH'}
                </div>
              </div>
            </div>

            {/* Step 3: Gas Secret */}
            <div className="border-t border-gray-200 pt-2.5 font-sans">
              <p className="font-semibold text-gray-700">3. Gas Secret: Transfer-then-Call</p>
              <p className="text-[11px] text-gray-500 leading-normal mt-0.5 font-sans">
                Notice that the UI didn{"'"}t prompt you for a standard ERC20 {"\""}Approve{"\""} transaction! By sending your tokens directly using <code className="font-mono bg-gray-100 px-1 py-0.5 rounded text-indigo-700">transfer</code>, the Pool contract automatically evaluates balance differences before running swap calculations. This saves ~45,000 gas per trade compared to Router contracts!
              </p>
            </div>
          </div>
        </div>
      )}

      {/* --- SECTION 3: Impermanent Loss Simulator --- */}
      <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-4 space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold text-amber-900 uppercase tracking-wider">
            Impermanent Loss Simulator
          </h3>
          <span className="text-xs px-2 py-0.5 bg-amber-100 rounded-full font-mono text-amber-800">
            LP vs HODL
          </span>
        </div>
        <div className="text-xs text-amber-950">
          <p className="leading-relaxed">
            Impermanent Loss happens when the price ratio of WETH/USDC changes after you pool them, compared to simply holding WETH and USDC in your wallet.
          </p>
        </div>

        {/* Price Slider */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs font-semibold text-amber-900 font-mono">
            <span>Price Change ratio:</span>
            <span className="font-bold">
              {(priceRatio * 100).toFixed(0)}% ({priceRatio < 1.0 ? '' : '+'}{(priceRatio * 100 - 100).toFixed(0)}%)
            </span>
          </div>
          <input
            type="range"
            min="0.1"
            max="5.0"
            step="0.05"
            value={priceRatio}
            onChange={(e) => setPriceRatio(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-amber-200 rounded-lg appearance-none cursor-pointer accent-amber-600"
          />
          <div className="flex justify-between text-[9px] text-amber-600 uppercase font-bold font-mono">
            <span>-90% Drop</span>
            <span>Current Price</span>
            <span>5x Jump</span>
          </div>
        </div>

        {/* Results display */}
        <div className="rounded border border-amber-100 bg-white p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500 font-medium font-sans">Holding 50/50 portfolio value:</span>
            <span className="font-mono text-gray-900 font-bold">${holdValue.toFixed(4)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500 font-medium font-sans">AMM Liquidity Position value:</span>
            <span className="font-mono text-indigo-700 font-bold">${lpValue.toFixed(4)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-amber-100 pt-2 text-xs">
            <span className="font-semibold text-amber-900">Impermanent Loss:</span>
            <span className={`font-mono font-bold ${priceRatio === 1 ? 'text-green-600' : 'text-red-600'}`}>
              {priceRatio === 1 ? '0.00%' : `${ilPercent}%`}
            </span>
          </div>

          <p className="text-[10px] text-gray-500 leading-normal pt-1 font-sans">
            {priceRatio === 1 ? (
              '✅ Price is unchanged. No impermanent loss!'
            ) : (
              <span>
                ⚠️ If WETH price moves to{' '}
                <strong className="text-amber-800">
                  {priceRatio.toFixed(2)}x
                </strong>{' '}
                and you withdraw, you receive{' '}
                <strong className="text-red-700">
                  {Math.abs(parseFloat(ilPercent))}% less value
                </strong>{' '}
                than if you had just kept the tokens in your wallet.
              </span>
            )}
          </p>
        </div>
      </div>
    </section>
  )
}
