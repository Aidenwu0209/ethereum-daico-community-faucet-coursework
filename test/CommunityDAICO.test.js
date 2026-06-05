const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const FUNDING_DURATION = 7 * 24 * 60 * 60;
const VOTING_DURATION = 72 * 60 * 60;
const ONE_ETH = ethers.parseEther("1");
const FUNDING_GOAL = ethers.parseEther("10");
const TOKEN_RATE = 1000n;
const FAUCET_CLAIM_AMOUNT = ethers.parseEther("25");
const ZERO_ADDRESS = ethers.ZeroAddress;

const ProposalType = {
  ChangeFaucetAmount: 0,
  ChangeFaucetCooldown: 1,
  ToggleFaucet: 2,
  WithdrawTreasury: 3
};

function investorTokens(ethAmount) {
  return ethAmount * TOKEN_RATE;
}

function faucetReserveFor(tokenAmount) {
  return (tokenAmount * 10n) / 90n;
}

async function deployFixture() {
  const [owner, investor1, investor2, outsider, recipient] = await ethers.getSigners();

  const CommunityToken = await ethers.getContractFactory("CommunityToken");
  const token = await CommunityToken.deploy(owner.address);
  await token.waitForDeployment();

  const CommunityDAICO = await ethers.getContractFactory("CommunityDAICO");
  const daico = await CommunityDAICO.deploy(
    await token.getAddress(),
    FUNDING_GOAL,
    FUNDING_DURATION,
    TOKEN_RATE,
    FAUCET_CLAIM_AMOUNT
  );
  await daico.waitForDeployment();
  await token.setMinter(await daico.getAddress());

  return {
    owner,
    investor1,
    investor2,
    outsider,
    recipient,
    token,
    daico
  };
}

async function finalizeSuccessfulFunding() {
  const fixture = await loadFixture(deployFixture);
  await fixture.daico.connect(fixture.investor1).invest({ value: FUNDING_GOAL });
  await time.increase(FUNDING_DURATION + 1);
  await fixture.daico.finalizeFunding();
  return fixture;
}

async function finalizeSuccessfulFundingWithSmallHolder() {
  const fixture = await loadFixture(deployFixture);
  await fixture.daico.connect(fixture.investor1).invest({ value: FUNDING_GOAL });
  await fixture.daico.connect(fixture.investor2).invest({ value: ethers.parseEther("0.01") });
  await time.increase(FUNDING_DURATION + 1);
  await fixture.daico.finalizeFunding();
  return fixture;
}

async function finalizeFailedFunding() {
  const fixture = await loadFixture(deployFixture);
  await fixture.daico.connect(fixture.investor1).invest({ value: ONE_ETH });
  await time.increase(FUNDING_DURATION + 1);
  await fixture.daico.finalizeFunding();
  return fixture;
}

async function createProposal(daico, proposer, proposalType, description, newValue, recipient = ZERO_ADDRESS) {
  await daico.connect(proposer).createProposal(proposalType, description, newValue, recipient);
  return Number(await daico.getProposalCount());
}

async function createPassedProposal(fixture, proposalType, description, newValue, recipient = ZERO_ADDRESS) {
  const proposalId = await createProposal(fixture.daico, fixture.owner, proposalType, description, newValue, recipient);
  await fixture.daico.connect(fixture.investor1).vote(proposalId, true);
  await time.increase(VOTING_DURATION + 1);
  return proposalId;
}

describe("CommunityToken", function () {
  it("deploys with initialized ERC20 metadata and minter", async function () {
    const { owner, token, daico } = await loadFixture(deployFixture);

    expect(await token.name()).to.equal("Community Faucet Token");
    expect(await token.symbol()).to.equal("CFT");
    expect(await token.owner()).to.equal(owner.address);
    expect(await token.minter()).to.equal(await daico.getAddress());
    expect(await token.mintingClosed()).to.equal(false);
    expect(await token.totalSupply()).to.equal(0n);
  });

  it("rejects minting by non-minter accounts", async function () {
    const { owner, investor1, token } = await loadFixture(deployFixture);

    await expect(token.connect(owner).mint(investor1.address, ONE_ETH)).to.be.revertedWith("Caller is not minter");
  });
});

describe("CommunityDAICO funding", function () {
  it("deploys with initialized DAICO parameters", async function () {
    const { daico, token } = await loadFixture(deployFixture);

    expect(await daico.token()).to.equal(await token.getAddress());
    expect(await daico.fundingGoal()).to.equal(FUNDING_GOAL);
    expect(await daico.tokenRate()).to.equal(TOKEN_RATE);
    expect(await daico.faucetClaimAmount()).to.equal(FAUCET_CLAIM_AMOUNT);
    expect(await daico.faucetCooldown()).to.equal(24 * 60 * 60);
    expect(await daico.faucetEnabled()).to.equal(true);
    expect(await daico.getFundingStatus()).to.equal(0n);
  });

  it("accepts investment, records ETH, and mints investor and faucet tokens", async function () {
    const { investor1, token, daico } = await loadFixture(deployFixture);
    const expectedTokens = investorTokens(ONE_ETH);
    const expectedReserve = faucetReserveFor(expectedTokens);

    await expect(daico.connect(investor1).invest({ value: ONE_ETH }))
      .to.emit(daico, "Invested")
      .withArgs(investor1.address, ONE_ETH, expectedTokens, expectedReserve);

    expect(await token.balanceOf(investor1.address)).to.equal(expectedTokens);
    expect(await token.balanceOf(await daico.getAddress())).to.equal(expectedReserve);
    expect(await daico.investments(investor1.address)).to.equal(ONE_ETH);
    expect(await daico.getRaisedAmount()).to.equal(ONE_ETH);
    expect(await daico.faucetPoolBalance()).to.equal(expectedReserve);
  });

  it("rejects zero-value investments", async function () {
    const { investor1, daico } = await loadFixture(deployFixture);

    await expect(daico.connect(investor1).invest({ value: 0 })).to.be.revertedWith(
      "Investment must be greater than zero"
    );
  });

  it("rejects investment after the funding period ends", async function () {
    const { investor1, daico } = await loadFixture(deployFixture);

    await time.increase(FUNDING_DURATION + 1);

    await expect(daico.connect(investor1).invest({ value: ONE_ETH })).to.be.revertedWith("Funding is not active");
  });

  it("rejects finalization before the funding deadline", async function () {
    const { daico } = await loadFixture(deployFixture);

    await expect(daico.finalizeFunding()).to.be.revertedWith("Funding period has not ended");
  });

  it("previews failed funding status after deadline before finalization", async function () {
    const { investor1, daico } = await loadFixture(deployFixture);

    await daico.connect(investor1).invest({ value: ONE_ETH });
    await time.increase(FUNDING_DURATION + 1);

    expect(await daico.getFundingStatus()).to.equal(1n);
    expect(await daico.fundingFinalized()).to.equal(false);
  });

  it("previews successful funding status after deadline before finalization", async function () {
    const { investor1, daico } = await loadFixture(deployFixture);

    await daico.connect(investor1).invest({ value: FUNDING_GOAL });
    await time.increase(FUNDING_DURATION + 1);

    expect(await daico.getFundingStatus()).to.equal(2n);
    expect(await daico.fundingFinalized()).to.equal(false);
  });

  it("finalizes failed funding, closes minting, and leaves treasury empty", async function () {
    const { daico, token } = await finalizeFailedFunding();

    expect(await daico.getFundingStatus()).to.equal(3n);
    expect(await daico.fundingFinalized()).to.equal(true);
    expect(await daico.fundingSuccessful()).to.equal(false);
    expect(await daico.getTreasuryBalance()).to.equal(0n);
    expect(await token.mintingClosed()).to.equal(true);
  });

  it("refunds failed investors and clears investment records", async function () {
    const { investor1, daico } = await finalizeFailedFunding();

    await expect(daico.connect(investor1).refund()).to.changeEtherBalances(
      [investor1, daico],
      [ONE_ETH, -ONE_ETH]
    );
    expect(await daico.investments(investor1.address)).to.equal(0n);
  });

  it("rejects repeated refunds", async function () {
    const { investor1, daico } = await finalizeFailedFunding();

    await daico.connect(investor1).refund();

    await expect(daico.connect(investor1).refund()).to.be.revertedWith("No refundable investment");
  });

  it("rejects refunds after successful funding", async function () {
    const { investor1, daico } = await finalizeSuccessfulFunding();

    await expect(daico.connect(investor1).refund()).to.be.revertedWith("Funding was successful");
  });

  it("finalizes successful funding, closes minting, and records treasury", async function () {
    const { daico, token } = await finalizeSuccessfulFunding();

    expect(await daico.getFundingStatus()).to.equal(3n);
    expect(await daico.fundingSuccessful()).to.equal(true);
    expect(await daico.getTreasuryBalance()).to.equal(FUNDING_GOAL);
    expect(await token.mintingClosed()).to.equal(true);
  });

  it("rejects repeated finalization", async function () {
    const { daico } = await finalizeSuccessfulFunding();

    await expect(daico.finalizeFunding()).to.be.revertedWith("Funding already finalized");
  });
});

describe("CommunityDAICO faucet", function () {
  it("allows a token holder to claim faucet tokens after successful funding", async function () {
    const { investor1, token, daico } = await finalizeSuccessfulFunding();
    const beforeBalance = await token.balanceOf(investor1.address);
    const beforePool = await daico.faucetPoolBalance();

    await expect(daico.connect(investor1).claimFaucet()).to.emit(daico, "FaucetClaimed");

    expect(await token.balanceOf(investor1.address)).to.equal(beforeBalance + FAUCET_CLAIM_AMOUNT);
    expect(await daico.faucetPoolBalance()).to.equal(beforePool - FAUCET_CLAIM_AMOUNT);
    expect(await daico.lastClaimTime(investor1.address)).to.be.greaterThan(0n);
  });

  it("rejects faucet claims before funding is successfully finalized", async function () {
    const { investor1, daico } = await loadFixture(deployFixture);

    await daico.connect(investor1).invest({ value: ONE_ETH });

    await expect(daico.connect(investor1).claimFaucet()).to.be.revertedWith("Funding must be successful");
  });

  it("rejects faucet claims by non-token holders", async function () {
    const { outsider, daico } = await finalizeSuccessfulFunding();

    await expect(daico.connect(outsider).claimFaucet()).to.be.revertedWith("Insufficient token balance");
  });

  it("rejects repeated faucet claims during cooldown", async function () {
    const { investor1, daico } = await finalizeSuccessfulFunding();

    await daico.connect(investor1).claimFaucet();

    await expect(daico.connect(investor1).claimFaucet()).to.be.revertedWith("Faucet cooldown active");
  });

  it("allows a second faucet claim after cooldown passes", async function () {
    const { investor1, token, daico } = await finalizeSuccessfulFunding();

    await daico.connect(investor1).claimFaucet();
    await time.increase(24 * 60 * 60 + 1);

    await expect(daico.connect(investor1).claimFaucet()).to.emit(daico, "FaucetClaimed");
    expect(await token.balanceOf(investor1.address)).to.equal(investorTokens(FUNDING_GOAL) + FAUCET_CLAIM_AMOUNT * 2n);
  });
});

describe("CommunityDAICO DAO governance", function () {
  it("lets the project owner create a proposal", async function () {
    const { owner, daico } = await finalizeSuccessfulFunding();

    await expect(
      daico.connect(owner).createProposal(
        ProposalType.ChangeFaucetAmount,
        "Reduce claim amount",
        ethers.parseEther("10"),
        ZERO_ADDRESS
      )
    ).to.emit(daico, "ProposalCreated");

    expect(await daico.getProposalCount()).to.equal(1n);
  });

  it("lets a holder above the 5 percent threshold create a proposal", async function () {
    const { investor1, daico } = await finalizeSuccessfulFunding();

    await daico.connect(investor1).createProposal(
      ProposalType.ChangeFaucetCooldown,
      "Shorter cooldown",
      12 * 60 * 60,
      ZERO_ADDRESS
    );

    const proposal = await daico.getProposal(1);
    expect(proposal.proposer).to.equal(investor1.address);
  });

  it("rejects proposal creation below the 5 percent holder threshold", async function () {
    const { investor2, daico } = await finalizeSuccessfulFundingWithSmallHolder();

    await expect(
      daico.connect(investor2).createProposal(
        ProposalType.ChangeFaucetAmount,
        "Too small to propose",
        ethers.parseEther("5"),
        ZERO_ADDRESS
      )
    ).to.be.revertedWith("Proposal threshold not met");
  });

  it("validates proposal input parameters", async function () {
    const { owner, daico } = await finalizeSuccessfulFunding();

    await expect(
      daico.connect(owner).createProposal(ProposalType.ToggleFaucet, "Bad toggle", 2, ZERO_ADDRESS)
    ).to.be.revertedWith("Toggle value must be 0 or 1");

    await expect(
      daico.connect(owner).createProposal(ProposalType.ChangeFaucetCooldown, "Bad cooldown", 31 * 24 * 60 * 60, ZERO_ADDRESS)
    ).to.be.revertedWith("Invalid cooldown");

    await expect(
      daico.connect(owner).createProposal(ProposalType.WithdrawTreasury, "Bad recipient", ONE_ETH, ZERO_ADDRESS)
    ).to.be.revertedWith("Recipient cannot be zero");
  });

  it("records support votes and voting status", async function () {
    const { owner, investor1, token, daico } = await finalizeSuccessfulFunding();
    const proposalId = await createProposal(
      daico,
      owner,
      ProposalType.ChangeFaucetAmount,
      "Change amount",
      ethers.parseEther("10")
    );
    const voterBalance = await token.balanceOf(investor1.address);

    await expect(daico.connect(investor1).vote(proposalId, true))
      .to.emit(daico, "Voted")
      .withArgs(proposalId, investor1.address, true, voterBalance);

    const proposal = await daico.getProposal(proposalId);
    expect(proposal.forVotes).to.equal(voterBalance);
    expect(proposal.againstVotes).to.equal(0n);
    expect(await daico.hasVoted(proposalId, investor1.address)).to.equal(true);
  });

  it("records against votes", async function () {
    const { owner, investor1, token, daico } = await finalizeSuccessfulFunding();
    const proposalId = await createProposal(
      daico,
      owner,
      ProposalType.ChangeFaucetAmount,
      "Change amount",
      ethers.parseEther("10")
    );
    const voterBalance = await token.balanceOf(investor1.address);

    await daico.connect(investor1).vote(proposalId, false);

    const proposal = await daico.getProposal(proposalId);
    expect(proposal.forVotes).to.equal(0n);
    expect(proposal.againstVotes).to.equal(voterBalance);
  });

  it("rejects duplicate voting by the same address", async function () {
    const { owner, investor1, daico } = await finalizeSuccessfulFunding();
    const proposalId = await createProposal(
      daico,
      owner,
      ProposalType.ChangeFaucetAmount,
      "Change amount",
      ethers.parseEther("10")
    );

    await daico.connect(investor1).vote(proposalId, true);

    await expect(daico.connect(investor1).vote(proposalId, true)).to.be.revertedWith("Already voted");
  });

  it("rejects voting by accounts without tokens", async function () {
    const { owner, outsider, daico } = await finalizeSuccessfulFunding();
    const proposalId = await createProposal(
      daico,
      owner,
      ProposalType.ChangeFaucetAmount,
      "Change amount",
      ethers.parseEther("10")
    );

    await expect(daico.connect(outsider).vote(proposalId, true)).to.be.revertedWith("No voting power");
  });

  it("rejects proposal execution before the voting period ends", async function () {
    const { owner, investor1, daico } = await finalizeSuccessfulFunding();
    const proposalId = await createProposal(
      daico,
      owner,
      ProposalType.ChangeFaucetAmount,
      "Change amount",
      ethers.parseEther("10")
    );
    await daico.connect(investor1).vote(proposalId, true);

    await expect(daico.executeProposal(proposalId)).to.be.revertedWith("Voting period not ended");
  });

  it("executes a passed faucet amount proposal", async function () {
    const fixture = await finalizeSuccessfulFunding();
    const newAmount = ethers.parseEther("12");
    const proposalId = await createPassedProposal(
      fixture,
      ProposalType.ChangeFaucetAmount,
      "Set smaller amount",
      newAmount
    );

    await expect(fixture.daico.executeProposal(proposalId))
      .to.emit(fixture.daico, "FaucetAmountChanged")
      .withArgs(FAUCET_CLAIM_AMOUNT, newAmount);

    expect(await fixture.daico.faucetClaimAmount()).to.equal(newAmount);
    expect((await fixture.daico.getProposal(proposalId)).executed).to.equal(true);
  });

  it("executes a passed faucet cooldown proposal", async function () {
    const fixture = await finalizeSuccessfulFunding();
    const newCooldown = 6 * 60 * 60;
    const proposalId = await createPassedProposal(
      fixture,
      ProposalType.ChangeFaucetCooldown,
      "Set cooldown",
      newCooldown
    );

    await fixture.daico.executeProposal(proposalId);

    expect(await fixture.daico.faucetCooldown()).to.equal(newCooldown);
  });

  it("executes a passed toggle proposal and disables faucet claims", async function () {
    const fixture = await finalizeSuccessfulFunding();
    const proposalId = await createPassedProposal(
      fixture,
      ProposalType.ToggleFaucet,
      "Disable faucet",
      0
    );

    await fixture.daico.executeProposal(proposalId);

    expect(await fixture.daico.faucetEnabled()).to.equal(false);
    await expect(fixture.daico.connect(fixture.investor1).claimFaucet()).to.be.revertedWith("Faucet is disabled");
  });

  it("rejects execution of a proposal that misses quorum", async function () {
    const { owner, investor2, daico } = await finalizeSuccessfulFundingWithSmallHolder();
    const proposalId = await createProposal(
      daico,
      owner,
      ProposalType.ChangeFaucetAmount,
      "Low participation",
      ethers.parseEther("10")
    );
    await daico.connect(investor2).vote(proposalId, true);
    await time.increase(VOTING_DURATION + 1);

    await expect(daico.executeProposal(proposalId)).to.be.revertedWith("Proposal did not pass");
  });

  it("rejects execution of a proposal with majority against votes", async function () {
    const { owner, investor1, daico } = await finalizeSuccessfulFunding();
    const proposalId = await createProposal(
      daico,
      owner,
      ProposalType.ChangeFaucetAmount,
      "Majority against",
      ethers.parseEther("10")
    );
    await daico.connect(investor1).vote(proposalId, false);
    await time.increase(VOTING_DURATION + 1);

    await expect(daico.executeProposal(proposalId)).to.be.revertedWith("Proposal did not pass");
  });

  it("executes treasury withdrawals only after a DAO proposal passes", async function () {
    const fixture = await finalizeSuccessfulFunding();
    const withdrawAmount = ethers.parseEther("2");
    const proposalId = await createPassedProposal(
      fixture,
      ProposalType.WithdrawTreasury,
      "Withdraw treasury",
      withdrawAmount,
      fixture.recipient.address
    );

    await expect(fixture.daico.executeProposal(proposalId)).to.changeEtherBalances(
      [fixture.recipient, fixture.daico],
      [withdrawAmount, -withdrawAmount]
    );
    expect(await fixture.daico.getTreasuryBalance()).to.equal(FUNDING_GOAL - withdrawAmount);
  });

  it("rejects treasury withdrawals larger than the available treasury", async function () {
    const fixture = await finalizeSuccessfulFunding();
    const proposalId = await createPassedProposal(
      fixture,
      ProposalType.WithdrawTreasury,
      "Too much treasury",
      ethers.parseEther("11"),
      fixture.recipient.address
    );

    await expect(fixture.daico.executeProposal(proposalId)).to.be.revertedWith("Insufficient treasury balance");
  });

  it("rejects repeated proposal execution", async function () {
    const fixture = await finalizeSuccessfulFunding();
    const proposalId = await createPassedProposal(
      fixture,
      ProposalType.ChangeFaucetAmount,
      "Set amount once",
      ethers.parseEther("10")
    );

    await fixture.daico.executeProposal(proposalId);

    await expect(fixture.daico.executeProposal(proposalId)).to.be.revertedWith("Proposal already executed");
  });

  it("allows proposal cancellation and blocks later voting", async function () {
    const { owner, investor1, daico } = await finalizeSuccessfulFunding();
    const proposalId = await createProposal(
      daico,
      owner,
      ProposalType.ChangeFaucetAmount,
      "Cancel me",
      ethers.parseEther("10")
    );

    await expect(daico.connect(owner).cancelProposal(proposalId))
      .to.emit(daico, "ProposalCancelled")
      .withArgs(proposalId);

    await expect(daico.connect(investor1).vote(proposalId, true)).to.be.revertedWith("Proposal is canceled");
  });

  it("keeps standard ERC20 approve and transferFrom behavior available", async function () {
    const { investor1, investor2, token } = await finalizeSuccessfulFunding();
    const transferAmount = ethers.parseEther("50");

    await token.connect(investor1).approve(investor2.address, transferAmount);
    await token.connect(investor2).transferFrom(investor1.address, investor2.address, transferAmount);

    expect(await token.allowance(investor1.address, investor2.address)).to.equal(0n);
    expect(await token.balanceOf(investor2.address)).to.equal(transferAmount);
  });
});
