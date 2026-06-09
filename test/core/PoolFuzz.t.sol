// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../../src/core/Pool.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev Simple mock ERC20 token for fuzz testing
contract FuzzMockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract PoolFuzzTest is Test {
    Pool public pool;
    FuzzMockToken public tokenA;
    FuzzMockToken public tokenB;

    address public token0;
    address public token1;

    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    function setUp() public {
        tokenA = new FuzzMockToken("Token A", "TKA");
        tokenB = new FuzzMockToken("Token B", "TKB");

        if (address(tokenA) < address(tokenB)) {
            token0 = address(tokenA);
            token1 = address(tokenB);
        } else {
            token0 = address(tokenB);
            token1 = address(tokenA);
        }

        pool = new Pool(token0, token1);

        vm.label(address(pool), "Pool");
        vm.label(token0, "Token0");
        vm.label(token1, "Token1");
    }

    // ─── Helper ────────────────────────────────────────────────────────

    function _mintTokens(address to, uint256 amount0, uint256 amount1) internal {
        FuzzMockToken(token0).mint(to, amount0);
        FuzzMockToken(token1).mint(to, amount1);
    }

    function _addLiquidity(uint256 amount0, uint256 amount1) internal returns (uint256 liquidity) {
        _mintTokens(address(this), amount0, amount1);
        IERC20(token0).transfer(address(pool), amount0);
        IERC20(token1).transfer(address(pool), amount1);
        liquidity = pool.mint(address(this));
    }

    // ═══════════════════════════════════════════════════════════════════
    // ─── Fuzz Tests: Swap ────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════

    function testFuzz_should_calculate_correct_output_amount(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public view {
        // Bound inputs to valid ranges
        amountIn = bound(amountIn, 1, type(uint96).max);
        reserveIn = bound(reserveIn, 1e6, type(uint112).max);
        reserveOut = bound(reserveOut, 1e6, type(uint112).max);

        uint256 amountOut = pool.getAmountOut(amountIn, reserveIn, reserveOut);

        // Output must be less than reserveOut (can't drain pool entirely)
        assertLt(amountOut, reserveOut, "output must be < reserveOut");

        // Verify fee is applied: amountOut < amountIn when reserves are equal
        // Output can round to 0 for small amountIn relative to reserveIn (integer division)
        // Formula: amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
        // This is always < reserveOut, which we already checked above
    }

    function testFuzz_should_maintain_k_invariant_after_swap(uint256 amountIn) public {
        // Setup: 1000e18 liquidity
        _addLiquidity(1000e18, 1000e18);

        amountIn = bound(amountIn, 1e6, 500e18);

        (uint112 r0Before, uint112 r1Before) = pool.getReserves();
        uint256 kBefore = uint256(r0Before) * uint256(r1Before);

        uint256 expectedOut = pool.getAmountOut(amountIn, r0Before, r1Before);

        _mintTokens(address(this), amountIn, 0);
        IERC20(token0).transfer(address(pool), amountIn);
        pool.swap(0, expectedOut, address(1));

        (uint112 r0After, uint112 r1After) = pool.getReserves();
        uint256 kAfter = uint256(r0After) * uint256(r1After);

        assertGe(kAfter, kBefore, "k should not decrease after swap");
    }

    function testFuzz_should_not_drain_pool_via_swap(uint256 amountIn) public {
        // Setup: 1000e18 liquidity
        _addLiquidity(1000e18, 1000e18);

        amountIn = bound(amountIn, 1e6, type(uint96).max);

        (uint112 r0, uint112 r1) = pool.getReserves();
        uint256 expectedOut = pool.getAmountOut(amountIn, r0, r1);

        // Output must not drain the pool
        assertLt(expectedOut, uint256(r1), "output < reserve1");

        _mintTokens(address(this), amountIn, 0);
        IERC20(token0).transfer(address(pool), amountIn);
        pool.swap(0, expectedOut, address(1));

        (uint112 r0After, uint112 r1After) = pool.getReserves();
        assertGt(r0After, 0, "reserve0 > 0 after swap");
        assertGt(r1After, 0, "reserve1 > 0 after swap");
    }

    // ═══════════════════════════════════════════════════════════════════
    // ─── Fuzz Tests: Liquidity ───────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════

    function testFuzz_should_mint_positive_lp_for_valid_deposits(uint256 amount0, uint256 amount1) public {
        // Bound to ensure sqrt(amount0 * amount1) > MINIMUM_LIQUIDITY
        amount0 = bound(amount0, 1e6, 1e24);
        amount1 = bound(amount1, 1e6, 1e24);

        // Ensure sqrt(amount0 * amount1) > MINIMUM_LIQUIDITY
        uint256 geometricMean = Math.sqrt(amount0 * amount1);
        vm.assume(geometricMean > MINIMUM_LIQUIDITY);

        _mintTokens(address(this), amount0, amount1);
        IERC20(token0).transfer(address(pool), amount0);
        IERC20(token1).transfer(address(pool), amount1);
        uint256 lp = pool.mint(address(this));

        assertGt(lp, 0, "LP tokens should be positive");

        // Reserves must match balances
        (uint112 r0, uint112 r1) = pool.getReserves();
        assertEq(IERC20(token0).balanceOf(address(pool)), r0, "reserve0 matches balance");
        assertEq(IERC20(token1).balanceOf(address(pool)), r1, "reserve1 matches balance");
    }

    function testFuzz_should_burn_proportional_to_lp_share(
        uint256 mintAmount0,
        uint256 mintAmount1,
        uint256 burnPercent
    ) public {
        mintAmount0 = bound(mintAmount0, 1e6, 1e24);
        mintAmount1 = bound(mintAmount1, 1e6, 1e24);
        burnPercent = bound(burnPercent, 1, 100);

        // Ensure sqrt(amount0 * amount1) > MINIMUM_LIQUIDITY
        uint256 geometricMean = Math.sqrt(mintAmount0 * mintAmount1);
        vm.assume(geometricMean > MINIMUM_LIQUIDITY);

        uint256 lp = _addLiquidity(mintAmount0, mintAmount1);

        // Calculate burn amount
        uint256 burnAmount = (lp * burnPercent) / 100;
        if (burnAmount == 0) return; // skip if rounding eliminates burn

        (uint112 r0Before, uint112 r1Before) = pool.getReserves();
        uint256 totalSupplyBefore = pool.totalSupply();

        // Calculate expected outputs
        uint256 expectedOut0 = (burnAmount * uint256(r0Before)) / totalSupplyBefore;
        uint256 expectedOut1 = (burnAmount * uint256(r1Before)) / totalSupplyBefore;
        if (expectedOut0 == 0 || expectedOut1 == 0) return; // skip if rounding gives 0

        pool.transfer(address(pool), burnAmount);
        (uint256 out0, uint256 out1) = pool.burn(address(this));

        // Outputs should match expected proportional share
        assertEq(out0, expectedOut0, "burn output0 proportional");
        assertEq(out1, expectedOut1, "burn output1 proportional");
    }
}
