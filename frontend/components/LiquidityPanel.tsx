"use client";

import { useState, useEffect } from "react";
import {
  useAccount,
  useReadContracts,
  useWriteContract,
  usePublicClient,
} from "wagmi";
import { parseUnits, formatUnits } from "viem";
import { erc20Abi } from "@/abi/ERC20";
import { poolAbi } from "@/abi/Pool";
import {
  POOL_ADDRESS,
  WETH_ADDRESS,
  USDC_ADDRESS,
  WETH_DECIMALS,
  USDC_DECIMALS,
} from "@/lib/constants";
import { TxStatus } from "@/components/TxStatus";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Simple BigInt square root helper
function bigintSqrt(value: bigint): bigint {
  if (value < 0n) throw new Error("negative value");
  if (value < 2n) return value;
  let x0 = value / 2n;
  let x1 = (x0 + value / x0) / 2n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) / 2n;
  }
  return x0;
}

type TxPhase =
  | "idle"
  | "weth-pending" // waiting for user to sign WETH transfer
  | "weth-confirming" // WETH transfer sent, confirming
  | "usdc-pending" // waiting for user to sign USDC transfer
  | "usdc-confirming" // USDC transfer sent, confirming
  | "mint-pending" // waiting for user to sign mint
  | "mint-confirming" // mint tx sent, confirming
  | "lp-transfer-pending" // waiting for user to sign LP transfer (remove)
  | "lp-transfer-confirming" // LP transfer confirming
  | "burn-pending" // waiting for user to sign burn
  | "burn-confirming" // burn tx confirming
  | "success";

interface LiquidityPanelProps {
  onSuccess?: () => void;
}

export function LiquidityPanel({ onSuccess }: LiquidityPanelProps) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  // Tab State: 'add' or 'remove'
  const [activeTab, setActiveTab] = useState<"add" | "remove">("add");

  // Add Liquidity State
  const [wethInput, setWethInput] = useState("");
  const [usdcInput, setUsdcInput] = useState("");
  const [addTxHash, setAddTxHash] = useState<`0x${string}` | undefined>(
    undefined,
  );
  const [addError, setAddError] = useState<string | null>(null);

  // Remove Liquidity State
  const [lpInput, setLpInput] = useState("");
  const [removeTxHash, setRemoveTxHash] = useState<`0x${string}` | undefined>(
    undefined,
  );
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Transaction phase
  const [txPhase, setTxPhase] = useState<TxPhase>("idle");

  const isAdding =
    txPhase !== "idle" && txPhase !== "success" && activeTab === "add";
  const isRemoving =
    txPhase !== "idle" && txPhase !== "success" && activeTab === "remove";
  const isBusy = isAdding || isRemoving;

  // Contract Reads
  const poolEnabled = POOL_ADDRESS !== ZERO_ADDRESS;

  const { data: poolData, refetch: refetchPool } = useReadContracts({
    contracts: [
      {
        address: POOL_ADDRESS,
        abi: poolAbi,
        functionName: "getReserves",
      },
      {
        address: POOL_ADDRESS,
        abi: poolAbi,
        functionName: "token0",
      },
      {
        address: POOL_ADDRESS,
        abi: poolAbi,
        functionName: "token1",
      },
      // Balances & Total Supply
      {
        address: WETH_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address ?? ZERO_ADDRESS],
      },
      {
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address ?? ZERO_ADDRESS],
      },
      {
        address: POOL_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address ?? ZERO_ADDRESS],
      },
      {
        address: POOL_ADDRESS,
        abi: poolAbi,
        functionName: "totalSupply",
      },
    ],
    query: { enabled: poolEnabled },
  });

  const reserves = poolData?.[0]?.result as
    | readonly [bigint, bigint]
    | undefined;
  const token0 = poolData?.[1]?.result as `0x${string}` | undefined;
  const wethUserBal = poolData?.[3]?.result as bigint | undefined;
  const usdcUserBal = poolData?.[4]?.result as bigint | undefined;
  const lpUserBal = poolData?.[5]?.result as bigint | undefined;
  const totalSupply = poolData?.[6]?.result as bigint | undefined;

  const wethIsToken0 = token0?.toLowerCase() === WETH_ADDRESS.toLowerCase();

  const reserveWeth = reserves
    ? wethIsToken0
      ? reserves[0]
      : reserves[1]
    : 0n;
  const reserveUsdc = reserves
    ? wethIsToken0
      ? reserves[1]
      : reserves[0]
    : 0n;

  // Pool is "depleted" when only the permanently locked MINIMUM_LIQUIDITY (1000) remains.
  // In Uniswap V2, this means all LP providers have withdrawn. The pool has dust reserves
  // but is effectively empty. We treat this like a fresh pool so the user can set a new price.
  const MINIMUM_LIQUIDITY = 1000n;
  const isPoolDepleted =
    totalSupply !== undefined && totalSupply > 0n && totalSupply <= MINIMUM_LIQUIDITY;
  const hasNoLiquidity =
    (reserveWeth === 0n && reserveUsdc === 0n) || isPoolDepleted;

  // Sync Input Proportions
  const handleWethChange = (val: string) => {
    setWethInput(val);
    setAddError(null);

    if (!val || isNaN(Number(val))) {
      setUsdcInput("");
      return;
    }

    if (reserveWeth > 0n && reserveUsdc > 0n && !isPoolDepleted) {
      try {
        const wethUnits = parseUnits(val, WETH_DECIMALS);
        const usdcUnits = (wethUnits * reserveUsdc) / reserveWeth;
        setUsdcInput(formatUnits(usdcUnits, USDC_DECIMALS));
      } catch {}
    }
  };

  const handleUsdcChange = (val: string) => {
    setUsdcInput(val);
    setAddError(null);

    if (!val || isNaN(Number(val))) {
      setWethInput("");
      return;
    }

    if (reserveWeth > 0n && reserveUsdc > 0n && !isPoolDepleted) {
      try {
        const usdcUnits = parseUnits(val, USDC_DECIMALS);
        const wethUnits = (usdcUnits * reserveWeth) / reserveUsdc;
        setWethInput(formatUnits(wethUnits, WETH_DECIMALS));
      } catch {}
    }
  };

  // LP Tokens Estimate
  let lpEstimatedBigInt = 0n;
  let wethAmountBigInt = 0n;
  let usdcAmountBigInt = 0n;

  try {
    if (wethInput && !isNaN(Number(wethInput))) {
      wethAmountBigInt = parseUnits(wethInput, WETH_DECIMALS);
    }
    if (usdcInput && !isNaN(Number(usdcInput))) {
      usdcAmountBigInt = parseUnits(usdcInput, USDC_DECIMALS);
    }
  } catch {}

  if (wethAmountBigInt > 0n && usdcAmountBigInt > 0n) {
    if (totalSupply === 0n || totalSupply === undefined) {
      // Truly first deposit (totalSupply == 0): sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY
      const product = wethAmountBigInt * usdcAmountBigInt;
      try {
        const root = bigintSqrt(product);
        if (root > MINIMUM_LIQUIDITY) {
          lpEstimatedBigInt = root - MINIMUM_LIQUIDITY;
        }
      } catch {}
    } else {
      // Subsequent deposit (including depleted pool where totalSupply == 1000):
      // LP = min((amount0 * totalSupply) / reserve0, (amount1 * totalSupply) / reserve1)
      // When depleted, reserves are dust but the formula still applies correctly.
      // The user gets LP tokens proportional to whichever side contributes less.
      const wethShare =
        reserveWeth > 0n
          ? (wethAmountBigInt * totalSupply) / reserveWeth
          : 0n;
      const usdcShare =
        reserveUsdc > 0n
          ? (usdcAmountBigInt * totalSupply) / reserveUsdc
          : 0n;
      if (wethShare > 0n && usdcShare > 0n) {
        lpEstimatedBigInt = wethShare < usdcShare ? wethShare : usdcShare;
      } else if (wethShare > 0n) {
        lpEstimatedBigInt = wethShare;
      } else {
        lpEstimatedBigInt = usdcShare;
      }
    }
  }

  // Add Liquidity Submit
  const handleAddLiquidity = async () => {
    if (!publicClient) {
      setAddError("Blockchain client not available.");
      return;
    }
    if (!isConnected || !address) return;
    if (wethAmountBigInt <= 0n || usdcAmountBigInt <= 0n) {
      setAddError("Please enter valid token amounts.");
      return;
    }
    if (wethUserBal === undefined || wethUserBal < wethAmountBigInt) {
      setAddError("Insufficient WETH balance.");
      return;
    }
    if (usdcUserBal === undefined || usdcUserBal < usdcAmountBigInt) {
      setAddError("Insufficient USDC balance.");
      return;
    }

    try {
      setAddError(null);
      setAddTxHash(undefined);

      // Step 1: Transfer WETH to pool
      setTxPhase("weth-pending");
      console.log("Adding Liquidity - Step 1: Transferring WETH to Pool...");
      const txWeth = await writeContractAsync({
        address: WETH_ADDRESS,
        abi: erc20Abi,
        functionName: "transfer",
        args: [POOL_ADDRESS, wethAmountBigInt],
      });
      setAddTxHash(txWeth);
      setTxPhase("weth-confirming");
      await publicClient.waitForTransactionReceipt({ hash: txWeth });

      // Step 2: Transfer USDC to pool
      setTxPhase("usdc-pending");
      setAddTxHash(undefined);
      console.log("Adding Liquidity - Step 2: Transferring USDC to Pool...");
      const txUsdc = await writeContractAsync({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "transfer",
        args: [POOL_ADDRESS, usdcAmountBigInt],
      });
      setAddTxHash(txUsdc);
      setTxPhase("usdc-confirming");
      await publicClient.waitForTransactionReceipt({ hash: txUsdc });

      // Step 3: Mint LP tokens
      setTxPhase("mint-pending");
      setAddTxHash(undefined);
      console.log("Adding Liquidity - Step 3: Minting LP Tokens...");
      const txMint = await writeContractAsync({
        address: POOL_ADDRESS,
        abi: poolAbi,
        functionName: "mint",
        args: [address],
      });

      setAddTxHash(txMint);
      setTxPhase("mint-confirming");
      await publicClient.waitForTransactionReceipt({ hash: txMint });

      setTxPhase("success");
      setWethInput("");
      setUsdcInput("");
      refetchPool();
      if (onSuccess) onSuccess();

      setTimeout(() => setTxPhase("idle"), 5000);
    } catch (err: unknown) {
      const error = err as { shortMessage?: string; message?: string };
      console.error(err);
      setAddError(error.shortMessage || error.message || "Transaction failed.");
      setTxPhase("idle");
    }
  };

  // Remove Liquidity Calculations
  let lpAmountBigInt = 0n;
  try {
    if (lpInput && !isNaN(Number(lpInput))) {
      lpAmountBigInt = parseUnits(lpInput, 18);
    }
  } catch {}

  let wethReturned = 0n;
  let usdcReturned = 0n;

  if (lpAmountBigInt > 0n && totalSupply && totalSupply > 0n) {
    wethReturned = (lpAmountBigInt * reserveWeth) / totalSupply;
    usdcReturned = (lpAmountBigInt * reserveUsdc) / totalSupply;
  }

  const setLpPercentage = (percent: number) => {
    if (!lpUserBal) return;
    const amount = (lpUserBal * BigInt(percent)) / 100n;
    setLpInput(formatUnits(amount, 18));
    setRemoveError(null);
  };

  // Remove Liquidity Submit
  const handleRemoveLiquidity = async () => {
    if (!publicClient) {
      setRemoveError("Blockchain client not available.");
      return;
    }
    if (!isConnected || !address) return;
    if (lpAmountBigInt <= 0n) {
      setRemoveError("Please enter a valid amount of LP tokens to burn.");
      return;
    }
    if (lpUserBal === undefined || lpUserBal < lpAmountBigInt) {
      setRemoveError("Insufficient LP token balance.");
      return;
    }

    try {
      setRemoveError(null);
      setRemoveTxHash(undefined);

      // Step 1: Transfer LP tokens to the pool contract
      setTxPhase("lp-transfer-pending");
      console.log(
        "Removing Liquidity - Step 1: Transferring LP tokens to Pool...",
      );
      const txTransfer = await writeContractAsync({
        address: POOL_ADDRESS,
        abi: erc20Abi,
        functionName: "transfer",
        args: [POOL_ADDRESS, lpAmountBigInt],
      });
      setRemoveTxHash(txTransfer);
      setTxPhase("lp-transfer-confirming");
      await publicClient.waitForTransactionReceipt({ hash: txTransfer });

      // Step 2: Burn LP tokens to withdraw assets
      setTxPhase("burn-pending");
      setRemoveTxHash(undefined);
      console.log("Removing Liquidity - Step 2: Burning LP tokens...");
      const txBurn = await writeContractAsync({
        address: POOL_ADDRESS,
        abi: poolAbi,
        functionName: "burn",
        args: [address],
      });

      setRemoveTxHash(txBurn);
      setTxPhase("burn-confirming");
      await publicClient.waitForTransactionReceipt({ hash: txBurn });

      setTxPhase("success");
      setLpInput("");
      refetchPool();
      if (onSuccess) onSuccess();

      setTimeout(() => setTxPhase("idle"), 5000);
    } catch (err: unknown) {
      const error = err as { shortMessage?: string; message?: string };
      console.error(err);
      setRemoveError(
        error.shortMessage || error.message || "Transaction failed.",
      );
      setTxPhase("idle");
    }
  };

  // Trigger event dispatch to notify educational panel of changes
  useEffect(() => {
    const event = new CustomEvent("activeLiquidityChanged", {
      detail: {
        activeTab,
        wethInput,
        usdcInput,
        lpInput,
        reserveWeth: formatUnits(reserveWeth, WETH_DECIMALS),
        reserveUsdc: formatUnits(reserveUsdc, USDC_DECIMALS),
        totalSupply: formatUnits(totalSupply ?? 0n, 18),
      },
    });
    window.dispatchEvent(event);
  }, [
    activeTab,
    wethInput,
    usdcInput,
    lpInput,
    reserveWeth,
    reserveUsdc,
    totalSupply,
  ]);

  // Phase label helpers
  const getAddButtonLabel = () => {
    switch (txPhase) {
      case "weth-pending":
        return "⏳ Sign WETH Transfer...";
      case "weth-confirming":
        return "⛓ Confirming WETH Transfer...";
      case "usdc-pending":
        return "⏳ Sign USDC Transfer...";
      case "usdc-confirming":
        return "⛓ Confirming USDC Transfer...";
      case "mint-pending":
        return "⏳ Sign Mint in Wallet...";
      case "mint-confirming":
        return "⛓ Confirming Mint...";
      case "success":
        return "✅ Liquidity Added!";
      default:
        return "Add Liquidity";
    }
  };

  const getRemoveButtonLabel = () => {
    switch (txPhase) {
      case "lp-transfer-pending":
        return "⏳ Sign LP Transfer...";
      case "lp-transfer-confirming":
        return "⛓ Confirming LP Transfer...";
      case "burn-pending":
        return "⏳ Sign Burn in Wallet...";
      case "burn-confirming":
        return "⛓ Confirming Burn...";
      case "success":
        return "✅ Liquidity Removed!";
      default:
        return "Remove Liquidity";
    }
  };

  const getPhaseMessage = () => {
    switch (txPhase) {
      case "weth-pending":
        return "Waiting for you to sign the WETH transfer...";
      case "weth-confirming":
        return "WETH transfer submitted. Waiting for on-chain confirmation...";
      case "usdc-pending":
        return "Waiting for you to sign the USDC transfer...";
      case "usdc-confirming":
        return "USDC transfer submitted. Waiting for on-chain confirmation...";
      case "mint-pending":
        return "Waiting for you to sign the mint transaction...";
      case "mint-confirming":
        return "Mint submitted. Waiting for on-chain confirmation...";
      case "lp-transfer-pending":
        return "Waiting for you to sign the LP token transfer...";
      case "lp-transfer-confirming":
        return "LP transfer submitted. Waiting for on-chain confirmation...";
      case "burn-pending":
        return "Waiting for you to sign the burn transaction...";
      case "burn-confirming":
        return "Burn submitted. Waiting for on-chain confirmation...";
      default:
        return "";
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      {/* Sub Tabs */}
      <div className="flex rounded-md bg-gray-100 p-1 mb-6">
        <button
          type="button"
          onClick={() => {
            setActiveTab("add");
            setAddError(null);
            setRemoveError(null);
          }}
          className={`flex-1 py-2 text-center text-xs font-semibold rounded-md transition ${
            activeTab === "add"
              ? "bg-white text-gray-900 shadow-xs"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Add Liquidity
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab("remove");
            setAddError(null);
            setRemoveError(null);
          }}
          className={`flex-1 py-2 text-center text-xs font-semibold rounded-md transition ${
            activeTab === "remove"
              ? "bg-white text-gray-900 shadow-xs"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Remove Liquidity
        </button>
      </div>

      {!isConnected ? (
        <p className="text-sm text-gray-500">
          Connect wallet to manage liquidity.
        </p>
      ) : activeTab === "add" ? (
        // Add Liquidity Tab
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Deposit WETH</span>
              <span>
                Balance:{" "}
                {wethUserBal !== undefined
                  ? parseFloat(formatUnits(wethUserBal, WETH_DECIMALS)).toFixed(
                      8,
                    )
                  : "—"}
              </span>
            </div>
            <div className="relative flex rounded-md shadow-sm">
              <input
                type="number"
                placeholder="0.0"
                value={wethInput}
                disabled={isBusy}
                onChange={(e) => handleWethChange(e.target.value)}
                className="block w-full rounded-md border border-gray-300 p-2.5 sm:text-sm focus:border-indigo-500 focus:ring-indigo-500"
              />
              <span className="absolute right-3 top-3 text-sm text-gray-500 font-medium">
                WETH
              </span>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Deposit USDC</span>
              <span>
                Balance:{" "}
                {usdcUserBal !== undefined
                  ? parseFloat(formatUnits(usdcUserBal, USDC_DECIMALS)).toFixed(
                      6,
                    )
                  : "—"}
              </span>
            </div>
            <div className="relative flex rounded-md shadow-sm">
              <input
                type="number"
                placeholder="0.0"
                value={usdcInput}
                disabled={isBusy}
                onChange={(e) => handleUsdcChange(e.target.value)}
                className="block w-full rounded-md border border-gray-300 p-2.5 sm:text-sm focus:border-indigo-500 focus:ring-indigo-500"
              />
              <span className="absolute right-3 top-3 text-sm text-gray-500 font-medium">
                USDC
              </span>
            </div>
          </div>

          {/* LP Tokens Mint Estimate */}
          {lpEstimatedBigInt > 0n && (
            <div className="rounded-lg bg-gray-50 p-3 text-xs space-y-2 border border-gray-100">
              <div className="flex justify-between font-medium">
                <span className="text-gray-600">Estimated LP Tokens:</span>
                <span>{formatUnits(lpEstimatedBigInt, 18)} SLP</span>
              </div>
              {hasNoLiquidity && (
                <p className="text-2xs text-blue-600 font-medium leading-normal pt-1">
                  {isPoolDepleted
                    ? "💡 Pool is depleted — only locked minimum liquidity remains. You are effectively re-initializing the pool. The ratio you deposit sets the new price."
                    : "💡 You are the first depositor. You set the initial pool price. 1000 LP tokens will be locked permanently."}
                </p>
              )}
            </div>
          )}

          {/* Transaction Phase Indicator */}
          {isAdding && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 flex items-center gap-2">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              <span>{getPhaseMessage()}</span>
            </div>
          )}

          {txPhase === "success" && activeTab === "add" && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 flex items-center gap-2">
              <svg
                className="h-4 w-4 flex-shrink-0 text-green-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <span>Liquidity added successfully!</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleAddLiquidity}
            disabled={
              isBusy || wethAmountBigInt === 0n || usdcAmountBigInt === 0n
            }
            className={`w-full rounded-md px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed ${
              txPhase === "success"
                ? "bg-green-600 hover:bg-green-500"
                : "bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-300"
            }`}
          >
            {getAddButtonLabel()}
          </button>

          {addError && <p className="text-xs text-red-600 mt-2">{addError}</p>}
          <TxStatus hash={addTxHash} />
        </div>
      ) : (
        // Remove Liquidity Tab
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Burn LP Tokens</span>
              <span>
                Available:{" "}
                {lpUserBal !== undefined ? formatUnits(lpUserBal, 18) : "—"} SLP
              </span>
            </div>
            <div className="relative flex rounded-md shadow-sm mb-2">
              <input
                type="number"
                placeholder="0.0"
                value={lpInput}
                disabled={isBusy}
                onChange={(e) => {
                  setLpInput(e.target.value);
                  setRemoveError(null);
                }}
                className="block w-full rounded-md border border-gray-300 p-2.5 sm:text-sm focus:border-indigo-500 focus:ring-indigo-500"
              />
              <span className="absolute right-3 top-3 text-sm text-gray-500 font-medium">
                SLP
              </span>
            </div>

            {/* Percentage shortcuts */}
            <div className="flex gap-2">
              {[25, 50, 75, 100].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => setLpPercentage(pct)}
                  disabled={isBusy || !lpUserBal || lpUserBal === 0n}
                  className="flex-1 rounded-md border border-gray-200 bg-gray-50 py-1.5 text-center text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50 transition"
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          {/* Returned assets preview */}
          {lpAmountBigInt > 0n && (
            <div className="rounded-lg bg-gray-50 p-3 text-xs space-y-2 border border-gray-100">
              <div className="flex justify-between">
                <span className="text-gray-500">Receive WETH:</span>
                <span className="font-semibold">
                  {parseFloat(formatUnits(wethReturned, WETH_DECIMALS)).toFixed(
                    8,
                  )}{" "}
                  WETH
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Receive USDC:</span>
                <span className="font-semibold">
                  {parseFloat(formatUnits(usdcReturned, USDC_DECIMALS)).toFixed(
                    6,
                  )}{" "}
                  USDC
                </span>
              </div>
            </div>
          )}

          {/* Transaction Phase Indicator */}
          {isRemoving && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 flex items-center gap-2">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              <span>{getPhaseMessage()}</span>
            </div>
          )}

          {txPhase === "success" && activeTab === "remove" && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 flex items-center gap-2">
              <svg
                className="h-4 w-4 flex-shrink-0 text-green-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <span>Liquidity removed successfully!</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleRemoveLiquidity}
            disabled={isBusy || lpAmountBigInt === 0n}
            className={`w-full rounded-md px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed ${
              txPhase === "success"
                ? "bg-green-600 hover:bg-green-500"
                : "bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-300"
            }`}
          >
            {getRemoveButtonLabel()}
          </button>

          {removeError && (
            <p className="text-xs text-red-600 mt-2">{removeError}</p>
          )}
          <TxStatus hash={removeTxHash} />
        </div>
      )}
    </div>
  );
}
