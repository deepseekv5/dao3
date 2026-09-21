; dao3.iss — Windows 安装包（Inno Setup 6）
; 由 .github/workflows/release.yml 在 windows-latest 上用 ISCC.exe 编译。
; 输入是 build-portable.mjs 产出的便携包目录，不在本机伪造。

#define MyAppName "DAO3 编辑器复刻"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "deepseekv5"
#define MyAppURL "https://deepseekv5.github.io/dao3/"
#define SrcDir "DAO3-便携包"

[Setup]
AppId={{8E4C2F7A-6B1D-4F3C-9A5E-7D2C1B0A9F65}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
DefaultDirName={autopf}\DAO3
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputBaseFilename=DAO3-Setup-{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
UninstallDisplayIcon={app}\启动-Windows.bat

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："

[Files]
; 递归带上整个便携包，recursedirs: 让 server/data 这种运行时才生成的目录也保持结构
Source: "{#SrcDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\启动-Windows.bat"; WorkingDir: "{app}"; Comment: "启动 DAO3 编辑器（需要 Node 18+）"
Name: "{group}\{#MyAppName} 说明"; Filename: "{app}\README.md"; WorkingDir: "{app}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\启动-Windows.bat"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\启动-Windows.bat"; Description: "立即启动 {#MyAppName}"; WorkingDir: "{app}"; Flags: postinstall nowait skipifsilent unchecked

[UninstallDelete]
; 卸载时连用户自己跑出来的地图一起清掉，不留孤儿目录
Type: filesandordirs; Name: "{app}\server\data"
