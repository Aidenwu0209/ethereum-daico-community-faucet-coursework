// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {DAICOFunding} from "./DAICOFunding.sol";

abstract contract DAICOFaucet is DAICOFunding {
    using SafeERC20 for IERC20;

    function claimFaucet() external nonReentrant {
        require(fundingFinalized && fundingSuccessful, "Funding must be successful");
        require(faucetEnabled, "Faucet is disabled");
        require(token.balanceOf(msg.sender) >= MIN_TOKEN_TO_CLAIM, "Insufficient token balance");
        require(block.timestamp >= getNextClaimTime(msg.sender), "Faucet cooldown active");
        require(faucetPoolBalance >= faucetClaimAmount, "Faucet pool is insufficient");

        faucetPoolBalance -= faucetClaimAmount;
        lastClaimTime[msg.sender] = block.timestamp;

        safeToken.safeTransfer(msg.sender, faucetClaimAmount);

        emit FaucetClaimed(msg.sender, faucetClaimAmount, getNextClaimTime(msg.sender));
    }

    function getFaucetInfo()
        external
        view
        returns (uint256 poolBalance, uint256 claimAmount, uint256 cooldown, bool enabled)
    {
        return (faucetPoolBalance, faucetClaimAmount, faucetCooldown, faucetEnabled);
    }

    function getNextClaimTime(address user) public view returns (uint256) {
        require(user != address(0), "User cannot be zero");
        return lastClaimTime[user] + faucetCooldown;
    }
}
