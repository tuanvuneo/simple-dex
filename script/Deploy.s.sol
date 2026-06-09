// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "../src/core/Factory.sol";
import "../src/core/Pool.sol";
import "../src/tokens/WETH.sol";
import "../src/tokens/MockUSDC.sol";

contract Deploy is Script {
    function run() external {
        // Retrieve private key from environment or use Anvil's first default private key
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployerAddress = vm.addr(deployerPrivateKey);

        console.log("Deployer Address:", deployerAddress);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy Factory
        Factory factory = new Factory();
        console.log("Factory Deployed at:", address(factory));

        // 2. Deploy WETH
        WETH weth = new WETH();
        console.log("WETH Deployed at:", address(weth));

        // 3. Deploy MockUSDC
        MockUSDC usdc = new MockUSDC();
        console.log("MockUSDC Deployed at:", address(usdc));

        // 4. Create WETH-USDC Pool via Factory
        address poolAddress = factory.createPool(address(weth), address(usdc));
        Pool pool = Pool(poolAddress);
        console.log("Pool (WETH-USDC) Deployed at:", poolAddress);

        // 5. Add Initial Liquidity: 10 WETH and 20,000 USDC
        uint256 wethLiq = 10 * 10**18;
        uint256 usdcLiq = 20_000 * 10**6;

        // Transfer tokens to the pool contract first
        weth.transfer(poolAddress, wethLiq);
        usdc.transfer(poolAddress, usdcLiq);

        // Mint LP tokens to the deployer
        uint256 lpTokens = pool.mint(deployerAddress);
        console.log("Minted LP tokens to Deployer:", lpTokens);

        vm.stopBroadcast();

        console.log("\n=================== DEPLOYMENT SUMMARY ===================");
        console.log("NEXT_PUBLIC_FACTORY_ADDRESS=", address(factory));
        console.log("NEXT_PUBLIC_WETH_ADDRESS=", address(weth));
        console.log("NEXT_PUBLIC_USDC_ADDRESS=", address(usdc));
        console.log("NEXT_PUBLIC_POOL_ADDRESS=", poolAddress);
        console.log("==========================================================");
    }
}
