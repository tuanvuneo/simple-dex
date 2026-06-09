# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SimpleDEX is a constant product AMM (x*y=k) inspired by Uniswap V2, built as an educational DeFi project. It has two parts: Solidity smart contracts (Foundry) and a Next.js frontend.

## Commands

### Smart Contracts (Foundry)

```bash
forge build                                          # Compile contracts
forge test                                           # Run all tests (~70 cases, includes fuzz/invariant)
forge test -vvv                                      # Verbose test output
forge test --match-path "test/core/Pool.t.sol"       # Run tests in a specific file
forge test --match-test "test_SwapExactInput"         # Run a single test by name
forge test --match-contract PoolFuzz                  # Run all tests in a contract
forge test --gas-report                              # Run tests with gas reporting
forge fmt                                            # Format Solidity code
forge fmt --check                                    # Check formatting (used in CI)
```

### Frontend (Next.js, in `frontend/` directory)

```bash
cd frontend
npm run dev       # Dev server at http://localhost:3000
npm run build     # Production build (also validates TypeScript)
npm run lint      # ESLint
```

### Static Analysis

```bash
slither .         # Run Slither (config in slither.config.json)
```

### Local Development Chain

```bash
anvil             # Start local EVM node (chainId 31337)
```

## Architecture

### Smart Contracts (`src/`)

- **`src/core/Pool.sol`** — The AMM pool. Pool IS the LP token (inherits ERC20). Uses transfer-then-call pattern: users transfer tokens to the pool, then call `mint`/`swap`/`burn` which detect balance changes. 0.3% swap fee enforced via the x*y=k invariant check. Reserves stored as `uint112` for storage packing (both fit in one slot). Protected by `ReentrancyGuard` + CEI pattern.
- **`src/core/Factory.sol`** — Creates pools via CREATE2 with deterministic addresses. Enforces canonical token ordering (`token0 < token1`). Owner-only pool creation.
- **`src/tokens/WETH.sol`** — Wrapped ETH (18 decimals, 1000 initial supply). Has `deposit()`/`withdraw()` for ETH wrapping and a permissionless `faucet()`.
- **`src/tokens/MockUSDC.sol`** — Mock USDC (6 decimals, 2M initial supply). Has a permissionless `faucet()`.

Key interaction pattern (Uniswap V2 style):
```
ERC20.transfer(tokens → pool) → pool.mint(to) / pool.swap(amounts, to) / pool.burn(to)
```

### Tests (`test/`)

- **`test/core/Pool.t.sol`** — Unit tests for all pool operations (swap, mint, burn, edge cases)
- **`test/core/Factory.t.sol`** — Pool creation, duplicate prevention, access control
- **`test/core/Integration.t.sol`** — End-to-end with real WETH/MockUSDC tokens
- **`test/core/PoolFuzz.t.sol`** — Fuzz testing (10,000 runs)
- **`test/core/PoolInvariant.t.sol`** — Stateful invariant testing (x*y=k holds)
- **`test/core/PoolReentrancy.t.sol`** — Reentrancy attack prevention

### Frontend (`frontend/`)

Next.js 16 with App Router, React 19, Tailwind CSS v4, React Compiler enabled.

- **Provider stack** (`app/providers.tsx`): `WagmiProvider > QueryClientProvider > RainbowKitProvider` — client component boundary, configured for Anvil chain (31337) with `ssr: true`
- **`app/layout.tsx`** is a Server Component wrapping children with Providers. `app/page.tsx` is also a Server Component.
- **`abi/Pool.ts`** and **`abi/ERC20.ts`** — TypeScript ABIs with `as const` for wagmi type inference. Pool ABI's `getAmountOut` takes 3 args: `(amountIn, reserveIn, reserveOut)`.
- **`lib/constants.ts`** — Contract addresses from env vars (`NEXT_PUBLIC_*`), zero-address defaults until deployment.
- **Components** use `useReadContracts` for batched multicall reads, gated on wallet connection and non-zero contract addresses.

## Key Conventions

- Solidity 0.8.28, OpenZeppelin v5.x (`@openzeppelin/=lib/openzeppelin-contracts/`)
- CI runs: `forge fmt --check` → `forge build --sizes` → `forge test -vvv`
- Frontend uses `@/*` path alias for imports from the `frontend/` root
- Token decimals: WETH=18, MockUSDC=6, LP tokens=18
- `QueryClient` must be created inside `useState` in providers (SSR safety)
- Frontend components must handle four states: loading, error, disconnected wallet, contracts not deployed
