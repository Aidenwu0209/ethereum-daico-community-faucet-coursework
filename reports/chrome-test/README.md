# Chrome + MetaMask 补充测试记录

测试日期：2026-06-05 至 2026-06-06
目标：使用 Chrome for Testing 和独立 MetaMask 测试钱包，补齐前端钱包连接、签名交易、链上状态刷新和一屏 UI 检查。
结论：已完成补测。合约单元测试通过，前端可在本地 Hardhat 网络中连接 MetaMask，并完成投资、结算、水龙头领取、DAO 提案、投票、执行后的状态刷新。

## 测试环境

| 检查项 | 结果 |
| --- | --- |
| 浏览器 | Google Chrome for Testing |
| 前端地址 | `http://127.0.0.1:5173/` |
| Hardhat RPC | `http://127.0.0.1:8545` |
| Chain ID | `31337` |
| 钱包 | 独立测试 MetaMask profile |
| 测试账户 | Hardhat 默认测试账户 `0xf39f...2266` |
| Token 合约 | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| DAICO 合约 | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |

独立测试 profile 位于本机 `.daico-coursework` 目录，未提交到仓库；仓库中没有提交私钥、助记词、`.env` 或 `node_modules`。

## 命令验证

| 命令 | 结果 |
| --- | --- |
| `npx hardhat compile` | 通过 |
| `npx hardhat test` | 通过，`39 passing` |
| `npm --workspace frontend run build` | 通过，仅有 Web3 bundle 体积提示 |

## Chrome + MetaMask 操作验证

| 流程 | 结果 |
| --- | --- |
| 连接 MetaMask | 通过，前端识别 Hardhat Local 网络和测试账户 |
| 投资募资 | 通过，MetaMask 确认 `invest()` 交易 |
| 募资结算 | 通过，时间推进后完成成功结算 |
| 水龙头领取 | 通过，MetaMask 确认 `claimFaucet()` 交易 |
| 发起 DAO 提案 | 通过，创建修改水龙头单次领取量提案 |
| DAO 投票 | 通过，使用测试账户投支持票 |
| DAO 执行 | 通过，投票期结束后执行提案 |
| 状态刷新 | 通过，前端显示提案已执行，水龙头领取量更新为 `30 CFT` |

已记录的交易哈希：

| 操作 | 交易哈希 |
| --- | --- |
| 投资 | `0x25e744f4d56fae29219161941ab5f7e7035c976fb3bbc57bdd5505b6f2ced4a5` |
| 领取水龙头 | `0x8da09d7e1f968d5188109143213c2ded0149e8944a79bd6cf871eebc36258198` |
| 发起提案 | `0xeb60d720f7d21b3f6f07ffe5ccd52b4fe62965b7f0dfa14b943da75ba32c3fb3` |
| 投支持票 | `0x864c98490c7e224efbb8d22aa6cb5c1dfc15b667c367fe7b5747f301984f1b03` |

## UI 检查

用户希望采用科技感三栏控制台视觉，并尽量一屏显示主要模块。最终前端保留：

- 顶部品牌区、链 ID、RPC、MetaMask 连接按钮。
- 左侧协议导航。
- 右侧执行环境。
- 中间钱包、募资、水龙头、发起提案、DAO 治理五个核心模块。
- 状态徽标使用明确文案，例如 `待同步`、`未连接`，不再使用含义不清的 `-` 圆形按钮。
- DAO 列表内部滚动，避免整个页面因多提案而长距离滚动。

最终截图：`reports/chrome-test/tech-ui-screenshot-style-one-screen.png`

在 Chrome for Testing 当前窗口测量结果：

| 指标 | 结果 |
| --- | --- |
| `window.innerHeight` | `711` |
| `document.documentElement.scrollHeight` | `711` |
| 首屏可见模块 | 钱包、募资、水龙头、发起提案、DAO 治理 |

## 剩余风险

MetaMask UI 测试依赖本机独立测试 profile。若重新清理该 profile，需要重新导入 Hardhat 测试账户并添加 Hardhat Local 网络；这不影响合约测试和前端构建。
