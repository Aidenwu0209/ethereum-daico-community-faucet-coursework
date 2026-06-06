// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DAICOFaucet} from "./DAICOFaucet.sol";

abstract contract DAICOGovernance is DAICOFaucet {
    function createProposal(
        ProposalType proposalType,
        string calldata description,
        uint256 newValue,
        address payable recipient
    ) external returns (uint256) {
        require(fundingFinalized && fundingSuccessful, "Funding must be successful");
        require(bytes(description).length > 0, "Description required");
        require(_canCreateProposal(msg.sender), "Proposal threshold not met");

        if (proposalType == ProposalType.ChangeFaucetAmount) {
            require(newValue > 0, "Faucet amount must be greater than zero");
        } else if (proposalType == ProposalType.ChangeFaucetCooldown) {
            require(newValue > 0 && newValue <= MAX_COOLDOWN, "Invalid cooldown");
        } else if (proposalType == ProposalType.ToggleFaucet) {
            require(newValue <= 1, "Toggle value must be 0 or 1");
        } else if (proposalType == ProposalType.WithdrawTreasury) {
            require(newValue > 0, "Withdraw amount must be greater than zero");
            require(recipient != address(0), "Recipient cannot be zero");
        }

        proposalCounter += 1;
        uint256 proposalId = proposalCounter;
        uint256 startTime = block.timestamp;
        uint256 endTime = startTime + VOTING_DURATION;

        proposals[proposalId] = Proposal({
            id: proposalId,
            proposalType: proposalType,
            proposer: msg.sender,
            description: description,
            newValue: newValue,
            recipient: recipient,
            startTime: startTime,
            endTime: endTime,
            forVotes: 0,
            againstVotes: 0,
            executed: false,
            canceled: false,
            totalSupplyAtCreation: token.totalSupply()
        });

        emit ProposalCreated(proposalId, proposalType, msg.sender, description, newValue, recipient, startTime, endTime);

        return proposalId;
    }

    function vote(uint256 proposalId, bool support) external {
        Proposal storage proposal = _proposalOrRevert(proposalId);
        require(!proposal.canceled, "Proposal is canceled");
        require(block.timestamp < proposal.endTime, "Voting period ended");
        require(!proposalVotes[proposalId][msg.sender], "Already voted");

        uint256 weight = token.balanceOf(msg.sender);
        require(weight > 0, "No voting power");

        proposalVotes[proposalId][msg.sender] = true;

        if (support) {
            proposal.forVotes += weight;
        } else {
            proposal.againstVotes += weight;
        }

        emit Voted(proposalId, msg.sender, support, weight);
    }

    function executeProposal(uint256 proposalId) external nonReentrant {
        Proposal storage proposal = _proposalOrRevert(proposalId);
        require(!proposal.canceled, "Proposal is canceled");
        require(!proposal.executed, "Proposal already executed");
        require(block.timestamp >= proposal.endTime, "Voting period not ended");
        require(_isProposalPassed(proposal), "Proposal did not pass");

        proposal.executed = true;

        if (proposal.proposalType == ProposalType.ChangeFaucetAmount) {
            uint256 previousAmount = faucetClaimAmount;
            faucetClaimAmount = proposal.newValue;
            emit FaucetAmountChanged(previousAmount, proposal.newValue);
            emit ProposalExecuted(proposalId, true);
        } else if (proposal.proposalType == ProposalType.ChangeFaucetCooldown) {
            uint256 previousCooldown = faucetCooldown;
            faucetCooldown = proposal.newValue;
            emit FaucetCooldownChanged(previousCooldown, proposal.newValue);
            emit ProposalExecuted(proposalId, true);
        } else if (proposal.proposalType == ProposalType.ToggleFaucet) {
            faucetEnabled = proposal.newValue == 1;
            emit FaucetStatusChanged(faucetEnabled);
            emit ProposalExecuted(proposalId, true);
        } else {
            require(proposal.newValue <= treasuryBalance, "Insufficient treasury balance");
            treasuryBalance -= proposal.newValue;
            emit ProposalExecuted(proposalId, true);

            (bool success, ) = proposal.recipient.call{value: proposal.newValue}("");
            require(success, "Treasury transfer failed");
        }
    }

    function cancelProposal(uint256 proposalId) external {
        Proposal storage proposal = _proposalOrRevert(proposalId);
        require(msg.sender == proposal.proposer || msg.sender == owner(), "Not authorized to cancel");
        require(!proposal.executed, "Proposal already executed");
        require(!proposal.canceled, "Proposal already canceled");
        require(block.timestamp < proposal.endTime, "Voting period ended");

        proposal.canceled = true;

        emit ProposalCancelled(proposalId);
    }

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return _proposalOrRevertView(proposalId);
    }

    function getProposalCount() external view returns (uint256) {
        return proposalCounter;
    }

    function hasVoted(uint256 proposalId, address user) external view returns (bool) {
        require(user != address(0), "User cannot be zero");
        _proposalOrRevertView(proposalId);
        return proposalVotes[proposalId][user];
    }

    function getTreasuryBalance() external view returns (uint256) {
        return treasuryBalance;
    }

    function canCreateProposal(address user) external view returns (bool) {
        require(user != address(0), "User cannot be zero");
        return _canCreateProposal(user);
    }

    function isProposalPassed(uint256 proposalId) external view returns (bool) {
        Proposal storage proposal = _proposalOrRevertView(proposalId);
        return _isProposalPassed(proposal);
    }

    function _proposalOrRevert(uint256 proposalId) private view returns (Proposal storage) {
        require(proposalId > 0 && proposalId <= proposalCounter, "Proposal does not exist");
        return proposals[proposalId];
    }

    function _proposalOrRevertView(uint256 proposalId) private view returns (Proposal storage) {
        require(proposalId > 0 && proposalId <= proposalCounter, "Proposal does not exist");
        return proposals[proposalId];
    }

    function _canCreateProposal(address user) private view returns (bool) {
        if (user == owner()) {
            return true;
        }

        uint256 supply = token.totalSupply();
        if (supply == 0) {
            return false;
        }

        return token.balanceOf(user) * 100 >= supply * PROPOSAL_THRESHOLD_PERCENT;
    }

    function _isProposalPassed(Proposal storage proposal) private view returns (bool) {
        if (proposal.canceled || proposal.totalSupplyAtCreation == 0) {
            return false;
        }

        uint256 totalVotes = proposal.forVotes + proposal.againstVotes;
        if (totalVotes == 0) {
            return false;
        }

        bool quorumReached = totalVotes * 100 >= proposal.totalSupplyAtCreation * QUORUM_PERCENT;
        bool supportReached = proposal.forVotes * 100 >= totalVotes * SUPPORT_PERCENT;

        return quorumReached && supportReached;
    }
}
