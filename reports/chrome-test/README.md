# Chrome + MetaMask 补充测试记录

测试日期：2026-06-05  
目标：使用真实 Chrome 补齐上一次未覆盖的 MetaMask 钱包连接、签名交易和前端链上交互测试。  
结论：本次确认了 Chrome 和 MetaMask 扩展存在，但当前 Codex 会话未能获得可操作的 `@电脑` 桌面控制工具，Chrome 调试端口和系统截图自动化也没有正常可用，因此无法完成真实 MetaMask 授权弹窗和钱包签名交易测试。

## 已确认事实

| 检查项 | 结果 |
| --- | --- |
| Google Chrome 是否安装 | 已安装，路径为 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |
| Chrome 是否正在运行 | 正在运行 |
| MetaMask 扩展是否存在 | 已存在，扩展 ID 为 `nkbihfbeogaeaoehlefnkodbefgpgknn` |
| MetaMask 扩展版本 | `13.33.0.0_0` |
| 本地前端服务 | 本次测试期间已确认 `http://127.0.0.1:5173/` 可用 |
| Hardhat RPC | 本次测试期间已确认 `http://127.0.0.1:8545` 可用 |
| 上一次链上测试 | `npx hardhat test` 已通过，`39 passing` |

## 尝试过的 Chrome 测试路径

### 1. 连接当前真实 Chrome 的调试端口

执行检查：

```bash
lsof -nP -iTCP:9222 -sTCP:LISTEN
curl --connect-timeout 1 --max-time 2 -sS http://127.0.0.1:9222/json/version
```

结果：当前用户 Chrome 未开放 DevTools remote debugging 端口，无法通过 CDP 自动读取页面、点击或截图。

### 2. 启动独立 Chrome 测试实例并加载 MetaMask 扩展

尝试使用以下参数启动独立测试 Chrome：

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --user-data-dir=/tmp/daico-chrome-test-profile \
  --remote-debugging-port=9222 \
  --no-first-run \
  --no-default-browser-check \
  --disable-extensions-except="$HOME/Library/Application Support/Google/Chrome/Default/Extensions/nkbihfbeogaeaoehlefnkodbefgpgknn/13.33.0.0_0" \
  --load-extension="$HOME/Library/Application Support/Google/Chrome/Default/Extensions/nkbihfbeogaeaoehlefnkodbefgpgknn/13.33.0.0_0" \
  http://127.0.0.1:5173/
```

又尝试过 `9333` 和 `9444` 端口，以及 `open -na "Google Chrome" --args ...` 启动方式。

结果：Chrome 进程启动，但没有实际监听对应 remote debugging 端口，也没有生成 `DevToolsActivePort`，因此无法接管页面。

### 3. Chrome headless 截图

尝试使用真实 Chrome binary：

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --headless=new \
  --disable-gpu \
  --user-data-dir=/tmp/daico-chrome-headless \
  --window-size=1280,900 \
  --screenshot=reports/chrome-test/01-chrome-desktop.png \
  http://127.0.0.1:5173/
```

结果：命令卡住且没有产出截图文件。

### 4. macOS 系统截图

尝试：

```bash
screencapture -x reports/chrome-test/01-chrome-visible-screen.png
```

结果：命令卡住且没有产出截图。推断当前会话缺少可用的屏幕录制/截图权限，或系统层面阻塞了自动截图。

### 5. `@电脑` 插件

已请求安装并得到确认：

```text
computer-use@openai-bundled installed / user_confirmed=true
```

本机服务存在：

```text
/Users/wu/.codex/computer-use/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService
```

但当前会话中 `tool_search` 没有暴露 computer-use 的截图、点击、输入、滚动等 MCP 工具；`list_mcp_resources(server="computer-use")` 返回 unknown MCP server。因此当前无法实际用 `@电脑` 控制 Chrome 或 MetaMask。

## 未完成的测试

这些测试仍未能在真实 Chrome + MetaMask 环境下完成：

- MetaMask 连接授权弹窗。
- 前端连接后显示真实钱包地址、ETH 余额和 CFT 余额。
- 使用 MetaMask 在前端发起 `invest()` 投资交易。
- 前端交易成功后刷新募资进度和代币余额。
- 前端触发 `refund()`。
- 前端触发 `claimFaucet()`。
- 前端发起 DAO 提案、投票和执行提案。

这些链上流程已由 Hardhat 测试覆盖，但还没有在真实 Chrome + MetaMask UI 中逐项点击验证。

## 需要用户配合或环境修复

要完成真实 Chrome + MetaMask 前端测试，需要满足至少一种条件：

1. 当前 Codex 会话重新加载后真正暴露 `computer-use` 工具，包括截图、点击、输入和键盘操作。
2. 你手动启动一个带调试端口的 Chrome，例如：

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/Library/Application Support/Google/Chrome"
```

3. 你在系统设置里允许 Codex / Computer Use 相关进程的辅助功能和屏幕录制权限，然后重新开启本任务。
4. 你手动在 Chrome + MetaMask 中完成授权，我在旁边用可用截图/日志方式记录结果；但当前系统截图也被阻塞，所以仍需要截图权限恢复。

## 当前状态

本次没有发现合约或前端代码本身的新问题。主要问题是自动化能力和权限层面的阻塞，而不是项目代码测试失败。

补充：在清理旧 Hardhat/Vite 会话后，当前 Codex shell 内再次执行 `npx hardhat test`、`npm --workspace frontend run build` 和直接执行 `./node_modules/.bin/hardhat test` 均出现进程卡住、无输出的情况；未出现测试断言失败。建议在 computer-use 工具正常暴露后，重新打开一个干净 Codex/终端会话复跑：

```bash
npx hardhat test
npm --workspace frontend run build
```
