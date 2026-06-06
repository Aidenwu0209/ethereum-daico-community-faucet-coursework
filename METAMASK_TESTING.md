# MetaMask 本地测试配置

本文件用于组员复现本地 Chrome + MetaMask 前端测试。以下信息只适用于 Hardhat 本地链，不要在主网、测试网或任何有真实资产的钱包中使用。

## 测试密码

建议新建一个单独的 MetaMask 测试 profile，并使用下面的本地测试密码：

```text
DAICO-Local-Test-2026!
```

这个密码只是为了让组员保持同一套本地测试说明；它不是生产密码，也不应该用于个人钱包。

## Hardhat 本地网络

在 MetaMask 中添加网络：

| 字段 | 值 |
| --- | --- |
| Network name | `Hardhat Local` |
| RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `31337` |
| Currency symbol | `ETH` |

## 导入测试账户

启动 Hardhat 本地链后：

```bash
npx hardhat node
```

MetaMask 可导入 Hardhat 默认公开测试助记词：

```text
test test test test test test test test test test test junk
```

常用账户：

| 账户 | 地址 |
| --- | --- |
| Account #0 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| Account #1 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| Account #2 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` |

这些账户和助记词是 Hardhat 官方本地开发默认值，任何人都知道，只能用于本地测试。

## 本地运行步骤

1. 安装依赖：

```bash
npm install
```

2. 启动本地链：

```bash
npx hardhat node
```

3. 新开一个终端部署合约：

```bash
npx hardhat run scripts/deploy.js --network localhost
```

默认部署地址通常为：

| 合约 | 地址 |
| --- | --- |
| CFT Token | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| DAICO | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |

部署脚本会自动更新 `frontend/src/contracts.js`。如果重新部署后地址不同，以终端输出和 `frontend/src/contracts.js` 为准。

4. 启动前端：

```bash
npm run frontend
```

默认访问地址：

```text
http://127.0.0.1:5173/
```

## 前端手工测试流程

1. 在 MetaMask 中选择 `Hardhat Local` 网络。
2. 连接前端钱包。
3. 投资 `10 ETH`，确认 MetaMask 交易。
4. 等募资期结束后，点击前端募资模块中的“结算”按钮调用 `finalizeFunding()`；本地测试可用 Hardhat console 或测试脚本推进时间。
5. 领取水龙头。
6. 发起 DAO 提案，例如把水龙头单次领取量改为 `30 CFT`。
7. 投支持票。
8. 推进投票期时间后执行提案。
9. 刷新前端，确认 DAO 提案显示已执行，水龙头单次领取量更新。

已完成的 Chrome + MetaMask 验证记录见：

```text
reports/full-chrome-metamask-test/社区自治水龙头DAICO_完整测试报告.docx
reports/full-chrome-metamask-test/screenshots/
```

## 注意事项

- 不要把个人 MetaMask profile 导入这个公开助记词。
- 不要给这些测试账户转入真实资产。
- 不要把 `.env`、真实私钥、浏览器 profile、MetaMask vault 或 `node_modules` 提交到仓库。
