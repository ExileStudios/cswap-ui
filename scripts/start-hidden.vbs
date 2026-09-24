' Windows: double-click to launch cswap UI without a console window.
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
CreateObject("WScript.Shell").Run "node """ & root & "\scripts\start.js""", 0, False
