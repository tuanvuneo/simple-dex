# SimpleDEX

A constant product AMM (automated market maker) implementing the x*y=k invariant with a 0.3% swap fee, built for learning DeFi mechanics. Includes Solidity smart contracts tested with Foundry and a Next.js frontend with wallet integration.

## Key Features

- **Constant product AMM** with x*y=k invariant and 0.3% swap fee
- **LP token system** where the Pool contract IS the LP token (Uniswap V2 pattern)
- **Deterministic pool deployment** via CREATE2 in the Factory contract
- **Comprehensive test suite** with unit, fuzz (10,000 runs), invariant, and reentrancy tests
- **Next.js frontend** with MetaMask wallet connection via RainbowKit and on-chain data display

## Tech Stack

- **Smart Contracts**: Solidity 0.8.28, OpenZeppelin v5
- **Contract Tooling**: Foundry (Forge, Anvil, Cast), Slither
- **Frontend**: Next.js 16, React 19, TypeScript 5, Tailwind CSS v4
- **Web3 Integration**: wagmi v2, viem v2, RainbowKit v2, TanStack Query v5
- **CI**: GitHub Actions (format check, build, test)

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (for smart contract compilation and testing)
- [Node.js](https://nodejs.org/) 20+ (for the frontend)
- [MetaMask](https://metamask.io/) or another browser wallet (for interacting with the frontend)

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/baotoq/simple-dex.git
cd simple-dex
```

### 2. Install Contract Dependencies

Foundry manages Solidity dependencies as git submodules:

```bash
git submodule update --init --recursive
```

### 3. Build and Test Smart Contracts

```bash
forge build
forge test
```

### 4. Start a Local Chain

```bash
anvil
```

This starts a local EVM node at `http://127.0.0.1:8545` with chainId 31337 and pre-funded test accounts.

### 5. Set Up the Frontend

```bash
cd frontend
npm install
```

Create the environment file (already exists with defaults for local development):

```bash
# frontend/.env.local
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=dev-project-id
```

After contracts are deployed, add their addresses:

```bash
NEXT_PUBLIC_POOL_ADDRESS=0x...
NEXT_PUBLIC_WETH_ADDRESS=0x...
NEXT_PUBLIC_USDC_ADDRESS=0x...
NEXT_PUBLIC_FACTORY_ADDRESS=0x...
```

### 6. Start the Frontend

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Connect MetaMask to the Anvil network (chainId 31337, RPC `http://127.0.0.1:8545`).

## Architecture

### Smart Contracts

```
src/
├── core/
│   ├── Pool.sol         # AMM pool with swap/mint/burn + IS the LP token (ERC20)
│   └── Factory.sol      # Creates pools via CREATE2, bidirectional pair registry
└── tokens/
    ├── WETH.sol          # Wrapped ETH (18 decimals, deposit/withdraw, faucet)
    └── MockUSDC.sol      # Mock USDC (6 decimals, faucet)
```

**Pool** is the core contract. It inherits ERC20, so the pool contract itself is the LP token. Users interact via the transfer-then-call pattern: transfer tokens to the pool address, then call `mint()`, `swap()`, or `burn()`. The pool detects deposited amounts by comparing its token balances against stored reserves.

Key mechanics:
- **Swap fee**: 0.3%, enforced via the invariant check rather than explicit deduction. Fees accumulate in reserves, increasing LP token value.
- **First deposit**: LP tokens = `sqrt(amount0 * amount1) - 1000`. The 1000 minimum liquidity is permanently locked to prevent inflation attacks.
- **Subsequent deposits**: LP tokens proportional to the lesser ratio of deposited amounts vs reserves.
- **Reserves**: Stored as `uint112` (two fit in one 256-bit storage slot, saving ~2100 gas per read).

**Factory** creates pools with canonical token ordering (`token0 < token1`) and registers them in a bidirectional mapping (`getPair[A][B]` and `getPair[B][A]` both work). Pool creation is owner-only.

### Frontend

```
frontend/
├── app/
│   ├── layout.tsx       # Server Component root, wraps children in Providers
│   ├── page.tsx         # Server Component home page with responsive grid
│   └── providers.tsx    # Client boundary: WagmiProvider > QueryClientProvider > RainbowKitProvider
├── components/
│   ├── ConnectButton.tsx    # RainbowKit wallet connect wrapper
│   ├── TokenBalances.tsx    # WETH/USDC/LP balances via batched useReadContracts
│   ├── PoolStats.tsx        # Reserves, exchange rates, LP supply
│   └── TxStatus.tsx         # Transaction feedback (pending/confirmed/error)
├── abi/
│   ├── Pool.ts          # Pool ABI (as const for type inference)
│   └── ERC20.ts         # Re-exports viem's erc20Abi
└── lib/
    ├── wagmi.ts         # Wagmi config: foundry chain, SSR enabled
    └── constants.ts     # Contract addresses (env vars), token decimals
```

The frontend is configured exclusively for the local Anvil chain (chainId 31337). Contract addresses default to zero address and are populated via `NEXT_PUBLIC_*` environment variables after deployment. Components gate on-chain reads on non-zero addresses to handle the pre-deployment state gracefully.

### Test Suite

```
test/
├── core/
│   ├── Pool.t.sol             # ~70 unit tests: swap, mint, burn, edge cases
│   ├── Factory.t.sol          # Pool creation, duplicate prevention, access control
│   ├── Integration.t.sol      # End-to-end flows with WETH/MockUSDC
│   ├── PoolFuzz.t.sol         # Fuzz testing (10,000 iterations)
│   ├── PoolInvariant.t.sol    # Stateful invariant testing (x*y=k holds)
│   └── PoolReentrancy.t.sol   # Reentrancy attack prevention
└── tokens/
    ├── WETH.t.sol
    └── MockUSDC.t.sol
```

## Available Commands

### Smart Contracts

| Command | Description |
|---------|-------------|
| `forge build` | Compile all contracts |
| `forge test` | Run full test suite |
| `forge test -vvv` | Run tests with verbose output |
| `forge test --match-path "test/core/Pool.t.sol"` | Run tests in a specific file |
| `forge test --match-test "test_SwapExactInput"` | Run a single test by name |
| `forge test --match-contract PoolFuzz` | Run all tests in a contract |
| `forge test --gas-report` | Run tests with gas usage report |
| `forge fmt` | Format Solidity code |
| `forge fmt --check` | Check formatting without changes |
| `forge snapshot` | Generate gas snapshots |
| `anvil` | Start local EVM node (chainId 31337) |
| `slither .` | Run static analysis |

### Frontend (run from `frontend/`)

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server at http://localhost:3000 |
| `npm run build` | Production build (validates TypeScript) |
| `npm run lint` | Run ESLint |

## Environment Variables

### Frontend (`frontend/.env.local`)

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect project ID (any non-empty string works for local MetaMask) | `dev-project-id` |
| `NEXT_PUBLIC_POOL_ADDRESS` | Deployed Pool contract address | `0x0...0` |
| `NEXT_PUBLIC_WETH_ADDRESS` | Deployed WETH contract address | `0x0...0` |
| `NEXT_PUBLIC_USDC_ADDRESS` | Deployed MockUSDC contract address | `0x0...0` |
| `NEXT_PUBLIC_FACTORY_ADDRESS` | Deployed Factory contract address | `0x0...0` |
