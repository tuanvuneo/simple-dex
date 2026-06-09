// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../../src/core/Pool.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev Mock token for invariant testing
contract InvMockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Handler contract that wraps Pool operations with valid bounds.
///      Tracks k baseline that adjusts after burns (k decreases on liquidity removal is expected).
///      Invariant: k should never decrease due to swaps (fees make k grow).
contract PoolHandler is Test {
    Pool public pool;
    InvMockToken public token0;
    InvMockToken public token1;

    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    /// @dev Tracks the k value baseline. Updated after mints and burns.
    ///      Swaps should only increase k from this baseline.
    uint256 public kBaseline;

    /// @dev Address that can initialize baseline (set once during setup)
    address private immutable deployer;

    constructor(Pool _pool, InvMockToken _token0, InvMockToken _token1) {
        pool = _pool;
        token0 = _token0;
        token1 = _token1;
        deployer = msg.sender;
    }

    /// @dev Only callable by deployer during setup, not by the fuzzer
    function initKBaseline(uint256 _k) external {
        require(msg.sender == deployer, "only deployer");
        kBaseline = _k;
    }

    function _updateKBaseline() internal {
        (uint112 r0, uint112 r1) = pool.getReserves();
        kBaseline = uint256(r0) * uint256(r1);
    }

    /// @dev Add liquidity with bounded random amounts
    function addLiquidity(uint256 amount0, uint256 amount1) external {
        amount0 = bound(amount0, 1e6, 1e24);
        amount1 = bound(amount1, 1e6, 1e24);

        token0.mint(address(this), amount0);
        token1.mint(address(this), amount1);

        IERC20(address(token0)).transfer(address(pool), amount0);
        IERC20(address(token1)).transfer(address(pool), amount1);

        pool.mint(address(this));
        _updateKBaseline(); // Reset baseline after mint (k increases with liquidity)
    }

    /// @dev Swap token0 for token1 with bounded random amount
    function swapToken0ForToken1(uint256 amountIn) external {
        (uint112 r0, uint112 r1) = pool.getReserves();
        if (r0 == 0 || r1 == 0) return;

        amountIn = bound(amountIn, 1e6, uint256(r0) / 2);

        uint256 expectedOut = pool.getAmountOut(amountIn, r0, r1);
        if (expectedOut == 0) return;

        token0.mint(address(this), amountIn);
        IERC20(address(token0)).transfer(address(pool), amountIn);
        pool.swap(0, expectedOut, address(this));
        // Do NOT update baseline — swaps should only increase k
    }

    /// @dev Swap token1 for token0 with bounded random amount
    function swapToken1ForToken0(uint256 amountIn) external {
        (uint112 r0, uint112 r1) = pool.getReserves();
        if (r0 == 0 || r1 == 0) return;

        amountIn = bound(amountIn, 1e6, uint256(r1) / 2);

        uint256 expectedOut = pool.getAmountOut(amountIn, r1, r0);
        if (expectedOut == 0) return;

        token1.mint(address(this), amountIn);
        IERC20(address(token1)).transfer(address(pool), amountIn);
        pool.swap(expectedOut, 0, address(this));
        // Do NOT update baseline — swaps should only increase k
    }

    /// @dev Remove liquidity with bounded random fraction
    function removeLiquidity(uint256 fraction) external {
        uint256 lpBalance = pool.balanceOf(address(this));
        if (lpBalance == 0) return;

        fraction = bound(fraction, 1, 100);
        uint256 burnAmount = (lpBalance * fraction) / 100;
        if (burnAmount == 0) return;

        (uint112 r0, uint112 r1) = pool.getReserves();
        uint256 totalSupply = pool.totalSupply();
        uint256 expected0 = (burnAmount * uint256(r0)) / totalSupply;
        uint256 expected1 = (burnAmount * uint256(r1)) / totalSupply;
        if (expected0 == 0 || expected1 == 0) return;

        pool.transfer(address(pool), burnAmount);
        pool.burn(address(this));
        _updateKBaseline(); // Reset baseline after burn (k naturally decreases)
    }
}

contract PoolInvariantTest is Test {
    Pool public pool;
    InvMockToken public tokenA;
    InvMockToken public tokenB;
    PoolHandler public handler;

    address public token0;
    address public token1;

    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    address private constant DEAD_ADDRESS = address(0xdEaD);

    function setUp() public {
        tokenA = new InvMockToken("Token A", "TKA");
        tokenB = new InvMockToken("Token B", "TKB");

        if (address(tokenA) < address(tokenB)) {
            token0 = address(tokenA);
            token1 = address(tokenB);
        } else {
            token0 = address(tokenB);
            token1 = address(tokenA);
        }

        pool = new Pool(token0, token1);

        // Create handler and add initial liquidity
        handler = new PoolHandler(pool, InvMockToken(token0), InvMockToken(token1));

        // Add initial liquidity through handler
        InvMockToken(token0).mint(address(handler), 1000e18);
        InvMockToken(token1).mint(address(handler), 1000e18);

        vm.prank(address(handler));
        IERC20(token0).transfer(address(pool), 1000e18);
        vm.prank(address(handler));
        IERC20(token1).transfer(address(pool), 1000e18);
        vm.prank(address(handler));
        pool.mint(address(handler));

        // Record initial k baseline
        (uint112 r0, uint112 r1) = pool.getReserves();
        handler.initKBaseline(uint256(r0) * uint256(r1));

        // Tell Foundry to only call specific functions on the handler
        targetContract(address(handler));

        // Explicitly select only the pool operation functions (exclude initKBaseline)
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = handler.addLiquidity.selector;
        selectors[1] = handler.swapToken0ForToken1.selector;
        selectors[2] = handler.swapToken1ForToken0.selector;
        selectors[3] = handler.removeLiquidity.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// @notice k should never decrease due to swaps (fees cause k to grow).
    ///         The kBaseline is reset after mints and burns, so this invariant
    ///         specifically catches k violations from swap operations.
    function invariant_constant_product_never_decreases() external view {
        (uint112 r0, uint112 r1) = pool.getReserves();
        uint256 k = uint256(r0) * uint256(r1);
        assertGe(k, handler.kBaseline(), "k decreased below baseline (swap fee violation)");
    }

    /// @notice Token balances in pool should always be >= stored reserves
    ///         (direct transfers can increase balance above reserves)
    function invariant_reserves_match_token_balances() external view {
        (uint112 r0, uint112 r1) = pool.getReserves();
        assertGe(
            IERC20(token0).balanceOf(address(pool)),
            uint256(r0),
            "token0 balance < reserve0"
        );
        assertGe(
            IERC20(token1).balanceOf(address(pool)),
            uint256(r1),
            "token1 balance < reserve1"
        );
    }

    /// @notice After first mint, total supply should always be >= MINIMUM_LIQUIDITY
    function invariant_total_supply_greater_than_minimum_liquidity() external view {
        assertGe(pool.totalSupply(), MINIMUM_LIQUIDITY, "totalSupply < MINIMUM_LIQUIDITY");
    }

    /// @notice Dead address should always hold exactly MINIMUM_LIQUIDITY
    function invariant_dead_address_always_holds_minimum_liquidity() external view {
        assertEq(
            pool.balanceOf(DEAD_ADDRESS),
            MINIMUM_LIQUIDITY,
            "dead address doesn't hold MINIMUM_LIQUIDITY"
        );
    }
}
