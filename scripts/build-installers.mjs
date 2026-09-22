#!/usr/bin/env node
// build-installers.mjs — 在便携包之上再产出各平台的"安装包"。
//
// 分工是刻意的：
//   macOS .dmg  用系统自带的 hdiutil，本机就能产出并挂载验证。
//   Windows .exe 需要 Inno Setup（只有 Windows 有），本脚本只生成 dao3.iss，
//              真正编译交给 GitHub Actions 的 windows-latest，见 .github/workflows/release.yml。
// 不假装能在 macOS 上产出 Windows 安装包。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG = path.resolve(process.argv[2] || path.join(ROOT, "..", "DAO3-便携包"));
const OUT_DIR = path.resolve(process.argv[3] || path.join(ROOT, "..", "DAO3-安装包"));
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version || "0.0.0";
const APP = "DAO3 编辑器复刻";

if (!fs.existsSync(path.join(PKG, "server.js"))) {
  console.error(`便携包不存在：${PKG}\n先跑 node scripts/build-portable.mjs`);
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} → ${r.status}\n${(r.stderr || r.stdout || "").slice(0, 600)}`);
  return (r.stdout || "").trim();
};

/* --------------------------------- macOS .dmg -------------------------------- */
function buildDmg() {
  if (process.platform !== "darwin") {
    console.log("SKIP  .dmg 需要 macOS 的 hdiutil（当前 " + process.platform + "）");
    return null;
  }
  const stage = path.join(os.tmpdir(), `dao3-dmg-${Date.now()}`);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(path.join(stage, APP), { recursive: true });

  // 只复制，不重新打包：便携包已经过授权扫描，装进去的东西必须和 zip 完全一致
  fs.cpSync(PKG, path.join(stage, APP), { recursive: true });

  // actions/upload-artifact@v4 不保留 Unix 权限位，所以从 CI 产物做出来的 .dmg 里
  // 启动-macOS.command 会丢掉可执行位——双击没反应。这里按扩展名补回来，
  // 本地构建（权限本来就对）走同一条路径也无害。
  const fixExec = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { fixExec(p); continue; }
      if (/\.(sh|command|bash|zsh)$/.test(e.name)) fs.chmodSync(p, 0o755);
    }
  };
  fixExec(path.join(stage, APP));
  fs.writeFileSync(
    path.join(stage, "请先读我.txt"),
    [
      `${APP} ${VERSION}`,
      "",
      "这是一个本地应用，不是 .app 包，所以不需要「拖进应用程序文件夹」。",
      "可以直接在本磁盘镜像里双击 启动-macOS.command 运行；",
      "但镜像是只读的，此时地图会改存到 ~/.dao3-editor/ 下（启动时会打印实际位置）。",
      "想让它保存在这个文件夹里，请把整个文件夹复制到本地磁盘（如桌面）后再启动。",
      "",
      "首次双击可能被 Gatekeeper 拦住（未做开发者签名），处理办法：",
      "  右键点 启动-macOS.command → 打开 → 再点「打开」。",
      "或者在终端里执行： xattr -dr com.apple.quarantine 「拖进来的文件夹路径」",
      "",
      "端口被你自己上一个实例占着会自动回收；被别的程序占着则不会去杀它，会改用其他端口。",
      "前置条件：Node 18+（本包不含 Node 运行时，也没有内置，见 README）。",
      "",
      "包内含一份官方「赛车模板」地图数据，但不会自动启用：",
      "首次打开工作台会要求你确认有权在本地使用该地图，确认后才装进世界库。",
      "音效与赛道模型不在包内（著作权原因），可用 npm run fetch:official 按 CID 取回。",
      "",
      "与 dao3.fun / 神奇代码岛官方无任何隶属、授权或背书关系。",
      "",
    ].join("\n"),
    "utf8"
  );

  const dmg = path.join(OUT_DIR, `DAO3-${VERSION}.dmg`);
  fs.rmSync(dmg, { force: true });
  run("hdiutil", ["create", "-srcfolder", stage, "-volname", APP, "-format", "UDZO", "-imagekey", "zlib-level=9", "-o", dmg]);
  fs.rmSync(stage, { recursive: true, force: true });

  // 挂载验证：只检查"能挂上且文件在"是不够的，必须确认双击入口和可执行位都还在
  const mnt = path.join(os.tmpdir(), `dao3-mnt-${Date.now()}`);
  fs.mkdirSync(mnt, { recursive: true });
  let verify;
  try {
    run("hdiutil", ["attach", dmg, "-mountpoint", mnt, "-readonly", "-nobrowse", "-noautoopen"]);
    const launcher = path.join(mnt, APP, "启动-macOS.command");
    verify = {
      mounted: true,
      launcher: fs.existsSync(launcher),
      launcherExecutable: fs.existsSync(launcher) && (fs.statSync(launcher).mode & 0o111) !== 0,
      server: fs.existsSync(path.join(mnt, APP, "server.js")),
      readme: fs.existsSync(path.join(mnt, "请先读我.txt")),
    };
  } finally {
    run("hdiutil", ["detach", mnt, "-force"], { stdio: "ignore" });
    fs.rmSync(mnt, { recursive: true, force: true });
  }
  const bad = Object.entries(verify).filter(([, v]) => v !== true);
  if (bad.length) throw new Error(".dmg 校验失败: " + JSON.stringify(bad));
  return { file: path.basename(dmg), bytes: fs.statSync(dmg).size, verify };
}

/* ------------------------------- Windows .iss ------------------------------- */
// Inno Setup 6 的脚本。GitHub Actions 的 windows-latest 预装 ISCC.exe，
// 所以这个文件由 CI 编译；本机不产出 .exe，避免"看起来做了其实没跑过"。
function writeIss() {
  const dir = path.join(ROOT, "installer");
  fs.mkdirSync(dir, { recursive: true });
  const iss = `; dao3.iss — Windows 安装包（Inno Setup 6）
; 由 .github/workflows/release.yml 在 windows-latest 上用 ISCC.exe 编译。
; 输入是 build-portable.mjs 产出的便携包目录，不在本机伪造。

#define MyAppName "DAO3 编辑器复刻"
#define MyAppVersion "${VERSION}"
#define MyAppPublisher "deepseekv5"
#define MyAppURL "https://deepseekv5.github.io/dao3/"
; Source: 条目是相对**脚本所在目录**（installer\\）解析的，不是仓库根。
; 上一版写 "DAO3-便携包\\*" 于是去找 installer\\DAO3-便携包，报 "No files found"。
#define SrcDir "..\\DAO3-便携包"

[Setup]
AppId={{8E4C2F7A-6B1D-4F3C-9A5E-7D2C1B0A9F65}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
DefaultDirName={autopf}\\DAO3
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputBaseFilename=DAO3-Setup-{#MyAppVersion}
; 显式指定输出目录，否则落在脚本所在目录的 Output\ 下，CI 里靠猜路径搬文件
OutputDir=..\\dist
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
UninstallDisplayIcon={app}\\启动-Windows.bat

[Languages]
; Inno Setup 官方发行包只带少数几种 .isl，简体中文是**非官方翻译**，
; windows-latest 上就没有 ChineseSimplified.isl —— 直接引用会在编译期报
; "Couldn't open include file"。所以先探测，缺了就退回英文消息，
; 应用界面本身仍是简体中文，不受影响。
#define ZhIsl "compiler:Languages\\ChineseSimplified.isl"
#if FileExists(ZhIsl)
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\\ChineseSimplified.isl"
#else
Name: "english"; MessagesFile: "compiler:Default.isl"
#endif

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："

[Files]
; 递归带上整个便携包，recursedirs: 让 server/data 这种运行时才生成的目录也保持结构
Source: "{#SrcDir}\\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\\{#MyAppName}"; Filename: "{app}\\启动-Windows.bat"; WorkingDir: "{app}"; Comment: "启动 DAO3 编辑器（需要 Node 18+）"
Name: "{group}\\{#MyAppName} 说明"; Filename: "{app}\\README.md"; WorkingDir: "{app}"
Name: "{autodesktop}\\{#MyAppName}"; Filename: "{app}\\启动-Windows.bat"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\\启动-Windows.bat"; Description: "立即启动 {#MyAppName}"; WorkingDir: "{app}"; Flags: postinstall nowait skipifsilent unchecked

[UninstallDelete]
; 卸载时连用户自己跑出来的地图一起清掉，不留孤儿目录
Type: filesandordirs; Name: "{app}\\server\\data"
`;
  const file = path.join(dir, "dao3.iss");
  // 这段模板字面量里全是 Windows 反斜杠路径。JS 会把 "\d" 静默吞成 "d"，
  // 于是 OutputDir 变成 ..dist（一个真叫这个名字的目录），Inno 照样"编译成功"，
  // 只是产物落在别处。所以生成完立刻按预期值回读校验。
  const expect = ['OutputDir=..\\dist', '#define SrcDir "..\\DAO3-便携包"', 'Source: "{#SrcDir}\\*"'];
  for (const e of expect) if (!iss.includes(e)) throw new Error("dao3.iss 反斜杠被吞，缺少: " + e);
  // Inno Setup 要求 CRLF，且中文消息文件按 UTF-8 读取
  fs.writeFileSync(file, iss.replace(/\n/g, "\r\n"), "utf8");
  return { file: path.relative(ROOT, file), bytes: fs.statSync(file).size };
}

const results = { version: VERSION, source: PKG, out: OUT_DIR };
results.dmg = buildDmg();
results.innoSetup = writeIss();
console.log(JSON.stringify(results, null, 1));
