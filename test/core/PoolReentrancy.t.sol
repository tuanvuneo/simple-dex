// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../../src/core/Pool.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Attack type enum for MaliciousToken
enum AttackType {
    NONE,
    REENTER_SWAP,
    REENTER_BURN,
    REENTER_MINT
}

/// @dev Malicious ERC20 token that attempts reentrancy during transfer callbacks.
///      When the Pool calls safeTransfer (which calls transfer) to send tokens out
///      during swap or burn, this token re-enters the Pool.
///      Records whether the reentrancy attempt was blocked.
contract MaliciousToken is ERC20 {
    Pool public target;
    AttackType public attackType;
    bool private attacking;

    /// @dev Tracks whether the reentrancy attempt reverted (was blocked)
    bool public reentrancyBlocked;
    /// @dev Tracks whether an attack was attempted
    bool public attackAttempted;

    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setAttack(Pool _target, AttackType _attackType) external {
        target = _target;
        attackType = _attackType;
        reentrancyBlocked = false;
        attackAttempted = false;
    }

    function clearAttack() external {
        attackType = AttackType.NONE;
    }

    /// @dev Override _update (the internal function called by transfer/transferFrom)
    ///      to attempt reentrancy when the Pool is sending tokens out.
    ///      OZ v5 uses _update instead of _beforeTokenTransfer.
    function _update(address from, address to, uint256 value) internal override {
        // Execute the actual transfer first
        super._update(from, to, value);

        // Only attack when:
        // 1. Pool is sending tokens out (from == address(target))
        // 2. We haven't already attacked (preventing infinite recursion)
        // 3. Attack type is set
        if (
            address(target) != address(0) &&
            from == address(target) &&
            !attacking &&
            attackType != AttackType.NONE
        ) {
            attacking = true;
            attackAttempted = true;

            if (attackType == AttackType.REENTER_SWAP) {
                try target.swap(0, 1, address(this)) {
                    // If we get here, reentrancy was NOT blocked (bad!)
                    reentrancyBlocked = false;
                } catch {
                    // Reentrancy was blocked (good!)
                    reentrancyBlocked = true;
                }
            } else if (attackType == AttackType.REENTER_BURN) {
                try target.burn(address(this)) {
                    reentrancyBlocked = false;
                } catch {
                    reentrancyBlocked = true;
                }
            } else if (attackType == AttackType.REENTER_MINT) {
                try target.mint(address(this)) {
                    reentrancyBlocked = false;
                } catch {
                    reentrancyBlocked = true;
                }
            }

            attacking = false;
        }
    }
}

/// @dev Normal mock token for pairing with the malicious one
contract NormalToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract PoolReentrancyTest is Test {
    MaliciousToken public malicious;
    NormalToken public normal;
    Pool public pool;

    address public token0;
    address public token1;
    bool public maliciousIsToken0;

    address public recipient = makeAddr("recipient");

    function setUp() public {
        malicious = new MaliciousToken("Malicious", "MAL");
        normal = new NormalToken("Normal", "NRM");

        // Sort tokens for Pool constructor
        if (address(malicious) < address(normal)) {
            token0 = address(malicious);
            token1 = address(normal);
            maliciousIsToken0 = true;
        } else {
            token0 = address(normal);
            token1 = address(malicious);
            maliciousIsToken0 = false;
        }

        pool = new Pool(token0, token1);

        vm.label(address(pool), "Pool");
        vm.label(address(malicious), "MaliciousToken");
        vm.label(address(normal), "NormalToken");

        // Add initial liquidity (no attack during setup)
        malicious.mint(address(this), 10000e18);
        normal.mint(address(this), 10000e18);

        IERC20(token0).transfer(address(pool), 1000e18);
        IERC20(token1).transfer(address(pool), 1000e18);
        pool.mint(address(this));
    }

    /// @dev Helper: execute a swap that transfers malicious token OUT of the pool
    function _swapOutputtingMaliciousToken(uint256 amountIn) internal {
        (uint112 r0, uint112 r1) = pool.getReserves();

        if (maliciousIsToken0) {
            // Input normal (token1), output malicious (token0)
            uint256 expectedOut = pool.getAmountOut(amountIn, r1, r0);
            IERC20(token1).transfer(address(pool), amountIn);
            pool.swap(expectedOut, 0, recipient);
        } else {
            // Input normal (token0), output malicious (token1)
            uint256 expectedOut = pool.getAmountOut(amountIn, r0, r1);
            IERC20(token0).transfer(address(pool), amountIn);
            pool.swap(0, expectedOut, recipient);
        }
    }

    function test_should_prevent_reentrancy_on_swap() public {
        // Configure malicious token to re-enter swap() during transfer
        malicious.setAttack(pool, AttackType.REENTER_SWAP);

        // Execute swap that sends malicious token out. During safeTransfer,
        // MaliciousToken._update fires and attempts to re-enter swap().
        // ReentrancyGuard blocks the re-entry call.
        _swapOutputtingMaliciousToken(10e18);

        // Verify: the attack was attempted AND blocked by ReentrancyGuard
        assertTrue(malicious.attackAttempted(), "attack should have been attempted");
        assertTrue(malicious.reentrancyBlocked(), "reentrancy on swap should be blocked");
    }

    function test_should_prevent_reentrancy_on_burn() public {
        // Configure malicious token to re-enter burn() during transfer
        malicious.setAttack(pool, AttackType.REENTER_BURN);

        // Transfer LP to pool, then burn.
        // burn() calls safeTransfer for both tokens. When malicious token
        // is transferred, _update fires and tries to re-enter burn().
        uint256 lpBalance = pool.balanceOf(address(this));
        pool.transfer(address(pool), lpBalance);
        pool.burn(recipient);

        // Verify: attack attempted and blocked
        assertTrue(malicious.attackAttempted(), "attack should have been attempted");
        assertTrue(malicious.reentrancyBlocked(), "reentrancy on burn should be blocked");
    }

    function test_should_prevent_cross_function_reentrancy_swap_to_mint() public {
        // Configure malicious token to call mint() during swap's transfer
        malicious.setAttack(pool, AttackType.REENTER_MINT);

        _swapOutputtingMaliciousToken(10e18);

        // Verify: cross-function reentrancy (swap -> mint) blocked
        assertTrue(malicious.attackAttempted(), "attack should have been attempted");
        assertTrue(malicious.reentrancyBlocked(), "cross-function reentrancy swap->mint should be blocked");
    }

    function test_should_prevent_cross_function_reentrancy_swap_to_burn() public {
        // Configure malicious token to call burn() during swap's transfer
        malicious.setAttack(pool, AttackType.REENTER_BURN);

        _swapOutputtingMaliciousToken(10e18);

        // Verify: cross-function reentrancy (swap -> burn) blocked
        assertTrue(malicious.attackAttempted(), "attack should have been attempted");
        assertTrue(malicious.reentrancyBlocked(), "cross-function reentrancy swap->burn should be blocked");
    }
}
