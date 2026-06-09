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

interface SwapPanelProps {
  onSwapSuccess?: () => void
}

export function SwapPanel({ onSwapSuccess }: SwapPanelProps) {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()

  // State
  const [inputAmount, setInputAmount] = useState('')
  const [inputToken, setInputToken] = useState<'WETH' | 'USDC'>('WETH')
  const [isSwapping, setIsSwapping] = useState(false)
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

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
      // Balances
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
    ],
    query: { enabled: poolEnabled },
  })

  const reserves = poolData?.[0]?.result as readonly [bigint, bigint] | undefined
  const token0 = poolData?.[1]?.result as `0x${string}` | undefined
  const wethUserBal = poolData?.[3]?.result as bigint | undefined
  const usdcUserBal = poolData?.[4]?.result as bigint | undefined

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

  // Derived Calculations
  const outputToken = inputToken === 'WETH' ? 'USDC' : 'WETH'
  const inputDecimals = inputToken === 'WETH' ? WETH_DECIMALS : USDC_DECIMALS
  const outputDecimals = inputToken === 'WETH' ? USDC_DECIMALS : WETH_DECIMALS

  const reserveIn = inputToken === 'WETH' ? reserveWeth : reserveUsdc
  const reserveOut = inputToken === 'WETH' ? reserveUsdc : reserveWeth

  const userBalance = inputToken === 'WETH' ? wethUserBal : usdcUserBal

  let amountInBigInt = 0n
  try {
    if (inputAmount && !isNaN(Number(inputAmount))) {
      amountInBigInt = parseUnits(inputAmount, inputDecimals)
    }
  } catch {
    // Ignore parsing errors
  }

  // Calculate swap output: dy = (dx * 997 * y) / (x * 1000 + dx * 997)
  let amountOutBigInt = 0n
  let priceImpact = 0
  let minimumOutputBigInt = 0n

  if (amountInBigInt > 0n && reserveIn > 0n && reserveOut > 0n) {
    const amountInWithFee = amountInBigInt * 997n
    const numerator = amountInWithFee * reserveOut
    const denominator = reserveIn * 1000n + amountInWithFee
    amountOutBigInt = numerator / denominator

    // Slippage tolerance: 0.5% default for safety
    minimumOutputBigInt = (amountOutBigInt * 995n) / 1000n

    // Price impact: comparison of spot price vs execution price
    const spotPrice = Number(reserveOut) / 10**outputDecimals / (Number(reserveIn) / 10**inputDecimals)
    const executionPrice = Number(amountOutBigInt) / 10**outputDecimals / (Number(amountInBigInt) / 10**inputDecimals)
    priceImpact = ((spotPrice - executionPrice) / spotPrice) * 100
  }

  const formattedOutput = amountOutBigInt > 0n ? formatUnits(amountOutBigInt, outputDecimals) : '0'
  const parsedFormattedOutput = parseFloat(formattedOutput).toFixed(4)

  const handleSwap = async () => {
    if (!publicClient) {
      setErrorMsg('Blockchain client not available.')
      return
    }
    if (!isConnected || !address) {
      setErrorMsg('Please connect your wallet first.')
      return
    }
    if (amountInBigInt <= 0n) {
      setErrorMsg('Please enter a valid amount.')
      return
    }
    if (userBalance === undefined || userBalance < amountInBigInt) {
      setErrorMsg(`Insufficient ${inputToken} balance.`)
      return
    }

    try {
      setIsSwapping(true)
      setErrorMsg(null)
      setTxHash(undefined)

      const inputTokenAddress = inputToken === 'WETH' ? WETH_ADDRESS : USDC_ADDRESS

      // Step 1: Transfer input tokens to the pool contract
      console.log(`Step 1: Transferring ${inputAmount} ${inputToken} to the Pool...`)
      const transferHash = await writeContractAsync({
        address: inputTokenAddress,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [POOL_ADDRESS, amountInBigInt],
      })

      // Wait for the transfer transaction to be mined
      await publicClient.waitForTransactionReceipt({ hash: transferHash })
      console.log('Transfer confirmed!')

      // Step 2: Call swap on the pool contract
      // Determine token0/token1 output amounts
      const amount0Out = wethIsToken0
        ? (inputToken === 'WETH' ? 0n : minimumOutputBigInt) // If inputting USDC (token1), we get token0 (WETH)
        : (inputToken === 'WETH' ? minimumOutputBigInt : 0n)

      const amount1Out = wethIsToken0
        ? (inputToken === 'WETH' ? minimumOutputBigInt : 0n) // If inputting WETH (token0), we get token1 (USDC)
        : (inputToken === 'WETH' ? 0n : minimumOutputBigInt)

      console.log(`Step 2: Executing Swap on Pool: swap(${amount0Out}, ${amount1Out}, ${address})...`)
      const swapHash = await writeContractAsync({
        address: POOL_ADDRESS,
        abi: poolAbi,
        functionName: 'swap',
        args: [amount0Out, amount1Out, address],
      })

      setTxHash(swapHash)
      await publicClient.waitForTransactionReceipt({ hash: swapHash })
      
      // Clean up input & refetch state
      setInputAmount('')
      refetchPool()
      if (onSwapSuccess) onSwapSuccess()
    } catch (err: unknown) {
      const error = err as { shortMessage?: string; message?: string }
      console.error(err)
      setErrorMsg(error.shortMessage || error.message || 'Transaction failed.')
    } finally {
      setIsSwapping(false)
    }
  }

  const switchTokens = () => {
    setInputToken(inputToken === 'WETH' ? 'USDC' : 'WETH')
    setInputAmount('')
    setErrorMsg(null)
  }

  // Trigger event dispatch to notify educational panel of changes
  useEffect(() => {
    const event = new CustomEvent('activeSwapChanged', {
      detail: {
        inputAmount,
        inputToken,
        amountOut: formattedOutput,
        priceImpact,
        reserveIn: formatUnits(reserveIn, inputDecimals),
        reserveOut: formatUnits(reserveOut, outputDecimals),
      },
    })
    window.dispatchEvent(event)
  }, [inputAmount, inputToken, formattedOutput, priceImpact, reserveIn, reserveOut, inputDecimals, outputDecimals])

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">Swap Tokens</h2>

      {!isConnected ? (
        <p className="text-sm text-gray-500">Connect wallet to start swapping.</p>
      ) : (
        <div className="space-y-4">
          {/* Input Field */}
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Pay with</span>
              <span>
                Balance:{' '}
                {userBalance !== undefined
                  ? parseFloat(formatUnits(userBalance, inputDecimals)).toFixed(4)
                  : '—'}{' '}
                {inputToken}
              </span>
            </div>
            <div className="relative flex rounded-md shadow-sm">
              <input
                type="number"
                placeholder="0.0"
                value={inputAmount}
                disabled={isSwapping}
                onChange={(e) => {
                  setInputAmount(e.target.value)
                  setErrorMsg(null)
                }}
                className="block w-full rounded-l-md border-gray-300 pr-12 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2.5 border"
              />
              <button
                type="button"
                onClick={switchTokens}
                disabled={isSwapping}
                className="inline-flex items-center rounded-r-md border border-l-0 border-gray-300 bg-gray-50 px-3 text-sm text-gray-500 hover:bg-gray-100"
              >
                {inputToken} ⇅
              </button>
            </div>
          </div>

          {/* Switch Button */}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={switchTokens}
              disabled={isSwapping}
              className="rounded-full bg-gray-100 p-2 hover:bg-gray-200 text-gray-600 transition"
              aria-label="Switch input and output tokens"
            >
              ⇅
            </button>
          </div>

          {/* Output Field */}
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Receive (estimated)</span>
            </div>
            <div className="relative flex rounded-md shadow-sm">
              <input
                type="text"
                readOnly
                placeholder="0.0"
                value={parsedFormattedOutput === '0.0000' ? '' : parsedFormattedOutput}
                className="block w-full rounded-md border-gray-300 bg-gray-50 p-2.5 border sm:text-sm text-gray-500"
              />
              <span className="absolute right-3 top-3 text-sm text-gray-500 font-medium">
                {outputToken}
              </span>
            </div>
          </div>

          {/* Trade Details Preview */}
          {amountInBigInt > 0n && reserveIn > 0n && (
            <div className="rounded-lg bg-gray-50 p-3 text-xs space-y-2 border border-gray-100">
              <div className="flex justify-between">
                <span className="text-gray-500">Rate:</span>
                <span>
                  1 {inputToken} ={' '}
                  {(
                    Number(amountOutBigInt) /
                    10**outputDecimals /
                    (Number(amountInBigInt) / 10**inputDecimals)
                  ).toFixed(inputToken === 'WETH' ? 2 : 6)}{' '}
                  {outputToken}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Price Impact:</span>
                <span className={priceImpact > 5 ? 'text-red-500 font-medium' : 'text-gray-900'}>
                  {priceImpact.toFixed(2)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Slippage Tolerance:</span>
                <span>0.5%</span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-2 font-medium">
                <span className="text-gray-600">Minimum Received:</span>
                <span>
                  {parseFloat(formatUnits(minimumOutputBigInt, outputDecimals)).toFixed(4)}{' '}
                  {outputToken}
                </span>
              </div>
            </div>
          )}

          {/* Action Button */}
          <button
            type="button"
            onClick={handleSwap}
            disabled={isSwapping || amountInBigInt === 0n}
            className="w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition"
          >
            {isSwapping ? 'Executing Swaps (2 steps)...' : 'Swap'}
          </button>

          {/* Status & Errors */}
          {errorMsg && <p className="text-xs text-red-600 mt-2">{errorMsg}</p>}
          <TxStatus hash={txHash} />
        </div>
      )}
    </div>
  )
}
