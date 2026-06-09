// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../../src/core/Factory.sol";
import "../../src/core/Pool.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Simple mock ERC20 for Factory tests
contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1_000_000e18);
    }
}

contract FactoryTest is Test {
    Factory public factory;
    MockToken public tokenA;
    MockToken public tokenB;

    address public token0;
    address public token1;

    address public nonOwner = makeAddr("nonOwner");

    function setUp() public {
        factory = new Factory();

        tokenA = new MockToken("Token A", "TKA");
        tokenB = new MockToken("Token B", "TKB");

        // Sort tokens
        if (address(tokenA) < address(tokenB)) {
            token0 = address(tokenA);
            token1 = address(tokenB);
        } else {
            token0 = address(tokenB);
            token1 = address(tokenA);
        }

        vm.label(address(factory), "Factory");
        vm.label(token0, "Token0");
        vm.label(token1, "Token1");
    }

    // ─── Test 1: Create Pool ───────────────────────────────────────────

    function test_CreatePool() public {
        address pool = factory.createPool(address(tokenA), address(tokenB));

        assertTrue(pool != address(0), "Pool address should not be zero");

        // getPair returns same address for both orderings
        assertEq(factory.getPair(token0, token1), pool);
        assertEq(factory.getPair(token1, token0), pool);
    }

    // ─── Test 2: Create Pool Reverse Order ─────────────────────────────

    function test_CreatePoolReverseOrder() public {
        // Create with reversed order — should produce same pool
        address pool = factory.createPool(address(tokenB), address(tokenA));

        // Both lookups should return the same pool
        assertEq(factory.getPair(token0, token1), pool);
        assertEq(factory.getPair(token1, token0), pool);
    }

    // ─── Test 3: Create Pool Emits Event ───────────────────────────────

    function test_CreatePoolEmitsEvent() public {
        // Check indexed params (token0, token1) but not non-indexed data (pair address is unknown beforehand)
        vm.expectEmit(true, true, false, false);
        emit Factory.PairCreated(token0, token1, address(0));

        address poolAddr = factory.createPool(address(tokenA), address(tokenB));

        // Verify the pool was actually created at a non-zero address
        assertTrue(poolAddr != address(0));
    }

    // ─── Test 4: Pool Tokens Correct ───────────────────────────────────

    function test_PoolTokensCorrect() public {
        address poolAddr = factory.createPool(address(tokenA), address(tokenB));
        Pool pool = Pool(poolAddr);

        // Pool should have canonical ordering
        assertEq(pool.token0(), token0);
        assertEq(pool.token1(), token1);
    }

    // ─── Test 5: Pool Name and Symbol ──────────────────────────────────

    function test_PoolNameAndSymbol() public {
        address poolAddr = factory.createPool(address(tokenA), address(tokenB));
        Pool pool = Pool(poolAddr);

        string memory expectedName = string(
            abi.encodePacked(
                "SimpleDEX ",
                ERC20(token0).symbol(),
                "-",
                ERC20(token1).symbol(),
                " LP"
            )
        );
        string memory expectedSymbol = string(
            abi.encodePacked("SLP-", ERC20(token0).symbol(), "-", ERC20(token1).symbol())
        );

        assertEq(pool.name(), expectedName);
        assertEq(pool.symbol(), expectedSymbol);
    }

    // ─── Test 6: Prevent Duplicate Pool ────────────────────────────────

    function test_PreventDuplicatePool() public {
        factory.createPool(address(tokenA), address(tokenB));

        vm.expectRevert("Factory: PAIR_EXISTS");
        factory.createPool(address(tokenA), address(tokenB));
    }

    // ─── Test 7: Prevent Identical Tokens ──────────────────────────────

    function test_PreventIdenticalTokens() public {
        vm.expectRevert("Factory: IDENTICAL_ADDRESSES");
        factory.createPool(address(tokenA), address(tokenA));
    }

    // ─── Test 8: Only Owner Can Create ─────────────────────────────────

    function test_OnlyOwnerCanCreate() public {
        vm.prank(nonOwner);
        vm.expectRevert();
        factory.createPool(address(tokenA), address(tokenB));
    }
}
