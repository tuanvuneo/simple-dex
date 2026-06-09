// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../../src/core/Pool.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev Simple mock ERC20 token for isolated pool testing (both 18 decimals)
contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1_000_000e18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract PoolTest is Test {
    Pool public pool;
    MockToken public tokenA;
    MockToken public tokenB;

    // Sorted references (token0 < token1)
    address public token0;
    address public token1;

    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    address private constant DEAD_ADDRESS = address(0xdEaD);

    function setUp() public {
        // Deploy tokens
        tokenA = new MockToken("Token A", "TKA");
        tokenB = new MockToken("Token B", "TKB");

        // Sort tokens by address (canonical ordering)
        if (address(tokenA) < address(tokenB)) {
            token0 = address(tokenA);
            token1 = address(tokenB);
        } else {
            token0 = address(tokenB);
            token1 = address(tokenA);
        }

        // Deploy pool with sorted tokens
        pool = new Pool(token0, token1);

        // Label for readable traces
        vm.label(address(pool), "Pool");
        vm.label(token0, "Token0");
        vm.label(token1, "Token1");
        vm.label(alice, "Alice");
        vm.label(bob, "Bob");
    }

    // ─── Helper ────────────────────────────────────────────────────────

    function _addLiquidity(uint256 amount0, uint256 amount1) internal returns (uint256 liquidity) {
        IERC20(token0).transfer(address(pool), amount0);
        IERC20(token1).transfer(address(pool), amount1);
        liquidity = pool.mint(address(this));
    }

    // ─── Test 1: Initial State ─────────────────────────────────────────

    function test_InitialState() public view {
        assertEq(pool.token0(), token0);
        assertEq(pool.token1(), token1);
        assertEq(pool.totalSupply(), 0);

        (uint112 r0, uint112 r1) = pool.getReserves();
        assertEq(r0, 0);
        assertEq(r1, 0);
    }

    // ─── Test 2: LP Token Name and Symbol ──────────────────────────────

    function test_LPTokenNameAndSymbol() public view {
        string memory expectedName = string(
            abi.encodePacked(
                "SimpleDEX ",
                IERC20Metadata(token0).symbol(),
                "-",
                IERC20Metadata(token1).symbol(),
                " LP"
            )
        );
        string memory expectedSymbol = string(
            abi.encodePacked("SLP-", IERC20Metadata(token0).symbol(), "-", IERC20Metadata(token1).symbol())
        );

        assertEq(pool.name(), expectedName);
        assertEq(pool.symbol(), expectedSymbol);
    }

    // ─── Test 3: First Mint with MINIMUM_LIQUIDITY Burn ────────────────

    function test_MintFirstLiquidity() public {
        uint256 amount0 = 1000e18;
        uint256 amount1 = 4000e18;

        IERC20(token0).transfer(address(pool), amount0);
        IERC20(token1).transfer(address(pool), amount1);

        uint256 expectedLiquidity = Math.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
        uint256 liquidity = pool.mint(address(this));

        assertEq(liquidity, expectedLiquidity);

        // MINIMUM_LIQUIDITY locked at dead address (OZ v5 rejects mint to address(0))
        assertEq(pool.balanceOf(DEAD_ADDRESS), MINIMUM_LIQUIDITY);

        // Total supply = minted + burned
        assertEq(pool.totalSupply(), expectedLiquidity + MINIMUM_LIQUIDITY);

        // Reserves updated
        (uint112 r0, uint112 r1) = pool.getReserves();
        assertEq(r0, amount0);
        assertEq(r1, amount1);
    }

    // ─── Test 4: Subsequent Mint (Proportional) ────────────────────────

    function test_MintSubsequentLiquidity() public {
        // First deposit
        _addLiquidity(1000e18, 1000e18);
        uint256 totalSupplyAfterFirst = pool.totalSupply();

        // Second deposit: double the first
        uint256 amount0 = 1000e18;
        uint256 amount1 = 1000e18;
        IERC20(token0).transfer(address(pool), amount0);
        IERC20(token1).transfer(address(pool), amount1);

        uint256 liquidity = pool.mint(alice);

        // Proportional: should get roughly same LP as first deposit (minus MINIMUM_LIQUIDITY)
        uint256 expectedLiquidity = Math.min(
            (amount0 * totalSupplyAfterFirst) / 1000e18,
            (amount1 * totalSupplyAfterFirst) / 1000e18
        );
        assertEq(liquidity, expectedLiquidity);
        assertEq(pool.balanceOf(alice), liquidity);
    }

    // ─── Test 5: Burn (Remove Liquidity) ───────────────────────────────

    function test_Burn() public {
        uint256 liquidity = _addLiquidity(1000e18, 2000e18);

        uint256 balanceBefore0 = IERC20(token0).balanceOf(bob);
        uint256 balanceBefore1 = IERC20(token1).balanceOf(bob);

        // Transfer LP tokens to pool, then burn
        pool.transfer(address(pool), liquidity);
        (uint256 amount0, uint256 amount1) = pool.burn(bob);

        assertGt(amount0, 0);
        assertGt(amount1, 0);

        // Bob received the tokens
        assertEq(IERC20(token0).balanceOf(bob), balanceBefore0 + amount0);
        assertEq(IERC20(token1).balanceOf(bob), balanceBefore1 + amount1);

        // LP tokens burned (only MINIMUM_LIQUIDITY remains in supply)
        assertEq(pool.balanceOf(address(this)), 0);
    }

    // ─── Test 6: Swap (token0 -> token1) ───────────────────────────────

    function test_Swap() public {
        _addLiquidity(1000e18, 1000e18);

        uint256 amountIn = 100e18;
        (uint112 r0, uint112 r1) = pool.getReserves();
        uint256 expectedOut = pool.getAmountOut(amountIn, r0, r1);

        // Transfer input tokens to pool
        IERC20(token0).transfer(address(pool), amountIn);

        // Swap: receive token1
        uint256 balanceBefore = IERC20(token1).balanceOf(alice);
        pool.swap(0, expectedOut, alice);
        uint256 balanceAfter = IERC20(token1).balanceOf(alice);

        assertEq(balanceAfter - balanceBefore, expectedOut);
        assertGt(expectedOut, 0);
    }

    // ─── Test 7: Swap Reverse Direction (token1 -> token0) ─────────────

    function test_SwapReverseDirection() public {
        _addLiquidity(1000e18, 1000e18);

        uint256 amountIn = 50e18;
        (uint112 r0, uint112 r1) = pool.getReserves();
        uint256 expectedOut = pool.getAmountOut(amountIn, r1, r0);

        // Transfer token1 to pool
        IERC20(token1).transfer(address(pool), amountIn);

        // Swap: receive token0
        uint256 balanceBefore = IERC20(token0).balanceOf(alice);
        pool.swap(expectedOut, 0, alice);
        uint256 balanceAfter = IERC20(token0).balanceOf(alice);

        assertEq(balanceAfter - balanceBefore, expectedOut);
        assertGt(expectedOut, 0);
    }

    // ─── Test 8: Fees Accumulate in Reserves ───────────────────────────

    function test_SwapFeesAccumulate() public {
        _addLiquidity(1000e18, 1000e18);

        (uint112 r0Before, uint112 r1Before) = pool.getReserves();
        uint256 kBefore = uint256(r0Before) * uint256(r1Before);

        // Execute a swap: token0 -> token1
        uint256 amountIn = 100e18;
        uint256 expectedOut = pool.getAmountOut(amountIn, r0Before, r1Before);
        IERC20(token0).transfer(address(pool), amountIn);
        pool.swap(0, expectedOut, alice);

        (uint112 r0After, uint112 r1After) = pool.getReserves();
        uint256 kAfter = uint256(r0After) * uint256(r1After);

        // After swap with fees, k should INCREASE (fees stay in pool)
        assertGt(kAfter, kBefore, "k should increase due to fees");
    }

    // ─── Test 9: getAmountOut Matches Actual Swap ──────────────────────

    function test_GetAmountOut() public {
        _addLiquidity(1000e18, 2000e18);

        uint256 amountIn = 10e18;
        (uint112 r0, uint112 r1) = pool.getReserves();

        // Calculate expected output
        uint256 expectedOut = pool.getAmountOut(amountIn, r0, r1);

        // Execute swap
        IERC20(token0).transfer(address(pool), amountIn);
        uint256 balanceBefore = IERC20(token1).balanceOf(bob);
        pool.swap(0, expectedOut, bob);
        uint256 actualOut = IERC20(token1).balanceOf(bob) - balanceBefore;

        // Actual output matches getAmountOut prediction
        assertEq(actualOut, expectedOut);
    }

    // ─── Test 10: Slippage Protection (K Invariant Check) ──────────────

    function test_SlippageProtection() public {
        _addLiquidity(1000e18, 1000e18);

        uint256 amountIn = 100e18;
        (uint112 r0, uint112 r1) = pool.getReserves();
        uint256 fairOut = pool.getAmountOut(amountIn, r0, r1);

        // Transfer input tokens
        IERC20(token0).transfer(address(pool), amountIn);

        // Try to extract MORE than the fair output (violates k invariant)
        vm.expectRevert("Pool: K");
        pool.swap(0, fairOut + 1, alice);
    }

    // ─── Test 11: Revert on Zero Liquidity ─────────────────────────────

    function test_RevertOnZeroLiquidity() public {
        // Try to mint with 0 tokens transferred
        vm.expectRevert(); // Underflow or INSUFFICIENT_LIQUIDITY_MINTED
        pool.mint(address(this));
    }

    // ─── Test 12: Emits Swap Event ─────────────────────────────────────

    function test_EmitsSwapEvent() public {
        _addLiquidity(1000e18, 1000e18);

        uint256 amountIn = 100e18;
        (uint112 r0, uint112 r1) = pool.getReserves();
        uint256 expectedOut = pool.getAmountOut(amountIn, r0, r1);

        IERC20(token0).transfer(address(pool), amountIn);

        // Expect Swap event with correct parameters
        vm.expectEmit(true, true, false, true);
        emit Pool.Swap(address(this), amountIn, 0, 0, expectedOut, alice);

        pool.swap(0, expectedOut, alice);
    }

    // ═══════════════════════════════════════════════════════════════════
    // ─── Comprehensive Swap Tests (TS-01) ────────────────────────────
    // ═══════════════════════════════════════════════════════════════════

    function test_should_swap_small_amount() public {
        _addLiquidity(1000e18, 1000e18);

        uint256 amountIn = 1e15; // 0.001 token
        (uint112 r0Before, uint112 r1Before) = pool.getReserves();
        uint256 kBefore = uint256(r0Before) * uint256(r1Before);
        uint256 expectedOut = pool.getAmountOut(amountIn, r0Before, r1Before);

        IERC20(token0).transfer(address(pool), amountIn);
        uint256 balBefore = IERC20(token1).balanceOf(alice);
        pool.swap(0, expectedOut, alice);
        uint256 balAfter = IERC20(token1).balanceOf(alice);

        assertEq(balAfter - balBefore, expectedOut);
        assertGt(expectedOut, 0);

        // k invariant
        (uint112 r0After, uint112 r1After) = pool.getReserves();
        uint256 kAfter = uint256(r0After) * uint256(r1After);
        assertGe(kAfter, kBefore, "k should not decrease");
    }

    function test_should_swap_large_amount() public {
        _addLiquidity(1000e18, 1000e18);

        uint256 amountIn = 500e18; // 50% of reserve
        (uint112 r0Before, uint112 r1Before) = pool.getReserves();
        uint256 kBefore = uint256(r0Before) * uint256(r1Before);
        uint256 expectedOut = pool.getAmountOut(amountIn, r0Before, r1Before);

        IERC20(token0).transfer(address(pool), amountIn);
        uint256 balBefore = IERC20(token1).balanceOf(alice);
        pool.swap(0, expectedOut, alice);
        uint256 balAfter = IERC20(token1).balanceOf(alice);

        assertEq(balAfter - balBefore, expectedOut);
        assertGt(expectedOut, 0);

        // k invariant
        (uint112 r0After, uint112 r1After) = pool.getReserves();
        uint256 kAfter = uint256(r0After) * uint256(r1After);
        assertGe(kAfter, kBefore, "k should not decrease");
    }

    function test_should_swap_with_asymmetric_reserves() public {
        // Add asymmetric liquidity: 100 token0 and 10,000 token1
        MockToken(token0).mint(address(this), 100e18);
        MockToken(token1).mint(address(this), 10_000e18);
        _addLiquidity(100e18, 10_000e18);

        uint256 amountIn = 1e18;
        (uint112 r0Before, uint112 r1Before) = pool.getReserves();
        uint256 kBefore = uint256(r0Before) * uint256(r1Before);
        uint256 expectedOut = pool.getAmountOut(amountIn, r0Before, r1Before);

        IERC20(token0).transfer(address(pool), amountIn);
        pool.swap(0, expectedOut, alice);

        assertGt(expectedOut, 0);

        // k invariant
        (uint112 r0After, uint112 r1After) = pool.getReserves();
        uint256 kAfter = uint256(r0After) * uint256(r1After);
        assertGe(kAfter, kBefore, "k should not decrease");
    }

    function test_should_swap_multiple_times_sequentially() public {
        _addLiquidity(1000e18, 1000e18);

        // Swap 1
        uint256 amountIn1 = 10e18;
        (uint112 r0, uint112 r1) = pool.getReserves();
        uint256 kBefore1 = uint256(r0) * uint256(r1);
        uint256 expectedOut1 = pool.getAmountOut(amountIn1, r0, r1);
        IERC20(token0).transfer(address(pool), amountIn1);
        pool.swap(0, expectedOut1, alice);
        (r0, r1) = pool.getReserves();
        assertGe(uint256(r0) * uint256(r1), kBefore1, "k should not decrease after swap 1");

        // Swap 2
        uint256 amountIn2 = 20e18;
        uint256 kBefore2 = uint256(r0) * uint256(r1);
        uint256 expectedOut2 = pool.getAmountOut(amountIn2, r0, r1);
        IERC20(token0).transfer(address(pool), amountIn2);
        pool.swap(0, expectedOut2, alice);
        (r0, r1) = pool.getReserves();
        assertGe(uint256(r0) * uint256(r1), kBefore2, "k should not decrease after swap 2");

        // Swap 3
        uint256 amountIn3 = 50e18;
        uint256 kBefore3 = uint256(r0) * uint256(r1);
        uint256 expectedOut3 = pool.getAmountOut(amountIn3, r0, r1);
        IERC20(token0).transfer(address(pool), amountIn3);
        pool.swap(0, expectedOut3, alice);
        (r0, r1) = pool.getReserves();
        assertGe(uint256(r0) * uint256(r1), kBefore3, "k should not decrease after swap 3");

        // All outputs should be positive
        assertGt(expectedOut1, 0);
        assertGt(expectedOut2, 0);
        assertGt(expectedOut3, 0);
    }

    function test_should_swap_both_directions_in_sequence() public {
        _addLiquidity(1000e18, 1000e18);

        // Swap token0 -> token1
        uint256 amountIn0 = 50e18;
        (uint112 r0, uint112 r1) = pool.getReserves();
        uint256 kBefore = uint256(r0) * uint256(r1);
        uint256 expectedOut1 = pool.getAmountOut(amountIn0, r0, r1);
        IERC20(token0).transfer(address(pool), amountIn0);
        pool.swap(0, expectedOut1, alice);

        (r0, r1) = pool.getReserves();
        uint256 kAfterSwap1 = uint256(r0) * uint256(r1);
        assertGe(kAfterSwap1, kBefore, "k should not decrease after swap 1");

        // Swap token1 -> token0
        uint256 amountIn1 = 30e18;
        uint256 expectedOut0 = pool.getAmountOut(amountIn1, r1, r0);
        IERC20(token1).transfer(address(pool), amountIn1);
        pool.swap(expectedOut0, 0, bob);

        (r0, r1) = pool.getReserves();
        uint256 kAfterSwap2 = uint256(r0) * uint256(r1);
        assertGe(kAfterSwap2, kAfterSwap1, "k should not decrease after swap 2");

        assertGt(expectedOut1, 0);
        assertGt(expectedOut0, 0);
    }

    function test_should_revert_swap_to_token0_address() public {
        _addLiquidity(1000e18, 1000e18);

        uint256 amountIn = 10e18;
        (uint112 r0, uint112 r1) = pool.getReserves();
        uint256 expectedOut = pool.getAmountOut(amountIn, r0, r1);

        IERC20(token0).transfer(address(pool), amountIn);

        vm.expectRevert("Pool: INVALID_TO");
        pool.swap(0, expectedOut, token0);
    }

    function test_should_revert_swap_to_token1_address() public {
        _addLiquidity(1000e18, 1000e18);

        uint256 amountIn = 10e18;
        (uint112 r0, uint112 r1) = pool.getReserves();
        uint256 expectedOut = pool.getAmountOut(amountIn, r0, r1);

        IERC20(token0).transfer(address(pool), amountIn);

        vm.expectRevert("Pool: INVALID_TO");
        pool.swap(0, expectedOut, token1);
    }

    function test_should_revert_swap_exceeding_reserves() public {
        _addLiquidity(1000e18, 1000e18);

        // Try to swap out more than reserves
        vm.expectRevert("Pool: INSUFFICIENT_LIQUIDITY");
        pool.swap(0, 1001e18, alice);
    }

    // ═══════════════════════════════════════════════════════════════════
    // ─── Liquidity Tests (TS-02) — LP Token Accounting ───────────────
    // ═══════════════════════════════════════════════════════════════════

    function test_should_mint_proportional_lp_for_equal_ratio() public {
        // First deposit: 1:1 ratio
        _addLiquidity(1000e18, 1000e18);
        (uint112 r0, uint112 r1) = pool.getReserves();
        assertEq(IERC20(token0).balanceOf(address(pool)), r0, "reserve0 matches balance after mint1");
        assertEq(IERC20(token1).balanceOf(address(pool)), r1, "reserve1 matches balance after mint1");

        // Second deposit: also 1:1 ratio, same amounts
        uint256 totalSupplyBefore = pool.totalSupply();
        IERC20(token0).transfer(address(pool), 1000e18);
        IERC20(token1).transfer(address(pool), 1000e18);
        uint256 lp2 = pool.mint(alice);

        (r0, r1) = pool.getReserves();
        assertEq(IERC20(token0).balanceOf(address(pool)), r0, "reserve0 matches balance after mint2");
        assertEq(IERC20(token1).balanceOf(address(pool)), r1, "reserve1 matches balance after mint2");

        // LP2 should be proportional to LP1 (same deposit ratio and amounts)
        uint256 expectedLp2 = Math.min(
            (1000e18 * totalSupplyBefore) / 1000e18,
            (1000e18 * totalSupplyBefore) / 1000e18
        );
        assertEq(lp2, expectedLp2, "LP2 should be proportional");
    }

    function test_should_mint_less_lp_for_imbalanced_deposit() public {
        // First deposit: 1:1 ratio
        _addLiquidity(1000e18, 1000e18);
        uint256 totalSupplyBefore = pool.totalSupply();

        // Second deposit: 2:1 ratio (imbalanced)
        MockToken(token0).mint(address(this), 2000e18);
        IERC20(token0).transfer(address(pool), 2000e18);
        IERC20(token1).transfer(address(pool), 1000e18);
        uint256 lp = pool.mint(alice);

        // Math.min logic should give LP based on the lesser ratio
        uint256 expectedLp = Math.min(
            (2000e18 * totalSupplyBefore) / 1000e18,
            (1000e18 * totalSupplyBefore) / 1000e18
        );
        assertEq(lp, expectedLp, "LP should use minimum ratio (imbalanced)");
        // LP should be equal to what 1000e18:1000e18 would give, not 2000e18:1000e18
        uint256 lpForBalanced = (1000e18 * totalSupplyBefore) / 1000e18;
        assertEq(lp, lpForBalanced, "LP equals balanced portion");
    }

    function test_should_burn_proportional_tokens() public {
        uint256 lp = _addLiquidity(1000e18, 2000e18);
        (uint112 r0Before, uint112 r1Before) = pool.getReserves();

        // Burn half LP
        uint256 halfLp = lp / 2;
        pool.transfer(address(pool), halfLp);
        (uint256 amount0, uint256 amount1) = pool.burn(alice);

        // Received amounts should be ~50% of reserves
        assertApproxEqRel(amount0, uint256(r0Before) / 2, 0.01e18, "amount0 ~50% of reserve0");
        assertApproxEqRel(amount1, uint256(r1Before) / 2, 0.01e18, "amount1 ~50% of reserve1");
    }

    function test_should_burn_all_liquidity_leaving_minimum() public {
        uint256 lp = _addLiquidity(1000e18, 1000e18);

        // Burn all user LP
        pool.transfer(address(pool), lp);
        pool.burn(alice);

        // Only MINIMUM_LIQUIDITY remains at dead address
        assertEq(pool.balanceOf(address(this)), 0, "user has 0 LP");
        assertEq(pool.balanceOf(DEAD_ADDRESS), MINIMUM_LIQUIDITY, "dead address holds MINIMUM_LIQUIDITY");
        assertEq(pool.totalSupply(), MINIMUM_LIQUIDITY, "total supply equals MINIMUM_LIQUIDITY");
    }

    function test_should_revert_burn_with_zero_lp() public {
        _addLiquidity(1000e18, 1000e18);

        // Transfer 0 LP to pool, attempt burn (pool has 0 LP balance -> division by zero or INSUFFICIENT_LIQUIDITY_BURNED)
        vm.expectRevert();
        pool.burn(alice);
    }

    function test_should_handle_multiple_lps() public {
        // Alice adds liquidity
        IERC20(token0).transfer(address(pool), 1000e18);
        IERC20(token1).transfer(address(pool), 1000e18);
        uint256 lpAlice = pool.mint(alice);

        // Verify reserves match balances
        (uint112 r0, uint112 r1) = pool.getReserves();
        assertEq(IERC20(token0).balanceOf(address(pool)), r0, "reserve0 matches after alice mint");
        assertEq(IERC20(token1).balanceOf(address(pool)), r1, "reserve1 matches after alice mint");

        // Bob adds liquidity
        MockToken(token0).mint(bob, 500e18);
        MockToken(token1).mint(bob, 500e18);
        vm.startPrank(bob);
        IERC20(token0).transfer(address(pool), 500e18);
        IERC20(token1).transfer(address(pool), 500e18);
        uint256 lpBob = pool.mint(bob);
        vm.stopPrank();

        // Bob should have ~half of Alice's LP (deposited half as much)
        assertApproxEqRel(lpBob, lpAlice / 2, 0.01e18, "Bob's LP is ~half of Alice's");

        // Alice burns her LP
        vm.prank(alice);
        pool.transfer(address(pool), lpAlice);
        (uint256 a0Alice, uint256 a1Alice) = pool.burn(alice);
        assertGt(a0Alice, 0);
        assertGt(a1Alice, 0);

        // Bob burns his LP
        vm.prank(bob);
        pool.transfer(address(pool), lpBob);
        (uint256 a0Bob, uint256 a1Bob) = pool.burn(bob);
        assertGt(a0Bob, 0);
        assertGt(a1Bob, 0);

        // Only MINIMUM_LIQUIDITY remains
        assertEq(pool.totalSupply(), MINIMUM_LIQUIDITY);
    }

    // ═══════════════════════════════════════════════════════════════════
    // ─── Invariant Lifecycle Test (TS-06 unit-level) ─────────────────
    // ═══════════════════════════════════════════════════════════════════

    function test_should_maintain_k_invariant_across_mint_swap_burn() public {
        // Step 1: Mint liquidity
        _addLiquidity(1000e18, 1000e18);
        (uint112 r0, uint112 r1) = pool.getReserves();
        uint256 kAfterMint = uint256(r0) * uint256(r1);
        assertGt(kAfterMint, 0, "k > 0 after mint");

        // Step 2: Swap token0 -> token1
        uint256 amountIn1 = 50e18;
        uint256 expectedOut1 = pool.getAmountOut(amountIn1, r0, r1);
        IERC20(token0).transfer(address(pool), amountIn1);
        pool.swap(0, expectedOut1, alice);
        (r0, r1) = pool.getReserves();
        uint256 kAfterSwap1 = uint256(r0) * uint256(r1);
        assertGe(kAfterSwap1, kAfterMint, "k should not decrease after swap 1");

        // Step 3: Swap token1 -> token0
        uint256 amountIn2 = 30e18;
        uint256 expectedOut2 = pool.getAmountOut(amountIn2, r1, r0);
        IERC20(token1).transfer(address(pool), amountIn2);
        pool.swap(expectedOut2, 0, bob);
        (r0, r1) = pool.getReserves();
        uint256 kAfterSwap2 = uint256(r0) * uint256(r1);
        assertGe(kAfterSwap2, kAfterSwap1, "k should not decrease after swap 2");

        // Step 4: Burn liquidity
        uint256 lpBal = pool.balanceOf(address(this));
        pool.transfer(address(pool), lpBal);
        pool.burn(address(this));
        (r0, r1) = pool.getReserves();
        // After burn, k decreases proportionally (this is expected — reserves shrink)
        // but pool should still function
        assertEq(pool.totalSupply(), MINIMUM_LIQUIDITY, "only MINIMUM_LIQUIDITY remains");
    }

    // ═══════════════════════════════════════════════════════════════════
    // ─── Edge Case Tests (TS-04) ─────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════

    function test_should_handle_one_wei_swap() public {
        _addLiquidity(1000e18, 1000e18);

        (uint112 r0, uint112 r1) = pool.getReserves();
        uint256 kBefore = uint256(r0) * uint256(r1);

        // 1 wei swap - output may round to 0 due to fee
        uint256 amountOut = pool.getAmountOut(1, r0, r1);
        // With 1000e18 reserves, 1 wei * 997 / (1000e18*1000 + 997) ~ 0 due to integer division
        // The swap should still not violate k
        if (amountOut > 0) {
            IERC20(token0).transfer(address(pool), 1);
            pool.swap(0, amountOut, alice);
            (uint112 r0After, uint112 r1After) = pool.getReserves();
            uint256 kAfter = uint256(r0After) * uint256(r1After);
            assertGe(kAfter, kBefore, "k should not decrease");
        }
        // If amountOut is 0, the swap would revert with INSUFFICIENT_OUTPUT_AMOUNT (expected)
    }

    function test_should_revert_swap_with_zero_output() public {
        _addLiquidity(1000e18, 1000e18);

        // swap(0,0,...) should revert
        vm.expectRevert("Pool: INSUFFICIENT_OUTPUT_AMOUNT");
        pool.swap(0, 0, alice);
    }

    function test_should_handle_extreme_reserve_ratio() public {
        // Add 1 wei and 1e18 (1:1e18 ratio)
        MockToken(token0).mint(address(this), 1e18);
        MockToken(token1).mint(address(this), 1e18);
        IERC20(token0).transfer(address(pool), 1e9);
        IERC20(token1).transfer(address(pool), 1e18);
        uint256 lp = pool.mint(address(this));
        assertGt(lp, 0, "should mint LP with extreme ratio");

        (uint112 r0, uint112 r1) = pool.getReserves();
        assertEq(r0, 1e9, "reserve0 correct");
        assertEq(r1, 1e18, "reserve1 correct");
    }

    function test_should_revert_on_uint112_overflow() public {
        // Create large amounts exceeding uint112 max
        uint256 overflowAmount = uint256(type(uint112).max) + 1;

        MockToken(token0).mint(address(this), overflowAmount);
        MockToken(token1).mint(address(this), overflowAmount);

        IERC20(token0).transfer(address(pool), overflowAmount);
        IERC20(token1).transfer(address(pool), overflowAmount);

        vm.expectRevert("Pool: OVERFLOW");
        pool.mint(address(this));
    }

    function test_should_handle_minimum_liquidity_boundary() public {
        // sqrt(1001 * 1001) = 1001, 1001 - 1000 = 1 LP token for user
        IERC20(token0).transfer(address(pool), 1001);
        IERC20(token1).transfer(address(pool), 1001);
        uint256 lp = pool.mint(address(this));

        assertEq(lp, 1, "should receive exactly 1 LP token");
        assertEq(pool.balanceOf(DEAD_ADDRESS), MINIMUM_LIQUIDITY, "dead address has MINIMUM_LIQUIDITY");
    }

    function test_should_revert_when_first_deposit_too_small() public {
        // sqrt(999 * 999) = 999, 999 - 1000 would underflow
        IERC20(token0).transfer(address(pool), 999);
        IERC20(token1).transfer(address(pool), 999);

        vm.expectRevert(); // Underflow when subtracting MINIMUM_LIQUIDITY
        pool.mint(address(this));
    }

    function test_should_verify_dead_address_holds_minimum_liquidity() public {
        _addLiquidity(1000e18, 1000e18);

        // Verify dead address holds exactly 1000 LP tokens, permanently locked
        assertEq(pool.balanceOf(DEAD_ADDRESS), MINIMUM_LIQUIDITY, "dead address holds 1000 LP");

        // Verify this LP is part of total supply
        assertGt(pool.totalSupply(), MINIMUM_LIQUIDITY, "total supply > MINIMUM_LIQUIDITY");
    }

    function test_should_handle_swap_after_near_empty_burn() public {
        uint256 lp = _addLiquidity(1000e18, 1000e18);

        // Burn all user LP
        pool.transfer(address(pool), lp);
        pool.burn(address(this));

        // Pool should have only dust amounts corresponding to MINIMUM_LIQUIDITY
        (uint112 r0, uint112 r1) = pool.getReserves();
        assertGt(r0, 0, "reserve0 > 0 after near-empty burn");
        assertGt(r1, 0, "reserve1 > 0 after near-empty burn");

        // Add fresh liquidity and swap to prove pool still works
        MockToken(token0).mint(address(this), 100e18);
        MockToken(token1).mint(address(this), 100e18);
        _addLiquidity(100e18, 100e18);

        (r0, r1) = pool.getReserves();
        uint256 amountIn = 1e18;
        uint256 expectedOut = pool.getAmountOut(amountIn, r0, r1);

        MockToken(token0).mint(address(this), 1e18);
        IERC20(token0).transfer(address(pool), amountIn);
        pool.swap(0, expectedOut, alice);

        assertGt(expectedOut, 0, "swap works after near-empty burn");
    }

    function test_should_revert_getAmountOut_with_zero_input() public {
        vm.expectRevert("Pool: INSUFFICIENT_INPUT_AMOUNT");
        pool.getAmountOut(0, 1000e18, 1000e18);
    }

    function test_should_revert_getAmountOut_with_zero_reserves() public {
        vm.expectRevert("Pool: INSUFFICIENT_LIQUIDITY");
        pool.getAmountOut(1e18, 0, 1e18);
    }
}
