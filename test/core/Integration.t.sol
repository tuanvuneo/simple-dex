// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../../src/core/Factory.sol";
import "../../src/core/Pool.sol";
import "../../src/tokens/WETH.sol";
import "../../src/tokens/MockUSDC.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Simple mock token for multi-pool tests
contract SimpleToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1_000_000e18);
    }
}

/// @title Integration Tests - End-to-end verification of Phase 2 contracts
/// @notice Uses actual Phase 1 tokens (WETH, MockUSDC) to prove real-world compatibility
contract IntegrationTest is Test {
    Factory public factory;
    WETH public weth;
    MockUSDC public usdc;
    Pool public pool;

    address public lp1 = makeAddr("lp1");
    address public trader = makeAddr("trader");

    function setUp() public {
        factory = new Factory();
        weth = new WETH();
        usdc = new MockUSDC();

        // Sort and create pool
        address token0;
        address token1;
        if (address(weth) < address(usdc)) {
            token0 = address(weth);
            token1 = address(usdc);
        } else {
            token0 = address(usdc);
            token1 = address(weth);
        }
        address poolAddr = factory.createPool(token0, token1);
        pool = Pool(poolAddr);

        // Label addresses
        vm.label(address(factory), "Factory");
        vm.label(address(pool), "Pool");
        vm.label(address(weth), "WETH");
        vm.label(address(usdc), "USDC");
        vm.label(lp1, "LP1");
        vm.label(trader, "Trader");
    }

    // ─── Test 1: Full Flow — Create Pool, Add Liquidity, Swap ──────────

    function test_FullFlow_CreatePoolAddLiquiditySwap() public {
        // 1. Give LP tokens to add liquidity
        uint256 wethAmount = 10e18; // 10 WETH
        uint256 usdcAmount = 20_000e6; // 20,000 USDC

        weth.faucet(lp1, wethAmount);
        usdc.faucet(lp1, usdcAmount);

        // 2. LP adds initial liquidity
        vm.startPrank(lp1);
        IERC20(address(weth)).transfer(address(pool), wethAmount);
        IERC20(address(usdc)).transfer(address(pool), usdcAmount);
        uint256 lpTokens = pool.mint(lp1);
        vm.stopPrank();

        assertGt(lpTokens, 0, "Should receive LP tokens");
        assertGt(pool.balanceOf(lp1), 0, "LP1 should have LP tokens");

        // 3. Verify reserves
        (uint112 r0, uint112 r1) = pool.getReserves();
        assertTrue(r0 > 0 && r1 > 0, "Reserves should be non-zero");

        // 4. Trader swaps 1 WETH for USDC
        uint256 swapAmountIn = 1e18; // 1 WETH
        weth.faucet(trader, swapAmountIn);

        // Determine which is token0/token1 to call swap correctly
        address poolToken0 = pool.token0();

        vm.startPrank(trader);
        if (poolToken0 == address(weth)) {
            // WETH is token0: swap token0 -> token1 (USDC)
            uint256 expectedOut = pool.getAmountOut(swapAmountIn, r0, r1);
            IERC20(address(weth)).transfer(address(pool), swapAmountIn);
            pool.swap(0, expectedOut, trader);

            assertEq(IERC20(address(usdc)).balanceOf(trader), expectedOut, "Trader should receive USDC");
            assertGt(expectedOut, 0, "Should receive non-zero USDC");
        } else {
            // WETH is token1: swap token1 -> token0 (USDC)
            uint256 expectedOut = pool.getAmountOut(swapAmountIn, r1, r0);
            IERC20(address(weth)).transfer(address(pool), swapAmountIn);
            pool.swap(expectedOut, 0, trader);

            assertEq(IERC20(address(usdc)).balanceOf(trader), expectedOut, "Trader should receive USDC");
            assertGt(expectedOut, 0, "Should receive non-zero USDC");
        }
        vm.stopPrank();
    }

    // ─── Test 2: Full Flow — Add and Remove Liquidity ──────────────────

    function test_FullFlow_AddAndRemoveLiquidity() public {
        // Initial liquidity
        uint256 wethAmount = 10e18;
        uint256 usdcAmount = 20_000e6;

        weth.faucet(lp1, wethAmount * 2);
        usdc.faucet(lp1, usdcAmount * 2);

        vm.startPrank(lp1);

        // First deposit
        IERC20(address(weth)).transfer(address(pool), wethAmount);
        IERC20(address(usdc)).transfer(address(pool), usdcAmount);
        uint256 firstLiquidity = pool.mint(lp1);

        // Second deposit (same ratio)
        IERC20(address(weth)).transfer(address(pool), wethAmount);
        IERC20(address(usdc)).transfer(address(pool), usdcAmount);
        uint256 secondLiquidity = pool.mint(lp1);

        uint256 totalLiquidity = firstLiquidity + secondLiquidity;
        assertEq(pool.balanceOf(lp1), totalLiquidity, "LP1 should have all LP tokens");

        // Remove liquidity by transferring LP tokens to pool and calling burn
        pool.transfer(address(pool), totalLiquidity);
        (uint256 amount0, uint256 amount1) = pool.burn(lp1);

        vm.stopPrank();

        // LP should receive back tokens
        assertGt(amount0, 0, "Should receive token0 back");
        assertGt(amount1, 0, "Should receive token1 back");

        // LP balance should be 0 now
        assertEq(pool.balanceOf(lp1), 0, "LP should have no LP tokens after full burn");
    }

    // ─── Test 3: Full Flow — Fees Accrue to LPs ───────────────────────

    function test_FullFlow_FeesAccrueToLPs() public {
        // LP1 provides initial liquidity
        uint256 wethAmount = 10e18;
        uint256 usdcAmount = 20_000e6;

        weth.faucet(lp1, wethAmount);
        usdc.faucet(lp1, usdcAmount);

        vm.startPrank(lp1);
        IERC20(address(weth)).transfer(address(pool), wethAmount);
        IERC20(address(usdc)).transfer(address(pool), usdcAmount);
        uint256 lpTokens = pool.mint(lp1);
        vm.stopPrank();

        address poolToken0 = pool.token0();

        // Trader executes multiple swaps (generates fees)
        for (uint256 i = 0; i < 5; i++) {
            uint256 swapAmount = 1e18;
            weth.faucet(trader, swapAmount);

            vm.startPrank(trader);
            (uint112 r0, uint112 r1) = pool.getReserves();

            if (poolToken0 == address(weth)) {
                uint256 expectedOut = pool.getAmountOut(swapAmount, r0, r1);
                IERC20(address(weth)).transfer(address(pool), swapAmount);
                pool.swap(0, expectedOut, trader);
            } else {
                uint256 expectedOut = pool.getAmountOut(swapAmount, r1, r0);
                IERC20(address(weth)).transfer(address(pool), swapAmount);
                pool.swap(expectedOut, 0, trader);
            }
            vm.stopPrank();
        }

        // LP1 removes all liquidity
        vm.startPrank(lp1);
        pool.transfer(address(pool), lpTokens);
        (uint256 received0, uint256 received1) = pool.burn(lp1);
        vm.stopPrank();

        // Determine which received amount is WETH
        uint256 receivedWeth;
        uint256 receivedUsdc;
        if (poolToken0 == address(weth)) {
            receivedWeth = received0;
            receivedUsdc = received1;
        } else {
            receivedWeth = received1;
            receivedUsdc = received0;
        }

        // LP should receive MORE WETH than they deposited (fees from 5 WETH->USDC swaps)
        assertGt(receivedWeth, wethAmount, "LP should receive more WETH due to accumulated swap fees");
    }

    // ─── Test 4: Factory Creates Independent Pools ─────────────────────

    function test_FactoryPoolInteraction() public {
        // Create a second pair (WETH-DAI using a simple mock)
        SimpleToken dai = new SimpleToken("DAI Stablecoin", "DAI");

        address daiToken0;
        address daiToken1;
        if (address(weth) < address(dai)) {
            daiToken0 = address(weth);
            daiToken1 = address(dai);
        } else {
            daiToken0 = address(dai);
            daiToken1 = address(weth);
        }

        address pool2Addr = factory.createPool(daiToken0, daiToken1);
        Pool pool2 = Pool(pool2Addr);

        // Pool addresses should be different
        assertTrue(address(pool) != address(pool2), "Pools should have different addresses");

        // Add liquidity to both pools
        weth.faucet(lp1, 20e18);
        usdc.faucet(lp1, 20_000e6);
        dai.transfer(lp1, 10_000e18);

        vm.startPrank(lp1);

        // Pool 1: WETH-USDC
        IERC20(address(weth)).transfer(address(pool), 10e18);
        IERC20(address(usdc)).transfer(address(pool), 20_000e6);
        pool.mint(lp1);

        // Pool 2: WETH-DAI
        IERC20(address(weth)).transfer(address(pool2), 10e18);
        IERC20(address(dai)).transfer(address(pool2), 10_000e18);
        pool2.mint(lp1);

        vm.stopPrank();

        // Verify independent reserves
        (uint112 r0Pool1, uint112 r1Pool1) = pool.getReserves();
        (uint112 r0Pool2, uint112 r1Pool2) = pool2.getReserves();

        // Both pools should have non-zero reserves
        assertTrue(r0Pool1 > 0 && r1Pool1 > 0, "Pool 1 should have reserves");
        assertTrue(r0Pool2 > 0 && r1Pool2 > 0, "Pool 2 should have reserves");

        // Swap in pool 1 should not affect pool 2
        address pool1Token0 = pool.token0();

        weth.faucet(trader, 1e18);
        vm.startPrank(trader);
        if (pool1Token0 == address(weth)) {
            uint256 expectedOut = pool.getAmountOut(1e18, r0Pool1, r1Pool1);
            IERC20(address(weth)).transfer(address(pool), 1e18);
            pool.swap(0, expectedOut, trader);
        } else {
            uint256 expectedOut = pool.getAmountOut(1e18, r1Pool1, r0Pool1);
            IERC20(address(weth)).transfer(address(pool), 1e18);
            pool.swap(expectedOut, 0, trader);
        }
        vm.stopPrank();

        // Pool 2 reserves should be unchanged
        (uint112 r0Pool2After, uint112 r1Pool2After) = pool2.getReserves();
        assertEq(r0Pool2After, r0Pool2, "Pool 2 token0 reserves should be unchanged");
        assertEq(r1Pool2After, r1Pool2, "Pool 2 token1 reserves should be unchanged");
    }
}
