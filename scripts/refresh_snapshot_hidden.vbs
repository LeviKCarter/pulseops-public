Option Explicit
Dim sh, fso, base, logDir, logPath, py, script, cmd, rc
Const MAX_LOG_BYTES = 5242880
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
logDir = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\LeviAgent\logs"
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)
logPath = logDir & "\leviops-snapshot-refresh.log"

' Size-capped rotation: keep one previous log (.1). A failure here must never block the refresh.
On Error Resume Next
If fso.FileExists(logPath) Then
    If fso.GetFile(logPath).Size > MAX_LOG_BYTES Then
        If fso.FileExists(logPath & ".1") Then fso.DeleteFile logPath & ".1", True
        fso.MoveFile logPath, logPath & ".1"
    End If
End If
Err.Clear
On Error GoTo 0

py = "C:\Users\YOU\miniforge3\python.exe"
script = base & "\refresh_snapshot.py"
cmd = "cmd.exe /d /s /c " & Chr(34) & Chr(34) & py & Chr(34) & " " & Chr(34) & script & Chr(34) & " >> " & Chr(34) & logPath & Chr(34) & " 2>&1" & Chr(34)
rc = sh.Run(cmd, 0, True)
WScript.Quit rc
