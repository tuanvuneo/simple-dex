'use client'

import { useState } from 'react'
import { ConnectButton } from '@/components/ConnectButton'
import { TokenBalances } from '@/components/TokenBalances'
import { PoolStats } from '@/components/PoolStats'
import { SwapPanel } from '@/components/SwapPanel'
import { LiquidityPanel } from '@/components/LiquidityPanel'
import { EducationalMath } from '@/components/EducationalMath'

export default function Home() {
  const [activeFormTab, setActiveFormTab] = useState<'swap' | 'liquidity'>('swap')
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  const triggerRefresh = () => {
    setRefreshTrigger((prev) => prev + 1)
  }

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 pb-16">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white sticky top-0 z-50 shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 bg-indigo-600 rounded-lg flex items-center justify-between p-1">
              <span className="text-white text-xs font-bold tracking-tight">DEX</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
              SimpleDEX
            </h1>
          </div>
          <ConnectButton />
        </div>
      </header>

      {/* Main content */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* LEFT COLUMN: Actions Panel (Tab switcher between Swap and Liquidity) */}
          <div className="lg:col-span-6 space-y-6">
            <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="flex border-b border-gray-200 bg-gray-50">
                <button
                  type="button"
                  onClick={() => setActiveFormTab('swap')}
                  className={`flex-1 py-3.5 text-center text-sm font-semibold transition border-b-2 ${
                    activeFormTab === 'swap'
                      ? 'border-indigo-600 text-indigo-600 bg-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  Swap Tokens
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFormTab('liquidity')}
                  className={`flex-1 py-3.5 text-center text-sm font-semibold transition border-b-2 ${
                    activeFormTab === 'liquidity'
                      ? 'border-indigo-600 text-indigo-600 bg-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  Manage Liquidity
                </button>
              </div>

              <div className="p-1 bg-white">
                {activeFormTab === 'swap' ? (
                  <SwapPanel onSwapSuccess={triggerRefresh} />
                ) : (
                  <LiquidityPanel onSuccess={triggerRefresh} />
                )}
              </div>
            </div>

            {/* Informational note */}
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs sm:text-sm text-blue-700">
              <strong>Local Development Mode:</strong> Connecting to Anvil chain (ID 31337). 
              Please ensure your wallet is connected to your local RPC <code className="bg-blue-100 px-1 py-0.5 rounded font-mono">http://127.0.0.1:8545</code>.
            </div>
          </div>

          {/* RIGHT COLUMN: Info Dashboard & DeFi Math Lab */}
          <div className="lg:col-span-6 space-y-6">
            {/* Top Row: Balances and Stats side-by-side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6" key={refreshTrigger}>
              <TokenBalances />
              <PoolStats />
            </div>

            {/* Bottom Row: Educational Math Dashboard */}
            <EducationalMath />
          </div>
        </div>
      </div>
    </main>
  )
}
