// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../../src/tokens/WETH.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract WETHTest is Test {
    WETH public weth;
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

        weth = new WETH();

        // Fund user1 with 10 ETH
        vm.deal(user1, 10 ether);
    }

    function testInitialState() public view {
        assertEq(weth.name(), "Wrapped Ether");
        assertEq(weth.symbol(), "WETH");
        assertEq(weth.decimals(), 18);
        assertEq(weth.balanceOf(owner), 1000 * 10**18);
        assertEq(weth.owner(), owner);
    }

    function testDeposit() public {
        uint256 depositAmount = 1 ether;
        uint256 initialWETHBalance = weth.balanceOf(user1);
        uint256 initialETHBalance = user1.balance;

        vm.prank(user1);
        weth.deposit{value: depositAmount}();

        assertEq(weth.balanceOf(user1), initialWETHBalance + depositAmount);
        assertEq(user1.balance, initialETHBalance - depositAmount);
    }

    function testReceiveETH() public {
        uint256 depositAmount = 1 ether;
        uint256 initialWETHBalance = weth.balanceOf(user1);

        vm.prank(user1);
        (bool success, ) = address(weth).call{value: depositAmount}("");
        require(success, "ETH transfer failed");

        assertEq(weth.balanceOf(user1), initialWETHBalance + depositAmount);
    }

    function testWithdraw() public {
        // First deposit
        uint256 depositAmount = 2 ether;
        vm.prank(user1);
        weth.deposit{value: depositAmount}();

        // Then withdraw
        uint256 withdrawAmount = 1 ether;
        uint256 initialWETHBalance = weth.balanceOf(user1);
        uint256 initialETHBalance = user1.balance;

        vm.prank(user1);
        weth.withdraw(withdrawAmount);

        assertEq(weth.balanceOf(user1), initialWETHBalance - withdrawAmount);
        assertEq(user1.balance, initialETHBalance + withdrawAmount);
    }

    function testWithdrawInsufficientBalance() public {
        vm.prank(user1);
        vm.expectRevert("Insufficient balance");
        weth.withdraw(1 ether);
    }

    function testWithdrawToContract() public {
        // Deploy a simple receiver contract
        SimpleReceiver receiver = new SimpleReceiver();

        // Fund the receiver with WETH
        vm.deal(address(receiver), 5 ether);
        vm.prank(address(receiver));
        weth.deposit{value: 2 ether}();

        // Withdraw from receiver
        uint256 initialETHBalance = address(receiver).balance;
        vm.prank(address(receiver));
        weth.withdraw(1 ether);

        assertEq(address(receiver).balance, initialETHBalance + 1 ether);
    }

    function testMintOnlyOwner() public {
        uint256 mintAmount = 500 * 10**18;

        // Owner can mint
        weth.mint(user1, mintAmount);
        assertEq(weth.balanceOf(user1), mintAmount);

        // Non-owner cannot mint
        vm.prank(user2);
        vm.expectRevert();
        weth.mint(user2, mintAmount);
    }

    function testFaucetUnrestricted() public {
        uint256 faucetAmount = 100 * 10**18;

        // Any user can call faucet
        vm.prank(user1);
        weth.faucet(user1, faucetAmount);
        assertEq(weth.balanceOf(user1), faucetAmount);

        // Another user can also call faucet
        vm.prank(user2);
        weth.faucet(user2, faucetAmount * 2);
        assertEq(weth.balanceOf(user2), faucetAmount * 2);
    }

    function testDepositEvent() public {
        uint256 depositAmount = 1 ether;

        vm.expectEmit(true, false, false, true);
        emit WETH.Deposit(user1, depositAmount);

        vm.prank(user1);
        weth.deposit{value: depositAmount}();
    }

    function testWithdrawalEvent() public {
        // Setup: deposit first
        vm.prank(user1);
        weth.deposit{value: 2 ether}();

        uint256 withdrawAmount = 1 ether;
        vm.expectEmit(true, false, false, true);
        emit WETH.Withdrawal(user1, withdrawAmount);

        vm.prank(user1);
        weth.withdraw(withdrawAmount);
    }

    function testTransferEvent() public {
        uint256 transferAmount = 100 * 10**18;

        vm.expectEmit(true, true, false, true);
        emit IERC20.Transfer(owner, user1, transferAmount);

        weth.transfer(user1, transferAmount);
    }

    function testApproveAndTransferFrom() public {
        uint256 amount = 100 * 10**18;

        // Owner approves user1
        weth.approve(user1, amount);
        assertEq(weth.allowance(owner, user1), amount);

        // user1 transfers from owner to user2
        vm.prank(user1);
        weth.transferFrom(owner, user2, amount);

        assertEq(weth.balanceOf(user2), amount);
        assertEq(weth.balanceOf(owner), 1000 * 10**18 - amount);
        assertEq(weth.allowance(owner, user1), 0);
    }
}

// Simple contract that can receive ETH
contract SimpleReceiver {
    receive() external payable {}
}
