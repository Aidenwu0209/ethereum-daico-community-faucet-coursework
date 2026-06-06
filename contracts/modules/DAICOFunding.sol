// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DAICOBase} from "./DAICOBase.sol";

abstract contract DAICOFunding is DAICOBase {
    receive() external payable {
        invest();
    }

    function invest() public payable nonReentrant {
        require(getFundingStatus() == FundingStatus.Active, "Funding is not active");
        require(msg.value > 0, "Investment must be greater than zero");

        uint256 tokenAmount = msg.value * tokenRate;
        uint256 faucetReserve = (tokenAmount * FAUCET_RESERVE_PERCENT) / (100 - FAUCET_RESERVE_PERCENT);

        raisedAmount += msg.value;
        investments[msg.sender] += msg.value;
        faucetPoolBalance += faucetReserve;

        token.mint(msg.sender, tokenAmount);
        token.mint(address(this), faucetReserve);

        emit Invested(msg.sender, msg.value, tokenAmount, faucetReserve);
    }

    function finalizeFunding() external {
        require(block.timestamp >= fundingDeadline, "Funding period has not ended");
        require(!fundingFinalized, "Funding already finalized");

        fundingFinalized = true;
        fundingSuccessful = raisedAmount >= fundingGoal;

        if (fundingSuccessful) {
            treasuryBalance = raisedAmount;
        }

        token.closeMinting();

        emit FundingFinalized(fundingSuccessful, raisedAmount, treasuryBalance);
    }

    function refund() external nonReentrant {
        require(fundingFinalized, "Funding not finalized");
        require(!fundingSuccessful, "Funding was successful");

        uint256 amount = investments[msg.sender];
        require(amount > 0, "No refundable investment");

        investments[msg.sender] = 0;

        emit Refunded(msg.sender, amount);

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Refund transfer failed");
    }

    function getFundingStatus() public view returns (FundingStatus) {
        if (fundingFinalized) {
            return FundingStatus.Finalized;
        }

        if (block.timestamp < fundingDeadline) {
            return FundingStatus.Active;
        }

        if (raisedAmount >= fundingGoal) {
            return FundingStatus.Successful;
        }

        return FundingStatus.Failed;
    }

    function getRaisedAmount() external view returns (uint256) {
        return raisedAmount;
    }

    function getRemainingTime() public view returns (uint256) {
        if (block.timestamp >= fundingDeadline) {
            return 0;
        }

        return fundingDeadline - block.timestamp;
    }
}
