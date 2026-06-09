// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @title SimpleDEX Pool - Constant Product AMM
/// @notice Implements x*y=k automated market maker with 0.3% swap fee.
///         The Pool IS the LP token (inherits ERC20), following Uniswap V2's elegant pattern.
/// @dev Security: CEI pattern + ReentrancyGuard on all state-changing functions.
///      Educational comments explain WHY each pattern exists.
contract Pool is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── State Variables ──────────────────────────────────────────────

    /// @notice First token in the pair (sorted by address, smaller address)
    address public immutable token0;

    /// @notice Second token in the pair (sorted by address, larger address)
    address public immutable token1;

    /// @dev Token0 reserves stored as uint112 for two reasons:
    ///      1. Storage packing: reserve0 + reserve1 fit in a single 256-bit slot (saves ~2100 gas per SLOAD)
    ///      2. Overflow safety: uint112 * uint112 = uint224, safely fits in uint256 for invariant checks
    uint112 private reserve0;
    uint112 private reserve1;

    /// @notice Minimum liquidity permanently locked on first deposit to prevent inflation attack.
    /// @dev WHY: Without this, an attacker could:
    ///      1. Deposit 1 wei of each token (tiny initial liquidity)
    ///      2. Donate large amounts directly to the pool (manipulating LP token value)
    ///      3. When next user deposits, they receive 0 LP tokens (due to rounding)
    ///      4. Attacker burns their LP tokens and steals the donated + deposited amounts
    ///      Locking 1000 LP tokens permanently makes this attack economically infeasible.
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    /// @dev Dead address for permanently locking MINIMUM_LIQUIDITY.
    ///      OpenZeppelin v5 ERC20 reverts on mint/transfer to address(0),
    ///      so we use address(0xdead) as a conventional burn address.
    address private constant DEAD_ADDRESS = address(0xdEaD);

    // ─── Events ───────────────────────────────────────────────────────

    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);

    // ─── Constructor ──────────────────────────────────────────────────

    /// @notice Creates a new AMM pool for the given token pair
    /// @param _token0 Address of the first token (must be < _token1 for canonical ordering)
    /// @param _token1 Address of the second token
    /// @dev Factory ensures _token0 < _token1 before deploying. LP token name/symbol are
    ///      auto-generated from the pair tokens (e.g., "SimpleDEX WETH-USDC LP" / "SLP-WETH-USDC").
    constructor(address _token0, address _token1)
        ERC20(
            string(
                abi.encodePacked(
                    "SimpleDEX ",
                    IERC20Metadata(_token0).symbol(),
                    "-",
                    IERC20Metadata(_token1).symbol(),
                    " LP"
                )
            ),
            string(
                abi.encodePacked(
                    "SLP-",
                    IERC20Metadata(_token0).symbol(),
                    "-",
                    IERC20Metadata(_token1).symbol()
                )
            )
        )
    {
        require(_token0 < _token1, "Pool: INVALID_TOKEN_ORDER");
        token0 = _token0;
        token1 = _token1;
    }

    // ─── View Functions ───────────────────────────────────────────────

    /// @notice Returns the current reserves of both tokens in the pool
    /// @return _reserve0 Current reserve of token0
    /// @return _reserve1 Current reserve of token1
    function getReserves() public view returns (uint112 _reserve0, uint112 _reserve1) {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
    }

    /// @notice Calculates the output amount for a given input amount and reserves
    /// @dev Formula derivation from x*y=k:
    ///      Given: x*y = k (invariant), fee = 0.3%
    ///      After swap: (x + dx*0.997) * (y - dy) = x * y
    ///      Solving for dy: dy = (dx * 0.997 * y) / (x + dx * 0.997)
    ///      In integer math: amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
    /// @param amountIn The input token amount
    /// @param reserveIn The reserve of the input token
    /// @param reserveOut The reserve of the output token
    /// @return amountOut The calculated output amount after 0.3% fee
    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure returns (uint256 amountOut) {
        require(amountIn > 0, "Pool: INSUFFICIENT_INPUT_AMOUNT");
        require(reserveIn > 0 && reserveOut > 0, "Pool: INSUFFICIENT_LIQUIDITY");

        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * 1000 + amountInWithFee;
        amountOut = numerator / denominator;
    }

    // ─── Core Functions ───────────────────────────────────────────────

    /// @notice Adds liquidity to the pool and mints LP tokens
    /// @dev User must transfer tokens to the pool BEFORE calling mint (Uniswap V2 pattern).
    ///      This "transfer-then-call" pattern enables flash swaps and composability.
    ///
    ///      First deposit: LP tokens = sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY
    ///      WHY geometric mean? It balances both token values fairly regardless of token prices.
    ///      If we used sum or product, attackers could manipulate the ratio to gain unfair LP share.
    ///
    ///      Subsequent deposits: LP tokens = min(amount0/reserve0, amount1/reserve1) * totalSupply
    ///      WHY Math.min? Using the minimum protects the pool from ratio manipulation.
    ///      If a user deposits tokens in a different ratio than the pool, they get LP tokens
    ///      proportional to the LESSER side, effectively donating the excess to existing LPs.
    /// @param to Address to receive LP tokens
    /// @return liquidity Amount of LP tokens minted
    function mint(address to) external nonReentrant returns (uint256 liquidity) {
        (uint112 _reserve0, uint112 _reserve1) = (reserve0, reserve1);

        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));

        uint256 amount0 = balance0 - _reserve0;
        uint256 amount1 = balance1 - _reserve1;

        uint256 _totalSupply = totalSupply();

        if (_totalSupply == 0) {
            // First deposit: geometric mean minus minimum liquidity
            liquidity = Math.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;

            // Permanently lock MINIMUM_LIQUIDITY to dead address to prevent inflation attack
            // Note: OpenZeppelin v5 ERC20 rejects mint to address(0), so we use 0xdead
            _mint(DEAD_ADDRESS, MINIMUM_LIQUIDITY);
        } else {
            // Subsequent deposits: proportional to existing reserves (take minimum)
            liquidity = Math.min(
                (amount0 * _totalSupply) / _reserve0,
                (amount1 * _totalSupply) / _reserve1
            );
        }

        require(liquidity > 0, "Pool: INSUFFICIENT_LIQUIDITY_MINTED");
        _mint(to, liquidity);

        _update(balance0, balance1);
        emit Mint(msg.sender, amount0, amount1);
    }

    /// @notice Removes liquidity from the pool by burning LP tokens
    /// @dev User must transfer LP tokens to the pool BEFORE calling burn.
    ///      Withdrawal is always proportional: if you own 10% of LP supply, you get 10% of each reserve.
    ///      Rounding favors the pool (rounds down) to prevent drain attacks from dust amounts.
    /// @param to Address to receive the withdrawn tokens
    /// @return amount0 Amount of token0 withdrawn
    /// @return amount1 Amount of token1 withdrawn
    function burn(address to) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 liquidity = balanceOf(address(this));

        uint256 _totalSupply = totalSupply();

        // Pro-rata distribution: proportional share of both reserves
        amount0 = (liquidity * balance0) / _totalSupply;
        amount1 = (liquidity * balance1) / _totalSupply;

        require(amount0 > 0 && amount1 > 0, "Pool: INSUFFICIENT_LIQUIDITY_BURNED");

        // CEI pattern: burn LP tokens (effect) before external transfers (interaction)
        _burn(address(this), liquidity);

        // Safe transfers handle non-standard ERC20 tokens (no return value, false instead of revert)
        IERC20(token0).safeTransfer(to, amount0);
        IERC20(token1).safeTransfer(to, amount1);

        // Get balances AFTER transfers and update reserves
        balance0 = IERC20(token0).balanceOf(address(this));
        balance1 = IERC20(token1).balanceOf(address(this));

        _update(balance0, balance1);
        emit Burn(msg.sender, amount0, amount1, to);
    }

    /// @notice Executes a token swap using the constant product formula with 0.3% fee
    /// @dev Follows Uniswap V2 swap pattern exactly. User transfers input tokens to the pool
    ///      BEFORE calling swap, then specifies desired output amounts.
    ///
    ///      Fee mechanics (0.3%):
    ///      Instead of deducting fee explicitly, we verify the invariant with adjusted balances:
    ///        balance0Adjusted = balance0 * 1000 - amount0In * 3
    ///        balance1Adjusted = balance1 * 1000 - amount1In * 3
    ///        balance0Adjusted * balance1Adjusted >= reserve0 * reserve1 * 1000^2
    ///
    ///      This ensures that 0.3% of input stays in the pool as fees.
    ///      Fees accumulate in reserves, increasing LP token value over time.
    ///      LPs claim fees by burning LP tokens (their proportional share has grown).
    ///
    ///      CEI pattern: CHECKS (validate) -> transfer outputs -> verify invariant -> UPDATE reserves
    ///      Combined with nonReentrant, this prevents reentrancy through token callbacks.
    /// @param amount0Out Desired amount of token0 to receive
    /// @param amount1Out Desired amount of token1 to receive
    /// @param to Address to receive output tokens
    function swap(uint256 amount0Out, uint256 amount1Out, address to) external nonReentrant {
        // CHECKS: Validate all inputs and preconditions
        require(amount0Out > 0 || amount1Out > 0, "Pool: INSUFFICIENT_OUTPUT_AMOUNT");

        (uint112 _reserve0, uint112 _reserve1) = (reserve0, reserve1);
        require(amount0Out < _reserve0 && amount1Out < _reserve1, "Pool: INSUFFICIENT_LIQUIDITY");
        require(to != token0 && to != token1, "Pool: INVALID_TO");

        // Transfer output tokens using SafeERC20
        if (amount0Out > 0) IERC20(token0).safeTransfer(to, amount0Out);
        if (amount1Out > 0) IERC20(token1).safeTransfer(to, amount1Out);

        // Get balances after transfers to calculate input amounts
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));

        // Calculate input amounts from balance differences
        uint256 amount0In = balance0 > (_reserve0 - amount0Out) ? balance0 - (_reserve0 - amount0Out) : 0;
        uint256 amount1In = balance1 > (_reserve1 - amount1Out) ? balance1 - (_reserve1 - amount1Out) : 0;

        require(amount0In > 0 || amount1In > 0, "Pool: INSUFFICIENT_INPUT_AMOUNT");

        // Verify x*y=k invariant with 0.3% fee adjustment
        // The fee is enforced by requiring the adjusted product to be >= the previous product.
        // Multiplying by 1000 and subtracting amountIn * 3 effectively applies a 0.3% fee.
        uint256 balance0Adjusted = balance0 * 1000 - amount0In * 3;
        uint256 balance1Adjusted = balance1 * 1000 - amount1In * 3;

        require(
            balance0Adjusted * balance1Adjusted >= uint256(_reserve0) * uint256(_reserve1) * (1000 ** 2),
            "Pool: K"
        );

        _update(balance0, balance1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    // ─── Internal Functions ───────────────────────────────────────────

    /// @dev Updates reserves to match current token balances. Called after every state change.
    ///      Emits Sync event for off-chain tracking of reserve changes.
    /// @param balance0 Current balance of token0 in the pool
    /// @param balance1 Current balance of token1 in the pool
    function _update(uint256 balance0, uint256 balance1) private {
        // Ensure balances fit in uint112 to maintain storage packing safety
        require(balance0 <= type(uint112).max && balance1 <= type(uint112).max, "Pool: OVERFLOW");

        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);

        emit Sync(reserve0, reserve1);
    }
}
