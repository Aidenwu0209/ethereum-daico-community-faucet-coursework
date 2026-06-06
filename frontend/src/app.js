import Web3 from "web3";
import "./style.css";
import {
  CONTRACT_ADDRESSES,
  DAICO_ABI,
  HARDHAT_CHAIN_ID,
  TOKEN_ABI
} from "./contracts.js";

const els = {
  alert: document.getElementById("alert"),
  connectWallet: document.getElementById("connectWallet"),
  networkStatus: document.getElementById("networkStatus"),
  walletBadge: document.getElementById("walletBadge"),
  walletAddress: document.getElementById("walletAddress"),
  ethBalance: document.getElementById("ethBalance"),
  tokenBalance: document.getElementById("tokenBalance"),
  fundingStatus: document.getElementById("fundingStatus"),
  fundingGoal: document.getElementById("fundingGoal"),
  raisedAmount: document.getElementById("raisedAmount"),
  remainingTime: document.getElementById("remainingTime"),
  fundingProgress: document.getElementById("fundingProgress"),
  investAmount: document.getElementById("investAmount"),
  investButton: document.getElementById("investButton"),
  finalizeButton: document.getElementById("finalizeButton"),
  refundButton: document.getElementById("refundButton"),
  userInvestment: document.getElementById("userInvestment"),
  faucetStatus: document.getElementById("faucetStatus"),
  faucetPool: document.getElementById("faucetPool"),
  faucetAmount: document.getElementById("faucetAmount"),
  faucetCooldown: document.getElementById("faucetCooldown"),
  nextClaimTime: document.getElementById("nextClaimTime"),
  claimFaucetButton: document.getElementById("claimFaucetButton"),
  proposalPower: document.getElementById("proposalPower"),
  proposalType: document.getElementById("proposalType"),
  proposalDescription: document.getElementById("proposalDescription"),
  proposalValue: document.getElementById("proposalValue"),
  proposalRecipient: document.getElementById("proposalRecipient"),
  createProposalButton: document.getElementById("createProposalButton"),
  refreshButton: document.getElementById("refreshButton"),
  proposalList: document.getElementById("proposalList"),
  navItems: Array.from(document.querySelectorAll(".nav-item"))
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const PROPOSAL_TYPES = [
  "修改水龙头单次领取量",
  "修改水龙头冷却时间",
  "开启或关闭水龙头",
  "项目方提取金库资金"
];
const FUNDING_STATUS = ["募资中", "募资失败", "募资成功", "已完成结算"];
const MIN_TOKEN_TO_CLAIM = 1000000000000000000n;
const HARDHAT_NETWORK_PARAMS = {
  chainId: HARDHAT_CHAIN_ID,
  chainName: "Hardhat Local",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18
  },
  rpcUrls: ["http://127.0.0.1:8545"],
  blockExplorerUrls: []
};

let web3;
let account = "";
let tokenContract;
let daicoContract;
let currentChainId = "";
let currentBlockTimestamp = BigInt(Math.floor(Date.now() / 1000));
let lastSnapshot = {
  tokenBalance: 0n,
  fundingGoal: 0n,
  raisedAmount: 0n,
  fundingFinalized: false,
  fundingSuccessful: false,
  fundingRemainingTime: 0n,
  investment: 0n,
  faucetEnabled: false,
  faucetPool: 0n,
  faucetAmount: 0n,
  nextClaimTime: 0n,
  totalSupply: 0n,
  canCreateProposal: false
};

function hasDeploymentConfig() {
  return Boolean(CONTRACT_ADDRESSES.token && CONTRACT_ADDRESSES.daico && TOKEN_ABI.length && DAICO_ABI.length);
}

function showAlert(message, type = "") {
  els.alert.textContent = message;
  els.alert.className = `alert ${type}`.trim();
}

function clearAlert() {
  els.alert.textContent = "";
  els.alert.className = "alert hidden";
}

function normalize(value) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  return String(value ?? "0");
}

function toBigInt(value) {
  return BigInt(normalize(value));
}

function toBool(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function fromWei(value, decimals = 4) {
  if (!web3) {
    return "-";
  }

  const asNumber = Number(web3.utils.fromWei(normalize(value), "ether"));
  return `${asNumber.toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  })}`;
}

function shortAddress(address) {
  if (!address) {
    return "-";
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatSeconds(rawSeconds) {
  const seconds = Number(rawSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0 秒";
  }

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days} 天 ${hours} 小时`;
  }
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟`;
  }
  return `${minutes} 分钟`;
}

function formatInvestmentHint(investment) {
  const amount = `${fromWei(investment, 4)} ETH`;
  if (!lastSnapshot.fundingFinalized) {
    if (lastSnapshot.fundingRemainingTime === 0n) {
      return `个人投资：${amount}；请先结算募资，只有结算失败后才能退款`;
    }
    return `个人投资：${amount}；募资进行中，退款需等募资期结束并结算失败`;
  }
  if (lastSnapshot.fundingSuccessful) {
    return `个人投资：${amount}；募资成功后不可退款`;
  }
  return `可退款投资：${amount}`;
}

function formatFundingStatusText(fundingStatus, percentage) {
  if (lastSnapshot.fundingFinalized) {
    return `${FUNDING_STATUS[Number(fundingStatus)]} / ${lastSnapshot.fundingSuccessful ? "成功" : "失败"}`;
  }
  if (lastSnapshot.fundingRemainingTime > 0n && percentage >= 100) {
    return "募资已达标 / 仍在募资期";
  }
  if (lastSnapshot.fundingRemainingTime === 0n) {
    return `${FUNDING_STATUS[Number(fundingStatus)] || "募资已结束"} / 待结算`;
  }
  return FUNDING_STATUS[Number(fundingStatus)] || "-";
}

function investDisabledReason(connected, ready, amount) {
  if (!connected) {
    return "请先连接 MetaMask 钱包";
  }
  if (!ready) {
    return "请先切换到 Hardhat 本地网络";
  }
  if (lastSnapshot.fundingFinalized) {
    return "募资已结算，不能继续投资";
  }
  if (lastSnapshot.fundingRemainingTime === 0n) {
    return "募资期已结束，请先结算募资";
  }
  if (amount <= 0) {
    return "请输入大于 0 的 ETH 投资金额";
  }
  return "";
}

function investEnabledTitle() {
  return lastSnapshot.raisedAmount >= lastSnapshot.fundingGoal
    ? "募资已达标，但募资期内仍可继续投资"
    : "向 DAICO 合约投资 ETH 并获得 CFT";
}

function finalizeDisabledReason(connected, ready) {
  if (!connected) {
    return "请先连接 MetaMask 钱包";
  }
  if (!ready) {
    return "请先切换到 Hardhat 本地网络";
  }
  if (lastSnapshot.fundingFinalized) {
    return "募资已结算，无需重复结算";
  }
  if (lastSnapshot.fundingRemainingTime > 0n) {
    return lastSnapshot.raisedAmount >= lastSnapshot.fundingGoal
      ? "募资已达标，但仍需等待募资期结束后结算"
      : "募资期尚未结束，暂不能结算";
  }
  return "";
}

function refundDisabledReason(connected, ready) {
  if (!connected) {
    return "请先连接 MetaMask 钱包";
  }
  if (!ready) {
    return "请先切换到 Hardhat 本地网络";
  }
  if (!lastSnapshot.fundingFinalized) {
    return "退款只在募资期结束、结算为失败后开放";
  }
  if (lastSnapshot.fundingSuccessful) {
    return "募资已成功，投资进入项目金库，不能退款";
  }
  if (lastSnapshot.investment === 0n) {
    return "当前钱包没有可退款投资";
  }
  return "";
}

function formatFaucetStatus(enabled) {
  if (!lastSnapshot.fundingFinalized) {
    return "待结算";
  }
  if (!lastSnapshot.fundingSuccessful) {
    return "募资失败";
  }
  return enabled ? "已开启" : "已关闭";
}

function formatNextClaimHint(nextClaim, now) {
  if (!lastSnapshot.fundingFinalized) {
    return "募资成功结算后开放";
  }
  if (!lastSnapshot.fundingSuccessful) {
    return "募资失败，不开放";
  }
  if (!lastSnapshot.faucetEnabled) {
    return "水龙头已关闭";
  }
  if (lastSnapshot.tokenBalance < MIN_TOKEN_TO_CLAIM) {
    return "至少持有 1 CFT 后可领取";
  }
  if (lastSnapshot.faucetPool < lastSnapshot.faucetAmount) {
    return "资金池不足";
  }
  if (nextClaim > now) {
    return `${new Date(Number(nextClaim) * 1000).toLocaleString("zh-CN")}，剩余 ${formatSeconds(nextClaim - now)}`;
  }
  return "现在可领取";
}

function faucetDisabledReason(connected, ready, now) {
  if (!connected) {
    return "请先连接 MetaMask 钱包";
  }
  if (!ready) {
    return "请先切换到 Hardhat 本地网络";
  }
  if (!lastSnapshot.fundingFinalized) {
    return lastSnapshot.fundingRemainingTime === 0n
      ? "请先点击结算；只有募资结算成功后才能领取"
      : "募资尚未结算；水龙头需募资成功并结算后开放";
  }
  if (!lastSnapshot.fundingSuccessful) {
    return "募资失败，水龙头不开放";
  }
  if (!lastSnapshot.faucetEnabled) {
    return "水龙头已被 DAO 关闭";
  }
  if (lastSnapshot.tokenBalance < MIN_TOKEN_TO_CLAIM) {
    return "至少持有 1 CFT 才能领取水龙头";
  }
  if (lastSnapshot.faucetPool < lastSnapshot.faucetAmount) {
    return "水龙头资金池不足";
  }
  if (now < lastSnapshot.nextClaimTime) {
    return `冷却中，剩余 ${formatSeconds(lastSnapshot.nextClaimTime - now)}`;
  }
  return "";
}

function formatProposalPower() {
  if (!lastSnapshot.fundingFinalized) {
    return "待结算";
  }
  if (!lastSnapshot.fundingSuccessful) {
    return "募资失败";
  }
  return lastSnapshot.canCreateProposal ? "可发起" : "未达门槛";
}

function createProposalDisabledReason(connected, ready) {
  if (!connected) {
    return "请先连接 MetaMask 钱包";
  }
  if (!ready) {
    return "请先切换到 Hardhat 本地网络";
  }
  if (!lastSnapshot.fundingFinalized) {
    return "DAO 提案需募资成功并结算后开放";
  }
  if (!lastSnapshot.fundingSuccessful) {
    return "募资失败，DAO 提案不开放";
  }
  if (!lastSnapshot.canCreateProposal) {
    return "CFT 余额未达到 5% 提案门槛";
  }
  return "";
}

function voteDisabledReason(ended, voted, executed, canceled) {
  if (!networkReady()) {
    return "请先切换到 Hardhat 本地网络";
  }
  if (canceled) {
    return "提案已撤销，不能投票";
  }
  if (executed) {
    return "提案已执行，不能投票";
  }
  if (ended) {
    return "投票期已结束";
  }
  if (voted) {
    return "当前钱包已投过票";
  }
  if (lastSnapshot.tokenBalance === 0n) {
    return "当前钱包没有 CFT 投票权";
  }
  return "";
}

function executeDisabledReason(ended, passed, executed, canceled) {
  if (!networkReady()) {
    return "请先切换到 Hardhat 本地网络";
  }
  if (canceled) {
    return "提案已撤销，不能执行";
  }
  if (executed) {
    return "提案已执行，无需重复执行";
  }
  if (!ended) {
    return "投票期尚未结束，不能执行";
  }
  if (!passed) {
    return "提案未通过，不能执行";
  }
  return "";
}

function setButtonState(button, enabled, enabledTitle, disabledTitle) {
  button.disabled = !enabled;
  button.title = enabled ? enabledTitle : disabledTitle;
}

function activateNavItem(targetId) {
  els.navItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.target === targetId);
  });
}

function focusSection(targetId) {
  const target = document.getElementById(targetId);
  if (!target) {
    return;
  }

  activateNavItem(targetId);
  target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  target.focus({ preventScroll: true });
  target.classList.remove("section-highlight");
  window.requestAnimationFrame(() => target.classList.add("section-highlight"));
}

function proposalField(proposal, index, name) {
  return proposal[name] ?? proposal[index];
}

async function connectWallet() {
  if (!window.ethereum) {
    showAlert("未检测到 MetaMask，请安装后再连接。", "error");
    return;
  }

  if (!hasDeploymentConfig()) {
    showAlert("尚未生成合约配置，请先运行 npx hardhat run scripts/deploy.js --network localhost。", "error");
    return;
  }

  try {
    els.connectWallet.textContent = "连接中...";
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    account = accounts[0] || "";
    currentChainId = await ensureHardhatNetwork();
    web3 = new Web3(window.ethereum);
    tokenContract = new web3.eth.Contract(TOKEN_ABI, CONTRACT_ADDRESSES.token);
    daicoContract = new web3.eth.Contract(DAICO_ABI, CONTRACT_ADDRESSES.daico);

    attachWalletListeners();
    await refreshAll();
    clearAlert();
  } catch (error) {
    if (!account) {
      setDisconnectedState();
    }
    showAlert(`钱包连接失败：${error.message || error}`, "error");
  }
}

async function ensureHardhatNetwork() {
  let chainId = await window.ethereum.request({ method: "eth_chainId" });
  if (chainId?.toLowerCase() === HARDHAT_CHAIN_ID) {
    return chainId;
  }

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: HARDHAT_CHAIN_ID }]
    });
  } catch (error) {
    if (error.code !== 4902) {
      throw error;
    }

    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [HARDHAT_NETWORK_PARAMS]
    });
  }

  chainId = await window.ethereum.request({ method: "eth_chainId" });
  return chainId;
}

function attachWalletListeners() {
  window.ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
  window.ethereum.removeListener?.("chainChanged", handleChainChanged);
  window.ethereum.on("accountsChanged", handleAccountsChanged);
  window.ethereum.on("chainChanged", handleChainChanged);
}

async function handleAccountsChanged(accounts) {
  account = accounts[0] || "";
  await refreshAll();
}

async function handleChainChanged(chainId) {
  currentChainId = chainId;
  await refreshAll();
}

function networkReady() {
  return currentChainId?.toLowerCase() === HARDHAT_CHAIN_ID;
}

async function refreshAll() {
  if (!account || !web3 || !tokenContract || !daicoContract) {
    setDisconnectedState();
    return;
  }

  await refreshChainClock();
  await Promise.all([
    refreshWallet(),
    refreshFunding()
  ]);
  await Promise.all([
    refreshFaucet(),
    refreshGovernance()
  ]);
  updateButtons();
}

async function refreshChainClock() {
  const latestBlock = await web3.eth.getBlock("latest");
  currentBlockTimestamp = toBigInt(latestBlock.timestamp);
}

function setDisconnectedState() {
  els.walletBadge.textContent = "未连接";
  els.walletAddress.textContent = "-";
  els.ethBalance.textContent = "-";
  els.tokenBalance.textContent = "-";
  els.networkStatus.textContent = "等待连接钱包";
  els.connectWallet.textContent = "连接 MetaMask 钱包";
  els.fundingStatus.textContent = "待同步";
  els.faucetStatus.textContent = "待同步";
  els.proposalPower.textContent = "待同步";
  els.userInvestment.textContent = "个人投资：-";
  els.investButton.disabled = true;
  els.finalizeButton.disabled = true;
  els.refundButton.disabled = true;
  els.claimFaucetButton.disabled = true;
  els.createProposalButton.disabled = true;
}

async function refreshWallet() {
  const [ethBalance, tokenBalance] = await Promise.all([
    web3.eth.getBalance(account),
    tokenContract.methods.balanceOf(account).call()
  ]);

  lastSnapshot.tokenBalance = toBigInt(tokenBalance);
  els.walletBadge.textContent = networkReady() ? "已连接" : "网络错误";
  els.connectWallet.textContent = networkReady() ? "同步钱包状态" : "切换 Hardhat 网络";
  els.walletAddress.textContent = shortAddress(account);
  els.ethBalance.textContent = `${fromWei(ethBalance, 4)} ETH`;
  els.tokenBalance.textContent = `${fromWei(tokenBalance, 4)} CFT`;
  els.networkStatus.textContent = networkReady()
    ? `Hardhat 本地网络 ${currentChainId}`
    : `请切换到 Hardhat 本地网络 ${HARDHAT_CHAIN_ID}`;
}

async function refreshFunding() {
  const [
    fundingGoal,
    raisedAmount,
    remainingTime,
    fundingStatus,
    fundingFinalized,
    fundingSuccessful,
    investment
  ] = await Promise.all([
    daicoContract.methods.fundingGoal().call(),
    daicoContract.methods.getRaisedAmount().call(),
    daicoContract.methods.getRemainingTime().call(),
    daicoContract.methods.getFundingStatus().call(),
    daicoContract.methods.fundingFinalized().call(),
    daicoContract.methods.fundingSuccessful().call(),
    daicoContract.methods.investments(account).call()
  ]);

  const goal = toBigInt(fundingGoal);
  const raised = toBigInt(raisedAmount);
  const percentage = goal === 0n ? 0 : Number((raised * 10000n) / goal) / 100;

  lastSnapshot.fundingFinalized = toBool(fundingFinalized);
  lastSnapshot.fundingSuccessful = toBool(fundingSuccessful);
  lastSnapshot.fundingRemainingTime = toBigInt(remainingTime);
  lastSnapshot.investment = toBigInt(investment);
  lastSnapshot.fundingGoal = goal;
  lastSnapshot.raisedAmount = raised;
  els.fundingGoal.textContent = `${fromWei(fundingGoal, 2)} ETH`;
  els.raisedAmount.textContent = `${fromWei(raisedAmount, 4)} ETH (${Math.min(percentage, 100).toFixed(2)}%)`;
  els.remainingTime.textContent = formatSeconds(remainingTime);
  els.fundingStatus.textContent = formatFundingStatusText(fundingStatus, percentage);
  els.fundingProgress.style.width = `${Math.min(percentage, 100)}%`;
  els.userInvestment.textContent = formatInvestmentHint(investment);
}

async function refreshFaucet() {
  const [info, nextClaimTime] = await Promise.all([
    daicoContract.methods.getFaucetInfo().call(),
    daicoContract.methods.getNextClaimTime(account).call()
  ]);

  const pool = toBigInt(info.poolBalance ?? info[0]);
  const amount = toBigInt(info.claimAmount ?? info[1]);
  const cooldown = toBigInt(info.cooldown ?? info[2]);
  const enabled = toBool(info.enabled ?? info[3]);
  const nextClaim = toBigInt(nextClaimTime);
  const now = currentBlockTimestamp;

  lastSnapshot.faucetEnabled = enabled;
  lastSnapshot.faucetPool = pool;
  lastSnapshot.faucetAmount = amount;
  lastSnapshot.nextClaimTime = nextClaim;

  els.faucetStatus.textContent = formatFaucetStatus(enabled);
  els.faucetPool.textContent = `${fromWei(pool, 4)} CFT`;
  els.faucetAmount.textContent = `${fromWei(amount, 4)} CFT`;
  els.faucetCooldown.textContent = formatSeconds(cooldown);
  els.nextClaimTime.textContent = formatNextClaimHint(nextClaim, now);
}

async function refreshGovernance() {
  const [proposalCount, totalSupply, canCreate] = await Promise.all([
    daicoContract.methods.getProposalCount().call(),
    tokenContract.methods.totalSupply().call(),
    daicoContract.methods.canCreateProposal(account).call()
  ]);

  lastSnapshot.totalSupply = toBigInt(totalSupply);
  lastSnapshot.canCreateProposal = toBool(canCreate);
  els.proposalPower.textContent = formatProposalPower();

  const count = Number(proposalCount);
  els.proposalList.innerHTML = "";

  if (count === 0) {
    els.proposalList.innerHTML = `<p class="muted">暂无提案</p>`;
    return;
  }

  for (let id = 1; id <= count; id += 1) {
    const [proposal, voted, passed] = await Promise.all([
      daicoContract.methods.getProposal(id).call(),
      daicoContract.methods.hasVoted(id, account).call(),
      daicoContract.methods.isProposalPassed(id).call()
    ]);
    els.proposalList.appendChild(renderProposal(proposal, toBool(voted), toBool(passed)));
  }
}

function renderProposal(proposal, voted, passed) {
  const id = Number(proposalField(proposal, 0, "id"));
  const proposalType = Number(proposalField(proposal, 1, "proposalType"));
  const description = proposalField(proposal, 3, "description");
  const newValue = proposalField(proposal, 4, "newValue");
  const recipient = proposalField(proposal, 5, "recipient");
  const endTime = toBigInt(proposalField(proposal, 7, "endTime"));
  const forVotes = toBigInt(proposalField(proposal, 8, "forVotes"));
  const againstVotes = toBigInt(proposalField(proposal, 9, "againstVotes"));
  const executed = toBool(proposalField(proposal, 10, "executed"));
  const canceled = toBool(proposalField(proposal, 11, "canceled"));
  const totalSupplyAtCreation = toBigInt(proposalField(proposal, 12, "totalSupplyAtCreation"));
  const totalVotes = forVotes + againstVotes;
  const now = currentBlockTimestamp;
  const ended = now >= endTime;
  const supportRate = totalVotes === 0n ? 0 : Number((forVotes * 10000n) / totalVotes) / 100;
  const participation = totalSupplyAtCreation === 0n ? 0 : Number((totalVotes * 10000n) / totalSupplyAtCreation) / 100;

  const card = document.createElement("article");
  card.className = "proposal-card";
  card.innerHTML = `
    <h3>#${id} ${PROPOSAL_TYPES[proposalType] || "未知提案"}</h3>
    <p>${escapeHtml(description)}</p>
    <div class="proposal-meta">
      <span>支持：${fromWei(forVotes, 4)} CFT</span>
      <span>反对：${fromWei(againstVotes, 4)} CFT</span>
      <span>支持率：${supportRate.toFixed(2)}%</span>
      <span>参与率：${participation.toFixed(2)}%</span>
      <span>剩余：${ended ? "已结束" : formatSeconds(endTime - now)}</span>
      <span>结果：${passed ? "已通过" : "未通过"}</span>
      <span>状态：${canceled ? "已撤销" : executed ? "已执行" : "未执行"}</span>
      <span>参数：${formatProposalValue(proposalType, newValue)}</span>
      <span>收款：${recipient === ZERO_ADDRESS ? "-" : shortAddress(recipient)}</span>
    </div>
  `;

  const actions = document.createElement("div");
  actions.className = "proposal-actions";
  const voteFor = makeButton("支持", () => sendVote(id, true));
  const voteAgainst = makeButton("反对", () => sendVote(id, false));
  const execute = makeButton("执行提案", () => sendExecute(id));
  const canVote = networkReady() && !ended && !voted && !executed && !canceled && lastSnapshot.tokenBalance > 0n;
  const canExecute = networkReady() && ended && passed && !executed && !canceled;
  setButtonState(voteFor, canVote, "支持该提案", voteDisabledReason(ended, voted, executed, canceled));
  setButtonState(voteAgainst, canVote, "反对该提案", voteDisabledReason(ended, voted, executed, canceled));
  setButtonState(execute, canExecute, "执行已通过的提案", executeDisabledReason(ended, passed, executed, canceled));
  actions.append(voteFor, voteAgainst, execute);
  card.appendChild(actions);

  return card;
}

function formatProposalValue(proposalType, value) {
  if (proposalType === 0) {
    return `${fromWei(value, 4)} CFT`;
  }
  if (proposalType === 1) {
    return formatSeconds(value);
  }
  if (proposalType === 2) {
    return normalize(value) === "1" ? "开启" : "关闭";
  }
  return `${fromWei(value, 4)} ETH`;
}

function makeButton(label, onClick) {
  const button = document.createElement("button");
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateButtons() {
  const connected = Boolean(account);
  const ready = connected && networkReady();
  const investAmount = Number(els.investAmount.value || 0);
  const canInvest = ready
    && !lastSnapshot.fundingFinalized
    && lastSnapshot.fundingRemainingTime > 0n
    && investAmount > 0;
  const canFinalize = ready
    && !lastSnapshot.fundingFinalized
    && lastSnapshot.fundingRemainingTime === 0n;
  const canRefund = ready
    && lastSnapshot.fundingFinalized
    && !lastSnapshot.fundingSuccessful
    && lastSnapshot.investment > 0n;
  const now = currentBlockTimestamp;
  const canClaim = ready
    && lastSnapshot.fundingFinalized
    && lastSnapshot.fundingSuccessful
    && lastSnapshot.faucetEnabled
    && lastSnapshot.tokenBalance >= MIN_TOKEN_TO_CLAIM
    && lastSnapshot.faucetPool >= lastSnapshot.faucetAmount
    && now >= lastSnapshot.nextClaimTime;
  const canCreateProposal = ready
    && lastSnapshot.fundingFinalized
    && lastSnapshot.fundingSuccessful
    && lastSnapshot.canCreateProposal;

  setButtonState(
    els.investButton,
    canInvest,
    investEnabledTitle(),
    investDisabledReason(connected, ready, investAmount)
  );
  setButtonState(
    els.finalizeButton,
    canFinalize,
    "结算募资状态",
    finalizeDisabledReason(connected, ready)
  );
  setButtonState(
    els.refundButton,
    canRefund,
    "退回失败募资中的个人投资",
    refundDisabledReason(connected, ready)
  );
  setButtonState(
    els.claimFaucetButton,
    canClaim,
    "领取水龙头 CFT",
    faucetDisabledReason(connected, ready, now)
  );
  setButtonState(
    els.createProposalButton,
    canCreateProposal,
    "创建 DAO 治理提案",
    createProposalDisabledReason(connected, ready)
  );
}

async function sendInvest() {
  const amount = Number(els.investAmount.value || 0);
  if (amount <= 0) {
    showAlert("投资金额必须大于 0。", "error");
    return;
  }

  await sendTransaction("投资", () => daicoContract.methods.invest().send({
    from: account,
    value: web3.utils.toWei(String(amount), "ether")
  }));
}

async function sendRefund() {
  await sendTransaction("退款", () => daicoContract.methods.refund().send({ from: account }));
}

async function sendFinalizeFunding() {
  await sendTransaction("募资结算", () => daicoContract.methods.finalizeFunding().send({ from: account }));
}

async function sendClaimFaucet() {
  await sendTransaction("领取水龙头", () => daicoContract.methods.claimFaucet().send({ from: account }));
}

async function sendCreateProposal() {
  const proposalType = Number(els.proposalType.value);
  const description = els.proposalDescription.value.trim();
  const rawValue = els.proposalValue.value.trim();
  const recipient = els.proposalRecipient.value.trim() || ZERO_ADDRESS;

  if (!description) {
    showAlert("提案说明不能为空。", "error");
    return;
  }

  let newValue;
  try {
    if (proposalType === 0) {
      newValue = web3.utils.toWei(rawValue || "0", "ether");
    } else if (proposalType === 1) {
      newValue = String(Number(rawValue || "0"));
    } else if (proposalType === 2) {
      newValue = rawValue === "1" ? "1" : "0";
    } else {
      newValue = web3.utils.toWei(rawValue || "0", "ether");
    }
  } catch (error) {
    showAlert(`提案参数无效：${error.message || error}`, "error");
    return;
  }

  await sendTransaction("发起提案", () => daicoContract.methods
    .createProposal(proposalType, description, newValue, recipient)
    .send({ from: account }));
  els.proposalDescription.value = "";
  els.proposalValue.value = "";
  els.proposalRecipient.value = "";
}

async function sendVote(id, support) {
  await sendTransaction(support ? "投支持票" : "投反对票", () => daicoContract.methods
    .vote(id, support)
    .send({ from: account }));
}

async function sendExecute(id) {
  await sendTransaction("执行提案", () => daicoContract.methods
    .executeProposal(id)
    .send({ from: account }));
}

async function sendTransaction(label, buildTx) {
  try {
    showAlert(`${label}处理中...`);
    const receipt = await buildTx();
    showAlert(`${label}成功，交易哈希：${receipt.transactionHash}`, "success");
    await refreshAll();
  } catch (error) {
    showAlert(`${label}失败：${error.message || error}`, "error");
  }
}

els.connectWallet.addEventListener("click", connectWallet);
els.investAmount.addEventListener("input", updateButtons);
els.investButton.addEventListener("click", sendInvest);
els.finalizeButton.addEventListener("click", sendFinalizeFunding);
els.refundButton.addEventListener("click", sendRefund);
els.claimFaucetButton.addEventListener("click", sendClaimFaucet);
els.createProposalButton.addEventListener("click", sendCreateProposal);
els.refreshButton.addEventListener("click", refreshAll);
els.navItems.forEach((item) => {
  item.addEventListener("click", (event) => {
    event.preventDefault();
    focusSection(item.dataset.target);
  });
});

setDisconnectedState();
if (!hasDeploymentConfig()) {
  showAlert("合约地址和 ABI 尚未生成。请先编译并运行部署脚本。");
}
setInterval(() => {
  updateButtons();
  if (account) {
    refreshChainClock()
      .then(refreshFunding)
      .then(refreshFaucet)
      .then(updateButtons)
      .catch(() => {});
  }
}, 30_000);
