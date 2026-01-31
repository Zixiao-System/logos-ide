; Inno Setup script for Logos IDE (Windows)
; Build the app first with: npm run build (on Windows)
; Expected output: release\win-unpacked\Logos.exe

#define AppName "Logos"
#define PackageJsonFile "..\..\package.json"
#define PackageJson LoadStringFromFile(PackageJsonFile)
#define VersionKey "\"version\""
#define VersionKeyPos Pos(VersionKey, PackageJson)
#if VersionKeyPos == 0
  #error "Unable to locate version in package.json"
#endif
#define VersionSlice Copy(PackageJson, VersionKeyPos, 256)
#define ColonPos Pos(":", VersionSlice)
#if ColonPos == 0
  #error "Unable to parse version from package.json (missing colon)"
#endif
#define AfterColon Copy(VersionSlice, ColonPos + 1, 256)
#define QuoteStart Pos("\"", AfterColon)
#if QuoteStart == 0
  #error "Unable to parse version from package.json (missing opening quote)"
#endif
#define AfterQuoteStart Copy(AfterColon, QuoteStart + 1, 256)
#define QuoteEnd Pos("\"", AfterQuoteStart)
#if QuoteEnd == 0
  #error "Unable to parse version from package.json (missing closing quote)"
#endif
#define AppVersion Trim(Copy(AfterQuoteStart, 1, QuoteEnd - 1))
#define AppPublisher "Zixiao Labs"
#define AppId "io.zixiao.logos"
#define AppURL "https://github.com/zixiao-labs/logos"
#define AppExeName "Logos.exe"
#define AppSource "..\..\release\win-unpacked"
#define AppIcon "..\..\build\icon.ico"
#define AppLicense "..\..\LICENSE"
#define AppOutputDir "..\..\release\inno"
#define AssocExt ".logos"
#define AssocKey "LogosFile"
#define AssocDescription "Logos File"

[Setup]
AppId={{#AppId}}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
AppUpdatesURL={#AppURL}
DefaultDirName={autopf}\{#AppName}
DisableProgramGroupPage=yes
LicenseFile={#AppLicense}
OutputBaseFilename={#AppName}-Setup-{#AppVersion}
OutputDir={#AppOutputDir}
SetupIconFile={#AppIcon}
UninstallDisplayIcon={app}\{#AppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ChangesAssociations=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "chinesetraditional"; MessagesFile: "compiler:Languages\ChineseTraditional.isl"
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"
Name: "german"; MessagesFile: "compiler:Languages\German.isl"
Name: "french"; MessagesFile: "compiler:Languages\French.isl"
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[CustomMessages]
english.DesktopIconTask=Create a &desktop icon
english.QuickLaunchIconTask=Create a &Quick Launch icon
english.AdditionalIcons=Additional icons
english.FileAssocTask=Associate {#AssocExt} files with {#AppName}
english.FileAssocGroup=File associations

chinesesimplified.DesktopIconTask=创建桌面图标(&D)
chinesesimplified.QuickLaunchIconTask=创建快速启动图标(&Q)
chinesesimplified.AdditionalIcons=附加图标
chinesesimplified.FileAssocTask=将 {#AssocExt} 文件关联到 {#AppName}
chinesesimplified.FileAssocGroup=文件关联

chinesetraditional.DesktopIconTask=建立桌面圖示(&D)
chinesetraditional.QuickLaunchIconTask=建立快速啟動圖示(&Q)
chinesetraditional.AdditionalIcons=附加圖示
chinesetraditional.FileAssocTask=將 {#AssocExt} 檔案關聯至 {#AppName}
chinesetraditional.FileAssocGroup=檔案關聯

japanese.DesktopIconTask=デスクトップ アイコンを作成(&D)
japanese.QuickLaunchIconTask=クイック起動アイコンを作成(&Q)
japanese.AdditionalIcons=追加のアイコン
japanese.FileAssocTask={#AssocExt} ファイルを {#AppName} に関連付ける
japanese.FileAssocGroup=ファイル関連付け

german.DesktopIconTask=Desktop-Symbol erstellen(&D)
german.QuickLaunchIconTask=Schnellstart-Symbol erstellen(&Q)
german.AdditionalIcons=Zusätzliche Symbole
german.FileAssocTask={#AssocExt}-Dateien mit {#AppName} verknüpfen
german.FileAssocGroup=Dateizuordnungen

french.DesktopIconTask=Créer une icône sur le bureau(&D)
french.QuickLaunchIconTask=Créer une icône de lancement rapide(&Q)
french.AdditionalIcons=Icônes supplémentaires
french.FileAssocTask=Associer les fichiers {#AssocExt} à {#AppName}
french.FileAssocGroup=Associations de fichiers

spanish.DesktopIconTask=Crear un icono en el escritorio(&D)
spanish.QuickLaunchIconTask=Crear un icono de inicio rápido(&Q)
spanish.AdditionalIcons=Iconos adicionales
spanish.FileAssocTask=Asociar archivos {#AssocExt} con {#AppName}
spanish.FileAssocGroup=Asociaciones de archivos

russian.DesktopIconTask=Создать значок на рабочем столе(&D)
russian.QuickLaunchIconTask=Создать значок быстрого запуска(&Q)
russian.AdditionalIcons=Дополнительные значки
russian.FileAssocTask=Связать файлы {#AssocExt} с {#AppName}
russian.FileAssocGroup=Связи файлов

[Tasks]
Name: "desktopicon"; Description: "{cm:DesktopIconTask}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "quicklaunchicon"; Description: "{cm:QuickLaunchIconTask}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "fileassoc"; Description: "{cm:FileAssocTask}"; GroupDescription: "{cm:FileAssocGroup}"; Flags: unchecked

[Files]
Source: "{#AppSource}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon
Name: "{userappdata}\Microsoft\Internet Explorer\Quick Launch\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: quicklaunchicon

[Registry]
Root: HKA; Subkey: "Software\Classes\{#AssocExt}"; ValueType: string; ValueData: "{#AssocKey}"; Flags: uninsdeletevalue; Tasks: fileassoc
Root: HKA; Subkey: "Software\Classes\{#AssocExt}\OpenWithProgids"; ValueType: string; ValueName: "{#AssocKey}"; ValueData: ""; Flags: uninsdeletevalue; Tasks: fileassoc
Root: HKA; Subkey: "Software\Classes\{#AssocKey}"; ValueType: string; ValueData: "{#AssocDescription}"; Flags: uninsdeletekey; Tasks: fileassoc
Root: HKA; Subkey: "Software\Classes\{#AssocKey}\DefaultIcon"; ValueType: string; ValueData: "{app}\{#AppExeName},0"; Tasks: fileassoc
Root: HKA; Subkey: "Software\Classes\{#AssocKey}\shell\open\command"; ValueType: string; ValueData: """{app}\{#AppExeName}"" ""%1"""; Tasks: fileassoc
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExeName}\SupportedTypes"; ValueType: string; ValueName: "{#AssocExt}"; ValueData: ""; Flags: uninsdeletevalue; Tasks: fileassoc
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExeName}\shell\open\command"; ValueType: string; ValueData: """{app}\{#AppExeName}"" ""%1"""; Flags: uninsdeletekey; Tasks: fileassoc

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent
