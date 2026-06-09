'use client'

import { useState, useEffect } from 'react'
import { useAccount, useReadContracts, useWriteContract, usePublicClient } from 'wagmi'
import { parseUnits, formatUnits } from 'viem'
import { erc20Abi } from '@/abi/ERC20'
import { poolAbi } from '@/abi/Pool'
import {
  POOL_ADDRESS,
  WETH_ADDRESS,
  USDC_ADDRESS,
  WETH_DECIMALS,
  USDC_DECIMALS,
} from '@/lib/constants'
import { TxStatus } from '@/components/TxStatus'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// Simple BigInt square root helper
function bigintSqrt(value: bigint): bigint {
  if (value < 0n) throw new Error('negative value')
  if (value < 2n) return value
  let x0 = value / 2n
  let x1 = (x0 + value / x0) / 2n
  while (x1 < x0) {
    x0 = x1
    x1 = (x0 + value / x0) / 2n
  }
  return x0
}

interface LiquidityPanelProps {
  onSuccess?: () => void
}

export function LiquidityPanel({ onSuccess }: LiquidityPanelProps) {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()

  // Tab State: 'add' or 'remove'
  const [activeTab, setActiveTab] = useState<'add' | 'remove'>('add')

  // Add Liquidity State
  const [wethInput, setWethInput] = useState('')
  const [usdcInput, setUsdcInput] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [addTxHash, setAddTxHash] = useState<`0x${string}` | undefined>(undefined)
  const [addError, setAddError] = useState<string | null>(null)

  // Remove Liquidity State
  const [lpInput, setLpInput] = useState('')
  const [isRemoving, setIsRemoving] = useState(false)
  const [removeTxHash, setRemoveTxHash] = useState<`0x${string}` | undefined>(undefined)
  const [removeError, setRemoveError] = useState<string | null>(null)

  // Contract Reads
  const poolEnabled = POOL_ADDRESS !== ZERO_ADDRESS

  const { data: poolData, refetch: refetchPool } = useReadContracts({
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
      // Balances & Total Supply
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
      {
        address: POOL_ADDRESS,
        abi: poolAbi,
        functionName: 'totalSupply',
      },
    ],
    query: { enabled: poolEnabled },
  })

  const reserves = poolData?.[0]?.result as readonly [bigint, bigint] | undefined
  const token0 = poolData?.[1]?.result as `0x${string}` | undefined
  const wethUserBal = poolData?.[3]?.result as bigint | undefined
  const usdcUserBal = poolData?.[4]?.result as bigint | undefined
  const lpUserBal = poolData?.[5]?.result as bigint | undefined
  const totalSupply = poolData?.[6]?.result as bigint | undefined

  const wethIsToken0 = token0?.toLowerCase() === WETH_ADDRESS.toLowerCase()

  const reserveWeth = reserves
    ? wethIsToken0
      ? reserves[0]
      : reserves[1]
    : 0n
  const reserveUsdc = reserves
    ? wethIsToken0
      ? reserves[1]
      : reserves[0]
    : 0n

  const hasNoLiquidity = reserveWeth === 0n && reserveUsdc === 0n

  // Sync Input Proportions
  const handleWethChange = (val: string) => {
    setWethInput(val)
    setAddError(null)

    if (!val || isNaN(Number(val))) {
      setUsdcInput('')
      return
    }

    if (reserveWeth > 0n && reserveUsdc > 0n) {
      try {
        const wethUnits = parseUnits(val, WETH_DECIMALS)
        const usdcUnits = (wethUnits * reserveUsdc) / reserveWeth
        setUsdcInput(formatUnits(usdcUnits, USDC_DECIMALS))
      } catch {}
    }
  }

  const handleUsdcChange = (val: string) => {
    setUsdcInput(val)
    setAddError(null)

    if (!val || isNaN(Number(val))) {
      setWethInput('')
      return
    }

    if (reserveWeth > 0n && reserveUsdc > 0n) {
      try {
        const usdcUnits = parseUnits(val, USDC_DECIMALS)
        const wethUnits = (usdcUnits * reserveWeth) / reserveUsdc
        setWethInput(formatUnits(wethUnits, WETH_DECIMALS))
      } catch {}
    }
  }

  // LP Tokens Estimate
  let lpEstimatedBigInt = 0n
  let wethAmountBigInt = 0n
  let usdcAmountBigInt = 0n

  try {
    if (wethInput && !isNaN(Number(wethInput))) {
      wethAmountBigInt = parseUnits(wethInput, WETH_DECIMALS)
    }
    if (usdcInput && !isNaN(Number(usdcInput))) {
      usdcAmountBigInt = parseUnits(usdcInput, USDC_DECIMALS)
    }
  } catch {}

  if (wethAmountBigInt > 0n && usdcAmountBigInt > 0n) {
    if (totalSupply === 0n || hasNoLiquidity) {
      // First deposit formula: sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY (1000)
      const product = wethAmountBigInt * usdcAmountBigInt
      try {
        const root = bigintSqrt(product)
        if (root > 1000n) {
          lpEstimatedBigInt = root - 1000n
        }
      } catch {}
    } else {
      // Subsequent deposit formula: min((amount0 * totalSupply) / reserve0, (amount1 * totalSupply) / reserve1)
      const wethShare = (wethAmountBigInt * (totalSupply ?? 0n)) / reserveWeth
      const usdcShare = (usdcAmountBigInt * (totalSupply ?? 0n)) / reserveUsdc
      lpEstimatedBigInt = wethShare < usdcShare ? wethShare : usdcShare
    }
  }

  // Add Liquidity Submit
  const handleAddLiquidity = async () => {
    if (!publicClient) {
      setAddError('Blockchain client not available.')
      return
    }
    if (!isConnected || !address) return
    if (wethAmountBigInt <= 0n || usdcAmountBigInt <= 0n) {
      setAddError('Please enter valid token amounts.')
      return
    }
    if (wethUserBal === undefined || wethUserBal < wethAmountBigInt) {
      setAddError('Insufficient WETH balance.')
      return
    }
    if (usdcUserBal === undefined || usdcUserBal < usdcAmountBigInt) {
      setAddError('Insufficient USDC balance.')
      return
    }

    try {
      setIsAdding(true)
      setAddError(null)
      setAddTxHash(undefined)

      // Step 1: Transfer WETH to pool
      console.log('Adding Liquidity - Step 1: Transferring WETH to Pool...')
      const txWeth = await writeContractAsync({
        address: WETH_ADDRESS,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [POOL_ADDRESS, wethAmountBigInt],
      })
      await publicClient.waitForTransactionReceipt({ hash: txWeth })

      // Step 2: Transfer USDC to pool
      console.log('Adding Liquidity - Step 2: Transferring USDC to Pool...')
      const txUsdc = await writeContractAsync({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [POOL_ADDRESS, usdcAmountBigInt],
      })
      await publicClient.waitForTransactionReceipt({ hash: txUsdc })

      // Step 3: Mint LP tokens
      console.log('Adding Liquidity - Step 3: Minting LP Tokens...')
      const txMint = await writeContractAsync({
        address: POOL_ADDRESS,
        abi: poolAbi,
        functionName: 'mint',
        args: [address],
      })

      setAddTxHash(txMint)
      await publicClient.waitForTransactionReceipt({ hash: txMint })

      setWethInput('')
      setUsdcInput('')
      refetchPool()
      if (onSuccess) onSuccess()
    } catch (err: unknown) {
      const error = err as { shortMessage?: string; message?: string }
      console.error(err)
      setAddError(error.shortMessage || error.message || 'Transaction failed.')
    } finally {
      setIsAdding(false)
    }
  }

  // Remove Liquidity Calculations
  let lpAmountBigInt = 0n
  try {
    if (lpInput && !isNaN(Number(lpInput))) {
      lpAmountBigInt = parseUnits(lpInput, 18)
    }
  } catch {}

  let wethReturned = 0n
  let usdcReturned = 0n

  if (lpAmountBigInt > 0n && totalSupply && totalSupply > 0n) {
    wethReturned = (lpAmountBigInt * reserveWeth) / totalSupply
    usdcReturned = (lpAmountBigInt * reserveUsdc) / totalSupply
  }

  const setLpPercentage = (percent: number) => {
    if (!lpUserBal) return
    const amount = (lpUserBal * BigInt(percent)) / 100n
    setLpInput(formatUnits(amount, 18))
    setRemoveError(null)
  }

  // Remove Liquidity Submit
  const handleRemoveLiquidity = async () => {
    if (!publicClient) {
      setRemoveError('Blockchain client not available.')
      return
    }
    if (!isConnected || !address) return
    if (lpAmountBigInt <= 0n) {
      setRemoveError('Please enter a valid amount of LP tokens to burn.')
      return
    }
    if (lpUserBal === undefined || lpUserBal < lpAmountBigInt) {
      setRemoveError('Insufficient LP token balance.')
      return
    }

    try {
      setIsRemoving(true)
      setRemoveError(null)
      setRemoveTxHash(undefined)

      // Step 1: Transfer LP tokens to the pool contract
      console.log('Removing Liquidity - Step 1: Transferring LP tokens to Pool...')
      const txTransfer = await writeContractAsync({
        address: POOL_ADDRESS,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [POOL_ADDRESS, lpAmountBigInt],
      })
      await publicClient.waitForTransactionReceipt({ hash: txTransfer })

      // Step 2: Burn LP tokens to withdraw assets
      console.log('Removing Liquidity - Step 2: Burning LP tokens...')
      const txBurn = await writeContractAsync({
        address: POOL_ADDRESS,
        abi: poolAbi,
        functionName: 'burn',
        args: [address],
      })

      setRemoveTxHash(txBurn)
      await publicClient.waitForTransactionReceipt({ hash: txBurn })

      setLpInput('')
      refetchPool()
      if (onSuccess) onSuccess()
    } catch (err: unknown) {
      const error = err as { shortMessage?: string; message?: string }
      console.error(err)
      setRemoveError(error.shortMessage || error.message || 'Transaction failed.')
    } finally {
      setIsRemoving(false)
    }
  }

  // Trigger event dispatch to notify educational panel of changes
  useEffect(() => {
    const event = new CustomEvent('activeLiquidityChanged', {
      detail: {
        activeTab,
        wethInput,
        usdcInput,
        lpInput,
        reserveWeth: formatUnits(reserveWeth, WETH_DECIMALS),
        reserveUsdc: formatUnits(reserveUsdc, USDC_DECIMALS),
        totalSupply: formatUnits(totalSupply ?? 0n, 18),
      },
    })
    window.dispatchEvent(event)
  }, [activeTab, wethInput, usdcInput, lpInput, reserveWeth, reserveUsdc, totalSupply])

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      {/* Sub Tabs */}
      <div className="flex rounded-md bg-gray-100 p-1 mb-6">
        <button
          type="button"
          onClick={() => {
            setActiveTab('add')
            setAddError(null)
            setRemoveError(null)
          }}
          className={`flex-1 py-2 text-center text-xs font-semibold rounded-md transition ${
            activeTab === 'add'
              ? 'bg-white text-gray-900 shadow-xs'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Add Liquidity
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('remove')
            setAddError(null)
            setRemoveError(null)
          }}
          className={`flex-1 py-2 text-center text-xs font-semibold rounded-md transition ${
            activeTab === 'remove'
              ? 'bg-white text-gray-900 shadow-xs'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Remove Liquidity
        </button>
      </div>

      {!isConnected ? (
        <p className="text-sm text-gray-500">Connect wallet to manage liquidity.</p>
      ) : activeTab === 'add' ? (
        // Add Liquidity Tab
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Deposit WETH</span>
              <span>
                Balance:{' '}
                {wethUserBal !== undefined
                  ? parseFloat(formatUnits(wethUserBal, WETH_DECIMALS)).toFixed(4)
                  : '—'}
              </span>
            </div>
            <div className="relative flex rounded-md shadow-sm">
              <input
                type="number"
                placeholder="0.0"
                value={wethInput}
                disabled={isAdding}
                onChange={(e) => handleWethChange(e.target.value)}
                className="block w-full rounded-md border border-gray-300 p-2.5 sm:text-sm focus:border-indigo-500 focus:ring-indigo-500"
              />
              <span className="absolute right-3 top-3 text-sm text-gray-500 font-medium">
                WETH
              </span>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Deposit USDC</span>
              <span>
                Balance:{' '}
                {usdcUserBal !== undefined
                  ? parseFloat(formatUnits(usdcUserBal, USDC_DECIMALS)).toFixed(2)
                  : '—'}
              </span>
            </div>
            <div className="relative flex rounded-md shadow-sm">
              <input
                type="number"
                placeholder="0.0"
                value={usdcInput}
                disabled={isAdding}
                onChange={(e) => handleUsdcChange(e.target.value)}
                className="block w-full rounded-md border border-gray-300 p-2.5 sm:text-sm focus:border-indigo-500 focus:ring-indigo-500"
              />
              <span className="absolute right-3 top-3 text-sm text-gray-500 font-medium">
                USDC
              </span>
            </div>
          </div>

          {/* LP Tokens Mint Estimate */}
          {lpEstimatedBigInt > 0n && (
            <div className="rounded-lg bg-gray-50 p-3 text-xs space-y-2 border border-gray-100">
              <div className="flex justify-between font-medium">
                <span className="text-gray-600">Estimated LP Tokens:</span>
                <span>{parseFloat(formatUnits(lpEstimatedBigInt, 18)).toFixed(4)} SLP</span>
              </div>
              {hasNoLiquidity && (
                <p className="text-2xs text-blue-600 font-medium leading-normal pt-1">
                  💡 You are the first depositor. You set the initial pool price. 1000 LP tokens will be locked permanently.
                </p>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={handleAddLiquidity}
            disabled={isAdding || wethAmountBigInt === 0n || usdcAmountBigInt === 0n}
            className="w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:bg-gray-300 disabled:cursor-not-allowed transition"
          >
            {isAdding ? 'Adding Liquidity (3 steps)...' : 'Add Liquidity'}
          </button>

          {addError && <p className="text-xs text-red-600 mt-2">{addError}</p>}
          <TxStatus hash={addTxHash} />
        </div>
      ) : (
        // Remove Liquidity Tab
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Burn LP Tokens</span>
              <span>
                Available:{' '}
                {lpUserBal !== undefined ? parseFloat(formatUnits(lpUserBal, 18)).toFixed(4) : '—'}{' '}
                SLP
              </span>
            </div>
            <div className="relative flex rounded-md shadow-sm mb-2">
              <input
                type="number"
                placeholder="0.0"
                value={lpInput}
                disabled={isRemoving}
                onChange={(e) => {
                  setLpInput(e.target.value)
                  setRemoveError(null)
                }}
                className="block w-full rounded-md border border-gray-300 p-2.5 sm:text-sm focus:border-indigo-500 focus:ring-indigo-500"
              />
              <span className="absolute right-3 top-3 text-sm text-gray-500 font-medium">
                SLP
              </span>
            </div>

            {/* Percentage shortcuts */}
            <div className="flex gap-2">
              {[25, 50, 75, 100].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => setLpPercentage(pct)}
                  disabled={isRemoving || !lpUserBal || lpUserBal === 0n}
                  className="flex-1 rounded-md border border-gray-200 bg-gray-50 py-1.5 text-center text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50 transition"
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          {/* Returned assets preview */}
          {lpAmountBigInt > 0n && (
            <div className="rounded-lg bg-gray-50 p-3 text-xs space-y-2 border border-gray-100">
              <div className="flex justify-between">
                <span className="text-gray-500">Receive WETH:</span>
                <span className="font-semibold">
                  {parseFloat(formatUnits(wethReturned, WETH_DECIMALS)).toFixed(4)} WETH
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Receive USDC:</span>
                <span className="font-semibold">
                  {parseFloat(formatUnits(usdcReturned, USDC_DECIMALS)).toFixed(2)} USDC
                </span>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleRemoveLiquidity}
            disabled={isRemoving || lpAmountBigInt === 0n}
            className="w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:bg-gray-300 disabled:cursor-not-allowed transition"
          >
            {isRemoving ? 'Removing Liquidity (2 steps)...' : 'Remove Liquidity'}
          </button>

          {removeError && <p className="text-xs text-red-600 mt-2">{removeError}</p>}
          <TxStatus hash={removeTxHash} />
        </div>
      )}
    </div>
  )
}