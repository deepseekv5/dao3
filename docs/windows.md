# Windows 支持说明

**先说清楚边界**：本仓库的开发与回归验证都在 macOS (arm64) 上完成，
Windows 分支**没有在真实 Windows 机器上实跑过**。下面区分三类结论：
静态审计过的、按平台 API 显式写好的、以及未验证的。不想假装"全平台已测"。

## 已静态审计：运行时不含任何平台专属代码

| 检查项 | 结论 |
|---|---|
| `server.js` 依赖 | 只有 `node:http/fs/path/zlib/url` 内置模块，无原生扩展、无 shell 调用 |
| 路径拼接 | 全部走 `path.join`，没有手写 `/` 分隔符 |
| 路径越界防护 | `filePath.startsWith(PUBLIC)`——`path.join` 在 Windows 上同样产出反斜杠，比较一致 |
| MIME / 扩展名 | `path.extname().toLowerCase()`，Windows 大小写不敏感反而更安全 |
| 落盘格式 | `gzip(JSON)`，跨平台字节一致；官方 Unity 侧 `.gz` 可直接互读 |
| Node 要求 | ≥ 18（只用内置模块与 ESM），Windows 官方安装包即可 |

## 按平台显式写好的部分

启动逻辑集中在 `start.mjs`，**三端同一份实现**——这是刻意的：
老的 `run.sh` 用了 `ifconfig` / `lsof` / `stat -f%i`，这些在 Windows 上根本不存在。
把端口探测、局域网地址、打开浏览器交给 Node 内置能力后，行为才真的可能一致。

```js
if (platform === "darwin")      spawn("open", [url], …)
else if (platform === "win32")  spawn("cmd", ["/c", "start", "", url], …)
else                            spawn("xdg-open", [url], …)
```

端口占用用 `net.createServer()` 试监听来探测（跨平台），
而不是解析 `lsof`/`netstat` 的输出。

局域网地址用 `os.networkInterfaces()`，替代 `ifconfig` 文本解析。

### 批处理与 PowerShell 的两个坑，已处理

1. **编码**：`.bat` 里有中文提示，Windows 默认代码页是 GBK，UTF-8 会显示成乱码。
   已在文件头加 `chcp 65001 >nul` 切到 UTF-8。
2. **行尾**：`.bat` / `.ps1` 已转成 CRLF；`run.sh` / `启动-macOS.command` 保持 LF
   （shell 脚本带 CRLF 会在 shebang 后多出 `\r`，直接报 `bad interpreter`）。

```
启动-Windows.bat   DOS batch file, UTF-8, CRLF
run-win.ps1        Unicode text, UTF-8, CRLF
run.sh             Bourne-Again shell script, UTF-8, LF
启动-macOS.command  Bourne-Again shell script, UTF-8, LF
```

PowerShell 脚本只用 **5.1 也支持**的语法（Windows 自带那一版没有 `??`、没有三元），
所以不需要先装 PowerShell 7。

## 怎么用

**方式一：双击** —— 资源管理器里双击 `启动-Windows.bat`。
没装 Node 会打印下载地址并 `pause`，不会一闪而过。

**方式二：PowerShell**
```powershell
powershell -ExecutionPolicy Bypass -File run-win.ps1
# 或已放开执行策略时： .\run-win.ps1 --port=5173
```

启动后自动打开 <http://127.0.0.1:5173/>；端口被占用会自动顺延并打印实际地址。

## 未验证 / 可能出问题的地方

诚实清单：

1. **`npm test` 在 Windows 上未实跑**。`test/browser.mjs` 已经加了
   Windows 的 playwright 缓存路径（`%LOCALAPPDATA%\ms-playwright`）、
   `chrome-headless-shell-win/chrome-headless-shell.exe`、
   `C:/Program Files/Google/Chrome/...` 与 `%APPDATA%\npm\node_modules`，
   但这套解析逻辑在 Windows 上只经过代码审查。
2. **`run.sh` 在 Windows 上不可用**，这是设计如此（它依赖 POSIX 工具）。
   请走 `.bat` 或 `.ps1`。Git Bash 下能跑，但 `lsof` 通常缺失，
   顶多导致"没停掉旧进程"，不影响启动。
3. **字体渲染**：界面字体栈是 `Rubik, MiSans, Montserrat, PingFang SC,
   noto-sans-sc, Microsoft YaHei`。Windows 上会落到 `Microsoft YaHei`，
   字宽与 macOS 略有差异，个别密集面板（属性卡、玩家面板）可能需要微调。
4. **`chcp 65001`** 在极老的 Windows 7 中文环境下可能仍显示异常；
   Win10 1803+ 无此问题。
5. **鼠标指针锁定**（运行模式转视角）依赖浏览器实现，Chrome/Edge on Windows
   正常；若被浏览器策略拒绝，已退化为"按住左/右键拖动转视角"。

## 如果你 in Windows 上跑出问题

开 issue 时请带上：

```powershell
node --version
powershell -Command "$PSVersionTable.PSVersion"
```

以及浏览器控制台的报错。因为这套代码是零依赖纯 Node，
Windows 上的失败几乎一定是**平台层**（路径分隔、编码、进程调用、字体），
而不是依赖编译问题——定位起来通常很快。
