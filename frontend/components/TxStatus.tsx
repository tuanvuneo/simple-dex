'use client'

import { useWaitForTransactionReceipt, type BaseError } from 'wagmi'

interface TxStatusProps {
  hash: `0x${string}` | undefined
}

export function TxStatus({ hash }: TxStatusProps) {
  const { isLoading, isSuccess, isError, error } =
    useWaitForTransactionReceipt({ hash })

  if (!hash) return null

  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800"
      >
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-yellow-400 border-t-transparent" />
        Transaction submitted, waiting for confirmation...
      </div>
    )
  }

  if (isSuccess) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
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
        Transaction confirmed!
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
        className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
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
      className="flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800"
    >
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-yellow-400 border-t-transparent" />
      Transaction pending...
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
