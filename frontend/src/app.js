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
  proposalList: document.getElementById("proposalList")
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const PROPOSAL_TYPES = [
  "修改水龙头单次领取量",
  "修改水龙头冷却时间",
  "开启或关闭水龙头",
  "项目方提取金库资金"
];
const FUNDING_STATUS = ["募资中", "募资失败", "募资成功", "已完成结算"];
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
  fundingFinalized: false,
  fundingSuccessful: false,
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
    refreshFunding(),
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
  els.investButton.disabled = true;
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
  lastSnapshot.investment = toBigInt(investment);
  els.fundingGoal.textContent = `${fromWei(fundingGoal, 2)} ETH`;
  els.raisedAmount.textContent = `${fromWei(raisedAmount, 4)} ETH (${Math.min(percentage, 100).toFixed(2)}%)`;
  els.remainingTime.textContent = formatSeconds(remainingTime);
  els.fundingStatus.textContent = lastSnapshot.fundingFinalized
    ? `${FUNDING_STATUS[Number(fundingStatus)]} / ${lastSnapshot.fundingSuccessful ? "成功" : "失败"}`
    : FUNDING_STATUS[Number(fundingStatus)] || "-";
  els.fundingProgress.style.width = `${Math.min(percentage, 100)}%`;
  els.userInvestment.textContent = `可退款投资：${fromWei(investment, 4)} ETH`;
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

  els.faucetStatus.textContent = enabled ? "已开启" : "已关闭";
  els.faucetPool.textContent = `${fromWei(pool, 4)} CFT`;
  els.faucetAmount.textContent = `${fromWei(amount, 4)} CFT`;
  els.faucetCooldown.textContent = formatSeconds(cooldown);
  els.nextClaimTime.textContent = nextClaim > now
    ? `${new Date(Number(nextClaim) * 1000).toLocaleString("zh-CN")}，剩余 ${formatSeconds(nextClaim - now)}`
    : "现在可领取";
}

async function refreshGovernance() {
  const [proposalCount, totalSupply, canCreate] = await Promise.all([
    daicoContract.methods.getProposalCount().call(),
    tokenContract.methods.totalSupply().call(),
    daicoContract.methods.canCreateProposal(account).call()
  ]);

  lastSnapshot.totalSupply = toBigInt(totalSupply);
  lastSnapshot.canCreateProposal = toBool(canCreate);
  els.proposalPower.textContent = lastSnapshot.canCreateProposal ? "可发起" : "未达门槛";

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
  voteFor.disabled = !networkReady() || ended || voted || executed || canceled || lastSnapshot.tokenBalance === 0n;
  voteAgainst.disabled = voteFor.disabled;
  execute.disabled = !networkReady() || !ended || !passed || executed || canceled;
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
  const canInvest = ready && !lastSnapshot.fundingFinalized && investAmount > 0;
  const canRefund = ready
    && lastSnapshot.fundingFinalized
    && !lastSnapshot.fundingSuccessful
    && lastSnapshot.investment > 0n;
  const now = currentBlockTimestamp;
  const canClaim = ready
    && lastSnapshot.fundingFinalized
    && lastSnapshot.fundingSuccessful
    && lastSnapshot.faucetEnabled
    && lastSnapshot.tokenBalance >= 1000000000000000000n
    && lastSnapshot.faucetPool >= lastSnapshot.faucetAmount
    && now >= lastSnapshot.nextClaimTime;

  els.investButton.disabled = !canInvest;
  els.refundButton.disabled = !canRefund;
  els.claimFaucetButton.disabled = !canClaim;
  els.createProposalButton.disabled = !ready || !lastSnapshot.canCreateProposal;
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
els.refundButton.addEventListener("click", sendRefund);
els.claimFaucetButton.addEventListener("click", sendClaimFaucet);
els.createProposalButton.addEventListener("click", sendCreateProposal);
els.refreshButton.addEventListener("click", refreshAll);

setDisconnectedState();
if (!hasDeploymentConfig()) {
  showAlert("合约地址和 ABI 尚未生成。请先编译并运行部署脚本。");
}
setInterval(() => {
  updateButtons();
  if (account) {
    refreshChainClock()
      .then(() => Promise.all([refreshFunding(), refreshFaucet()]))
      .then(updateButtons)
      .catch(() => {});
  }
}, 30_000);
