'use client'

import { useWaitForTransactionReceipt, type BaseError } from 'wagmi'
import { getExplorerTxLink } from '@/lib/constants'

interface TxStatusProps {
  hash: `0x${string}` | undefined
}

export function TxStatus({ hash }: TxStatusProps) {
  const { isLoading, isSuccess, isError, error } =
    useWaitForTransactionReceipt({ hash })

  if (!hash) return null

  const explorerUrl = getExplorerTxLink(hash)

  const renderStatus = () => {
    if (isLoading) {
      return (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-t-lg border border-b-0 border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800"
        >
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-yellow-400 border-t-transparent" />
          <span>Transaction submitted, waiting for confirmation...</span>
        </div>
      )
    }

    if (isSuccess) {
      return (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-t-lg border border-b-0 border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
        >
          <svg
            className="h-4 w-4 flex-shrink-0 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span>Transaction confirmed!</span>
        </div>
      )
    }

    if (isError) {
      const message =
        (error as BaseError | null)?.shortMessage ??
        (error as Error | null)?.message ??
        'Unknown error'
      return (
        <div
          role="status"
          aria-live="polite"
          className="rounded-t-lg border border-b-0 border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          Transaction failed: {message}
        </div>
      )
    }

    // Submitted but receipt not yet tracked (edge case)
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 rounded-t-lg border border-b-0 border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800"
      >
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-yellow-400 border-t-transparent" />
        <span>Transaction pending...</span>
      </div>
    )
  }

  // Choose styling to match status
  let borderClass = 'border-yellow-200'
  let bgClass = 'bg-yellow-50/50'
  if (isSuccess) {
    borderClass = 'border-green-200'
    bgClass = 'bg-green-50/50'
  } else if (isError) {
    borderClass = 'border-red-200'
    bgClass = 'bg-red-50/50'
  }

  return (
    <div className="flex flex-col shadow-xs mt-3">
      {renderStatus()}
      <div className={`rounded-b-lg border border-t-0 ${borderClass} ${bgClass} px-4 py-2.5 text-xs flex flex-col sm:flex-row justify-between sm:items-center gap-2`}>
        <span className="text-gray-500 font-mono select-all truncate max-w-full sm:max-w-[280px]">
          Hash: {hash}
        </span>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-600 hover:text-indigo-800 hover:underline font-semibold flex items-center gap-1 shrink-0 self-end sm:self-auto"
        >
          View on Otterscan
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>
    </div>
  )
}


// ─── QueryStatus ─────────────────────────────────────────────────────────────
// Lightweight status component for read query states (used by Phase 4 data components).

interface QueryStatusProps {
  isPending: boolean
  error: Error | null
}

export function QueryStatus({ isPending, error }: QueryStatusProps) {
  if (isPending) {
    return (
      <p role="status" aria-live="polite" className="animate-pulse text-sm text-gray-500">
        Loading...
      </p>
    )
  }

  if (error) {
    const message =
      (error as BaseError | null)?.shortMessage ?? error.message
    return (
      <p role="status" aria-live="polite" className="text-sm text-red-600">
        Error: {message}
      </p>
    )
  }

  return null
}
