# 社区自治水龙头 DAICO

题目一“社区自治水龙头 DAICO”的程序实现。项目包含 Solidity 合约、Hardhat 部署脚本、Hardhat 测试用例和 Web3.js 前端。

## 功能范围

- ERC20 代币：`Community Faucet Token` / `CFT`，只允许 DAICO 合约在募资阶段铸造，募资结算后永久关闭铸造。
- DAICO 募资：投资、募资状态、结束结算、失败退款、成功后进入金库。
- 水龙头：10% 预留池、持币门槛、单次领取上限、24 小时冷却、DAO 可修改参数。
- DAO 治理：项目方或 5% 持币用户发起提案，72 小时投票，51% 支持率和 20% 参与率通过。
- 提案类型：修改水龙头领取量、修改冷却时间、开启/关闭水龙头、通过 DAO 提取金库资金。
- 前端：MetaMask 连接、余额、投资、退款、水龙头、提案、投票和执行。

## 环境要求

- Node.js 18+
- npm
- MetaMask

## 安装

```bash
npm install
```

根目录使用 npm workspace，执行上面的命令会同时安装 Hardhat 和前端依赖。

## 编译

```bash
npx hardhat compile
```

## 测试

```bash
npx hardhat test
```

测试覆盖部署、投资、退款、水龙头领取、冷却、提案门槛、投票、重复投票、提案执行、金库提款、ERC20 标准接口和异常回滚。

## 完整测试报告

本轮重新删除旧版浏览器测试证据后，已从头运行安装、编译、合约测试、部署、前端构建和 Chrome 页面 E2E 流程。详细 Word 报告、命令日志和每步截图位于：

```text
reports/full-chrome-metamask-test/社区自治水龙头DAICO_完整测试报告.docx
```

报告内记录了 Chrome/Computer Use 测试过程、39 个 Hardhat 测试用例结果、MetaMask 扩展页自动化限制，以及连接、募资、结算、水龙头、DAO 提案、投票和执行的截图证据。

## MetaMask 组员测试配置

Chrome + MetaMask 本地测试所需的测试密码、Hardhat Local 网络参数、公开测试助记词、账户地址和手工操作流程已整理在：

```text
METAMASK_TESTING.md
```

这些信息只用于 Hardhat 本地链复现，不要用于主网、测试网或任何个人钱包。

## 本地部署与前端运行

1. 启动 Hardhat 本地链：

```bash
npx hardhat node
```

2. 在另一个终端部署合约：

```bash
npx hardhat run scripts/deploy.js --network localhost
```

部署脚本会输出部署账户、Token 地址、DAICO 地址、募资目标、募资时长、兑换比例，并自动生成：

```text
frontend/src/contracts.js
```

3. 启动前端：

```bash
npm run frontend
```

打开终端输出的 Vite 地址，默认是：

```text
http://127.0.0.1:5173/
```

4. MetaMask 网络设置：

- Network name: `Hardhat Local`
- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Currency symbol: `ETH`

## 常用命令

```bash
npm install
npx hardhat compile
npx hardhat test
npx hardhat node
npx hardhat run scripts/deploy.js --network localhost
npm run frontend
```

## 目录结构

```text
contracts/
  CommunityToken.sol
  CommunityDAICO.sol
scripts/
  deploy.js
test/
  CommunityDAICO.test.js
frontend/
  index.html
  package.json
  src/
    app.js
    contracts.js
    style.css
hardhat.config.js
package.json
README.md
```

## 安全说明

- 关键输入和状态均使用 `require` 校验。
- 水龙头代币发放使用 OpenZeppelin `SafeERC20`。
- 退款和金库提款使用 `ReentrancyGuard`。
- ETH 退款和金库转账遵循 Checks-Effects-Interactions。
- 合约没有使用 `selfdestruct` 或 `delegatecall`。
- 金库资金只能通过 DAO 提案投票通过后提取。
