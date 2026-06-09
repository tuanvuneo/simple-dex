// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./Pool.sol";

/// @title SimpleDEX Factory - Pool Creator
/// @notice Creates and registers AMM pools for token pairs using CREATE2 for deterministic addresses.
///         Owner-only pool creation ensures controlled pool deployment for this learning project.
/// @dev CREATE2 enables off-chain address prediction: anyone can compute a pool's address
///      from the factory address + token pair without querying the blockchain.
///      Canonical token ordering (token0 < token1) prevents duplicate pairs regardless of input order.
contract Factory is Ownable {
    // ─── State Variables ──────────────────────────────────────────────

    /// @notice Bidirectional mapping for O(1) pool lookup regardless of token order.
    /// @dev Both getPair[A][B] and getPair[B][A] return the same pool address.
    ///      This convenience means callers don't need to sort tokens before looking up a pool.
    mapping(address => mapping(address => address)) public getPair;

    // ─── Events ───────────────────────────────────────────────────────

    event PairCreated(address indexed token0, address indexed token1, address pair);

    // ─── Constructor ──────────────────────────────────────────────────

    /// @notice Deploys the Factory with the caller as owner
    /// @dev Owner-only pool creation is a deliberate simplification for this learning project.
    ///      Production DEXes (like Uniswap) use permissionless pool creation.
    constructor() Ownable(msg.sender) {}

    // ─── Core Functions ───────────────────────────────────────────────

    /// @notice Creates a new AMM pool for a token pair
    /// @dev Uses CREATE2 for deterministic deployment. Tokens are sorted internally
    ///      to ensure canonical ordering, so createPool(A, B) and createPool(B, A) behave identically.
    ///
    ///      CREATE2 address = keccak256(0xff ++ factory_address ++ salt ++ keccak256(init_code))
    ///      where salt = keccak256(abi.encodePacked(token0, token1))
    ///      and init_code = Pool.creationCode ++ abi.encode(token0, token1)
    ///
    ///      WHY CREATE2? Deterministic addresses enable:
    ///      1. Off-chain address computation (no blockchain query needed)
    ///      2. Guaranteed uniqueness per token pair (same salt = same address)
    ///      3. Frontend can predict pool addresses before they exist
    /// @param tokenA First token address (order doesn't matter)
    /// @param tokenB Second token address (order doesn't matter)
    /// @return pool The address of the newly created Pool contract
    function createPool(address tokenA, address tokenB) external onlyOwner returns (address pool) {
        // CHECKS: Validate inputs
        require(tokenA != tokenB, "Factory: IDENTICAL_ADDRESSES");

        // Canonical ordering: smaller address is token0
        // WHY? Prevents duplicate pairs — createPool(A,B) and createPool(B,A)
        // would generate different salts without sorting, creating two pools for the same pair.
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);

        require(token0 != address(0), "Factory: ZERO_ADDRESS");
        require(getPair[token0][token1] == address(0), "Factory: PAIR_EXISTS");

        // CREATE2 deployment with constructor arguments encoded in init code
        // In Solidity 0.8.28, we can encode constructor params directly with creationCode
        // (cleaner than Uniswap V2's separate initialize() pattern)
        bytes memory bytecode = abi.encodePacked(type(Pool).creationCode, abi.encode(token0, token1));
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));

        assembly {
            pool := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        require(pool != address(0), "Factory: CREATE2_FAILED");

        // REGISTER: Bidirectional mapping for convenient lookup
        // Both getPair[A][B] and getPair[B][A] return the same pool
        getPair[token0][token1] = pool;
        getPair[token1][token0] = pool;

        emit PairCreated(token0, token1, pool);
    }
}
