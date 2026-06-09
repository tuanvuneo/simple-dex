// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../../src/tokens/MockUSDC.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockUSDCTest is Test {
    MockUSDC public usdc;
    address public owner;
    address public user1;
    address public user2;

    function setUp() public {
        owner = address(this);
        user1 = address(0x1);
        user2 = address(0x2);

        vm.label(owner, "owner");
        vm.label(user1, "user1");
        vm.label(user2, "user2");

        usdc = new MockUSDC();
    }

    function testInitialState() public view {
        assertEq(usdc.name(), "USD Coin");
        assertEq(usdc.symbol(), "USDC");
        assertEq(usdc.decimals(), 6, "USDC must have 6 decimals");
        assertEq(usdc.balanceOf(owner), 2_000_000 * 10**6);
        assertEq(usdc.owner(), owner);
    }

    function testDecimalsExplicitly() public view {
        assertEq(usdc.decimals(), 6, "USDC must have 6 decimals");
    }

    function testTransfer() public {
        uint256 transferAmount = 10_000 * 10**6; // 10,000 USDC
        uint256 initialOwnerBalance = usdc.balanceOf(owner);
        uint256 initialUser1Balance = usdc.balanceOf(user1);

        usdc.transfer(user1, transferAmount);

        assertEq(usdc.balanceOf(owner), initialOwnerBalance - transferAmount);
        assertEq(usdc.balanceOf(user1), initialUser1Balance + transferAmount);
    }

    function testApproveAndTransferFrom() public {
        uint256 amount = 5_000 * 10**6; // 5,000 USDC

        // Owner approves user1
        usdc.approve(user1, amount);
        assertEq(usdc.allowance(owner, user1), amount);

        // user1 transfers from owner to user2
        vm.prank(user1);
        usdc.transferFrom(owner, user2, amount);

        assertEq(usdc.balanceOf(user2), amount);
        assertEq(usdc.balanceOf(owner), 2_000_000 * 10**6 - amount);
        assertEq(usdc.allowance(owner, user1), 0);
    }

    function testMintOnlyOwner() public {
        uint256 mintAmount = 100_000 * 10**6; // 100,000 USDC

        // Owner can mint
        usdc.mint(user1, mintAmount);
        assertEq(usdc.balanceOf(user1), mintAmount);

        // Non-owner cannot mint
        vm.prank(user2);
        vm.expectRevert();
        usdc.mint(user2, mintAmount);
    }

    function testFaucetUnrestricted() public {
        uint256 faucetAmount = 50_000 * 10**6; // 50,000 USDC

        // Any user can call faucet
        vm.prank(user1);
        usdc.faucet(user1, faucetAmount);
        assertEq(usdc.balanceOf(user1), faucetAmount);

        // Another user can also call faucet
        vm.prank(user2);
        usdc.faucet(user2, faucetAmount * 2);
        assertEq(usdc.balanceOf(user2), faucetAmount * 2);
    }

    function testFaucetWithSpecificAmounts() public {
        uint256 amount = 10_000 * 10**6; // 10,000 USDC

        usdc.faucet(user1, amount);

        assertEq(usdc.balanceOf(user1), amount, "Faucet should mint exactly 10,000 USDC");
    }

    function testTransferEvent() public {
        uint256 transferAmount = 1_000 * 10**6; // 1,000 USDC

        vm.expectEmit(true, true, false, true);
        emit IERC20.Transfer(owner, user1, transferAmount);

        usdc.transfer(user1, transferAmount);
    }

    function testTotalSupplyAfterMultipleMints() public {
        uint256 initialSupply = usdc.totalSupply();
        uint256 mintAmount1 = 100_000 * 10**6;
        uint256 mintAmount2 = 200_000 * 10**6;

        usdc.mint(user1, mintAmount1);
        usdc.mint(user2, mintAmount2);

        assertEq(usdc.totalSupply(), initialSupply + mintAmount1 + mintAmount2);
    }

    function testZeroTransfer() public {
        // ERC20 allows zero transfers
        usdc.transfer(user1, 0);
        assertEq(usdc.balanceOf(user1), 0);
    }
}
