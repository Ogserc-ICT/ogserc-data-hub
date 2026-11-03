'=====================================================================
' OGSERC Feeder and Plant ID Register - automation
' Issues and controls the Commission's identifiers:
'   Feeder ID  OGF-<kV>-<serial>   e.g. OGF-33-0001, OGF-11-0002
'   Plant ID   GP-<serial>         e.g. GP-001
'   Unit ID    <Plant ID>-U<nn>    e.g. GP-001-U01
' Version 1, November 2026
'=====================================================================
Option Explicit

Private Const FIRST_ROW As Long = 6
Private Const FEEDER_LAST As Long = 5005
Private Const PLANT_LAST As Long = 1005
Private Const UNIT_LAST As Long = 3005
Private Const INTAKE_LAST As Long = 1005
Private Const LOG_LAST As Long = 50005

Private Const SH_PANEL As String = "Control panel"
Private Const SH_STD As String = "ID standard"
Private Const SH_FEED As String = "Feeder register"
Private Const SH_PLANT As String = "Plant register"
Private Const SH_UNIT As String = "Unit register"
Private Const SH_FIN As String = "Feeder intake"
Private Const SH_PIN As String = "Plant intake"
Private Const SH_CHK As String = "Checks"
Private Const SH_LOG As String = "ID log"
Private Const SH_SET As String = "Settings"

' Feeder register columns
Private Const F_ID As Long = 1
Private Const F_NAME As Long = 2
Private Const F_LIC As Long = 3
Private Const F_BU As Long = 4
Private Const F_KV As Long = 5
Private Const F_LEVEL As Long = 6
Private Const F_PARENT As Long = 7
Private Const F_SUB As Long = 9
Private Const F_BAND As Long = 10
Private Const F_SEG As Long = 11
Private Const F_LGA As Long = 12
Private Const F_STATUS As Long = 13
Private Const F_ISSUED As Long = 14
Private Const F_EFF As Long = 15
Private Const F_SUPER As Long = 16
Private Const F_ALIAS As Long = 17
Private Const F_REM As Long = 18

' Plant register columns
Private Const P_ID As Long = 1
Private Const P_NAME As Long = 2
Private Const P_OWNER As Long = 3
Private Const P_LIC As Long = 4
Private Const P_LOC As Long = 5
Private Const P_LGA As Long = 6
Private Const P_CONN As Long = 7
Private Const P_FUEL As Long = 8
Private Const P_TECH As Long = 9
Private Const P_MW As Long = 10
Private Const P_STATUS As Long = 12
Private Const P_ISSUED As Long = 13
Private Const P_ALIAS As Long = 14
Private Const P_REM As Long = 15

' Unit register columns
Private Const U_ID As Long = 1
Private Const U_PLANT As Long = 2
Private Const U_NAME As Long = 4
Private Const U_MW As Long = 5
Private Const U_TECH As Long = 6
Private Const U_STATUS As Long = 7
Private Const U_ISSUED As Long = 8
Private Const U_REM As Long = 9

Public gQuiet As Boolean

' Suppresses message boxes (used for automated testing)
Public Sub SetQuietMode(ByVal onOff As Boolean)
    gQuiet = onOff
End Sub

'---------------------------------------------------------------------
' Navigation
'---------------------------------------------------------------------
Private Sub ShowSheet(ByVal sName As String)
    ThisWorkbook.Worksheets(sName).Activate
    ActiveWindow.ScrollRow = 1
    ThisWorkbook.Worksheets(sName).Range("A1").Select
End Sub

Public Sub ShowControlPanel()
    ShowSheet SH_PANEL
End Sub
Public Sub ShowStandard()
    ShowSheet SH_STD
End Sub
Public Sub ShowFeeders()
    ShowSheet SH_FEED
End Sub
Public Sub ShowPlants()
    ShowSheet SH_PLANT
End Sub
Public Sub ShowUnits()
    ShowSheet SH_UNIT
End Sub
Public Sub ShowFeederIntake()
    ShowSheet SH_FIN
End Sub
Public Sub ShowPlantIntake()
    ShowSheet SH_PIN
End Sub
Public Sub ShowChecks()
    ShowSheet SH_CHK
End Sub
Public Sub ShowLog()
    ShowSheet SH_LOG
End Sub
Public Sub ShowSettings()
    ShowSheet SH_SET
End Sub

Private Sub EnsureReady()
    ProtectAll
End Sub

Public Sub ProtectAll()
    Dim nm As Variant
    On Error Resume Next
    For Each nm In Array(SH_FEED, SH_PLANT, SH_UNIT, SH_LOG, SH_CHK)
        ThisWorkbook.Worksheets(nm).Protect Password:="", UserInterfaceOnly:=True, _
            AllowFiltering:=True, AllowSorting:=True, AllowFormattingColumns:=True
    Next nm
    On Error GoTo 0
End Sub

'---------------------------------------------------------------------
' Helpers
'---------------------------------------------------------------------
Private Sub Notify(ByVal msg As String, Optional ByVal style As Long = 64)
    If Not gQuiet Then MsgBox msg, style, "OGSERC ID Register"
End Sub

Private Function SetVal(ByVal nm As String) As String
    SetVal = CStr(ThisWorkbook.Names(nm).RefersToRange.Value)
End Function

Public Function LooseKey(ByVal s As String) As String
    Dim i As Long, ch As String, out As String
    s = UCase$(s)
    s = Replace(s, "FEEDER", "")
    For i = 1 To Len(s)
        ch = Mid$(s, i, 1)
        If (ch >= "A" And ch <= "Z") Or (ch >= "0" And ch <= "9") Then out = out & ch
    Next i
    LooseKey = out
End Function

Private Function LastUsedRow(ByVal ws As Worksheet, ByVal col As Long, ByVal lastRow As Long) As Long
    Dim r As Long
    r = ws.Cells(lastRow + 1, col).End(xlUp).Row
    If r < FIRST_ROW Then r = FIRST_ROW - 1
    LastUsedRow = r
End Function

Private Function NextEmptyRow(ByVal ws As Worksheet, ByVal col As Long, ByVal lastRow As Long) As Long
    Dim r As Long
    r = LastUsedRow(ws, col, lastRow) + 1
    If r > lastRow Then r = 0
    NextEmptyRow = r
End Function

Private Function FindRowById(ByVal ws As Worksheet, ByVal id As String, ByVal lastRow As Long) As Long
    Dim r As Long, n As Long
    n = LastUsedRow(ws, 1, lastRow)
    For r = FIRST_ROW To n
        If StrComp(Trim$(CStr(ws.Cells(r, 1).Value)), Trim$(id), vbTextCompare) = 0 Then
            FindRowById = r
            Exit Function
        End If
    Next r
End Function

Private Function SerialOf(ByVal id As String) As Long
    Dim p As Long, tail As String
    p = InStrRev(id, "-")
    If p = 0 Then Exit Function
    tail = Mid$(id, p + 1)
    If IsNumeric(tail) Then SerialOf = CLng(tail)
End Function

Private Function MaxSerial(ByVal ws As Worksheet, ByVal lastRow As Long) As Long
    Dim r As Long, n As Long, s As Long, m As Long
    n = LastUsedRow(ws, 1, lastRow)
    For r = FIRST_ROW To n
        s = SerialOf(CStr(ws.Cells(r, 1).Value))
        If s > m Then m = s
    Next r
    MaxSerial = m
End Function

Public Function NextFeederId(ByVal kv As String) As String
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Worksheets(SH_FEED)
    NextFeederId = SetVal("cfg_FeederPrefix") & "-" & kv & "-" & _
        Format$(MaxSerial(ws, FEEDER_LAST) + 1, String$(CLng(SetVal("cfg_FeederDigits")), "0"))
End Function

Public Function NextPlantId() As String
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Worksheets(SH_PLANT)
    NextPlantId = SetVal("cfg_PlantPrefix") & "-" & _
        Format$(MaxSerial(ws, PLANT_LAST) + 1, String$(CLng(SetVal("cfg_PlantDigits")), "0"))
End Function

Private Function NextUnitId(ByVal plantId As String) As String
    Dim ws As Worksheet, r As Long, n As Long, s As Long, m As Long, pre As String
    Set ws = ThisWorkbook.Worksheets(SH_UNIT)
    pre = plantId & "-" & SetVal("cfg_UnitPrefix")
    n = LastUsedRow(ws, 1, UNIT_LAST)
    For r = FIRST_ROW To n
        If Left$(CStr(ws.Cells(r, 1).Value), Len(pre)) = pre Then
            s = Val(Mid$(CStr(ws.Cells(r, 1).Value), Len(pre) + 1))
            If s > m Then m = s
        End If
    Next r
    NextUnitId = pre & Format$(m + 1, "00")
End Function

Private Function IsLicensee(ByVal code As String) As Boolean
    Dim c As Range
    For Each c In ThisWorkbook.Names("lst_Licensees").RefersToRange.Cells
        If StrComp(Trim$(CStr(c.Value)), Trim$(code), vbTextCompare) = 0 And Trim$(code) <> "" Then
            IsLicensee = True
            Exit Function
        End If
    Next c
End Function

Private Function LicenseeChoice(ByVal title As String) As String
    Dim c As Range, msg As String, i As Long, v As String, codes() As String
    ReDim codes(1 To 50)
    For Each c In ThisWorkbook.Names("lst_Licensees").RefersToRange.Cells
        If Trim$(CStr(c.Value)) <> "" Then
            i = i + 1
            codes(i) = Trim$(CStr(c.Value))
            msg = msg & i & "  " & codes(i) & "  " & c.Offset(0, 1).Value & vbCrLf
        End If
    Next c
    v = Trim$(InputBox("Licensee (number or code):" & vbCrLf & msg, title))
    If v = "" Then Exit Function
    If IsNumeric(v) Then
        If CLng(v) >= 1 And CLng(v) <= i Then LicenseeChoice = codes(CLng(v))
    ElseIf IsLicensee(v) Then
        LicenseeChoice = UCase$(v)
    End If
    If LicenseeChoice = "" Then Notify "'" & v & "' is not on the licensee list in Settings.", vbExclamation
End Function

Private Function CurrentUser() As String
    Dim u As String
    On Error Resume Next
    u = Application.UserName
    If u = "" Then u = Environ("USERNAME")
    If u = "" Then u = Environ("USER")
    On Error GoTo 0
    If u = "" Then u = "Unknown"
    CurrentUser = u
End Function

Private Sub WriteLog(ByVal action As String, ByVal id As String, ByVal detail As String)
    Dim ws As Worksheet, r As Long
    Set ws = ThisWorkbook.Worksheets(SH_LOG)
    r = NextEmptyRow(ws, 1, LOG_LAST)
    If r = 0 Then Exit Sub
    ws.Cells(r, 1).Value = Now
    ws.Cells(r, 2).Value = CurrentUser()
    ws.Cells(r, 3).Value = action
    ws.Cells(r, 4).Value = id
    ws.Cells(r, 5).Value = detail
End Sub

' Returns the register row of a feeder of this licensee whose name or alias matches, else 0
Private Function MatchFeeder(ByVal lic As String, ByVal fName As String, ByVal ownId As String) As Long
    Dim ws As Worksheet, r As Long, n As Long, k As String, a As Variant, al As String
    Set ws = ThisWorkbook.Worksheets(SH_FEED)
    n = LastUsedRow(ws, 1, FEEDER_LAST)
    k = LooseKey(fName)
    For r = FIRST_ROW To n
        If StrComp(CStr(ws.Cells(r, F_LIC).Value), lic, vbTextCompare) = 0 Then
            al = CStr(ws.Cells(r, F_ALIAS).Value)
            If ownId <> "" Then
                For Each a In Split(al, ";")
                    If StrComp(Trim$(CStr(a)), ownId, vbTextCompare) = 0 Then MatchFeeder = r: Exit Function
                Next a
                If StrComp(CStr(ws.Cells(r, F_ID).Value), ownId, vbTextCompare) = 0 Then MatchFeeder = r: Exit Function
            End If
            If k <> "" Then
                If LooseKey(CStr(ws.Cells(r, F_NAME).Value)) = k Then MatchFeeder = r: Exit Function
                For Each a In Split(al, ";")
                    If LooseKey(CStr(a)) = k Then MatchFeeder = r: Exit Function
                Next a
            End If
        End If
    Next r
End Function

' Resolve a parent given as Feeder ID, licensee's own ID or name; returns the Feeder ID or ""
Private Function ResolveParent(ByVal lic As String, ByVal p As String) As String
    Dim ws As Worksheet, r As Long
    p = Trim$(p)
    If p = "" Then Exit Function
    Set ws = ThisWorkbook.Worksheets(SH_FEED)
    r = FindRowById(ws, p, FEEDER_LAST)
    If r = 0 Then r = MatchFeeder(lic, p, p)
    If r > 0 Then ResolveParent = CStr(ws.Cells(r, F_ID).Value)
End Function

Private Function NormKv(ByVal v As String) As String
    v = Replace(Replace(UCase$(Trim$(v)), "KV", ""), " ", "")
    If v = "33" Or v = "11" Then NormKv = v
End Function

Private Function AddAlias(ByVal existing As String, ByVal newAlias As String) As String
    Dim a As Variant
    newAlias = Trim$(newAlias)
    AddAlias = existing
    If newAlias = "" Then Exit Function
    For Each a In Split(existing, ";")
        If StrComp(Trim$(CStr(a)), newAlias, vbTextCompare) = 0 Then Exit Function
    Next a
    If Trim$(existing) = "" Then
        AddAlias = newAlias
    Else
        AddAlias = existing & "; " & newAlias
    End If
End Function

' Writes a new feeder to the register and returns the issued ID
Private Function IssueFeeder(ByVal lic As String, ByVal fName As String, ByVal bu As String, ByVal kv As String, _
        ByVal level As String, ByVal parentId As String, ByVal band As String, ByVal lga As String, _
        ByVal subst As String, ByVal ownId As String, ByVal source As String) As String
    Dim ws As Worksheet, r As Long, id As String
    Set ws = ThisWorkbook.Worksheets(SH_FEED)
    r = NextEmptyRow(ws, 1, FEEDER_LAST)
    If r = 0 Then Exit Function
    id = NextFeederId(kv)
    ws.Cells(r, F_ID).Value = id
    ws.Cells(r, F_NAME).Value = fName
    ws.Cells(r, F_LIC).Value = UCase$(lic)
    ws.Cells(r, F_BU).Value = bu
    ws.Cells(r, F_KV).Value = CLng(kv)
    ws.Cells(r, F_LEVEL).Value = level
    ws.Cells(r, F_PARENT).Value = parentId
    ws.Cells(r, F_SUB).Value = subst
    ws.Cells(r, F_BAND).Value = UCase$(band)
    ws.Cells(r, F_LGA).Value = lga
    ws.Cells(r, F_STATUS).Value = "Active"
    ws.Cells(r, F_ISSUED).Value = Date
    ws.Cells(r, F_EFF).Value = Date
    ws.Cells(r, F_ALIAS).Value = ownId
    WriteLog "Feeder ID issued", id, fName & " (" & lic & ", " & kv & " kV) - " & source
    IssueFeeder = id
End Function

'---------------------------------------------------------------------
' Register a single feeder
'---------------------------------------------------------------------
Public Sub NewFeeder()
    Dim lic As String, fName As String, kv As String, level As String, parent As String, pid As String
    Dim bu As String, band As String, ownId As String, lga As String, r As Long, id As String
    Dim ws As Worksheet

    EnsureReady
    Set ws = ThisWorkbook.Worksheets(SH_FEED)
    If NextEmptyRow(ws, 1, FEEDER_LAST) = 0 Then Notify "The feeder register is full.", vbExclamation: Exit Sub

    lic = LicenseeChoice("Register feeder")
    If lic = "" Then Exit Sub
    fName = Trim$(InputBox("Feeder name, as the licensee calls it:", "Register feeder - " & lic))
    If fName = "" Then Exit Sub
    ownId = Trim$(InputBox("The licensee's own ID or code for this feeder (optional):", "Register feeder - " & lic))

    r = MatchFeeder(lic, fName, ownId)
    If r > 0 Then
        If MsgBox(lic & " already has '" & ws.Cells(r, F_NAME).Value & "' registered as " & ws.Cells(r, F_ID).Value & "." & vbCrLf & _
                  "Issue a new ID anyway? Choose No to use the existing ID.", vbYesNo + vbQuestion, "OGSERC ID Register") <> vbYes Then
            ws.Activate: ws.Cells(r, 1).Select
            Exit Sub
        End If
    End If

    kv = NormKv(InputBox("Voltage (33 or 11):", "Register feeder - " & lic, "11"))
    If kv = "" Then Notify "Voltage must be 33 or 11.", vbExclamation: Exit Sub
    If kv = "33" Then
        level = IIf(MsgBox("Is this a 33 kV injection feeder (supplied directly from a transmission substation)?" & vbCrLf & _
                           "Choose No if it is fed through another 33 kV feeder.", vbYesNo + vbQuestion, "OGSERC ID Register") = vbYes, "Injection", "Fed")
    Else
        level = "Fed"
    End If
    If level = "Fed" Then
        parent = Trim$(InputBox("Parent 33 kV feeder - its Feeder ID, the licensee's ID or its name:", "Register feeder - " & lic))
        pid = ResolveParent(lic, parent)
        If pid = "" And parent <> "" Then
            If MsgBox("'" & parent & "' is not in the register. Register the parent first, or continue without a parent?", _
                      vbOKCancel + vbExclamation, "OGSERC ID Register") <> vbOK Then Exit Sub
        End If
    End If
    bu = Trim$(InputBox("Business unit (e.g. Ota, Sagamu):", "Register feeder - " & lic))
    band = UCase$(Trim$(InputBox("Approved SBT band (A to E), if known:", "Register feeder - " & lic)))
    If band <> "" And (Len(band) <> 1 Or InStr(1, "ABCDE", band) = 0) Then Notify "Band must be A, B, C, D or E.", vbExclamation: Exit Sub
    lga = Trim$(InputBox("LGA, if known:", "Register feeder - " & lic))

    id = IssueFeeder(lic, fName, bu, kv, level, pid, band, lga, "", ownId, "registered individually")
    r = FindRowById(ws, id, FEEDER_LAST)
    ws.Activate: ws.Cells(r, 1).Select
    Notify "Issued " & id & " to " & fName & " (" & lic & ")."
End Sub

'---------------------------------------------------------------------
' Register a single plant
'---------------------------------------------------------------------
Public Sub NewPlant()
    Dim ws As Worksheet, r As Long, n As Long, pName As String, loc As String, id As String, v As String

    EnsureReady
    Set ws = ThisWorkbook.Worksheets(SH_PLANT)
    r = NextEmptyRow(ws, 1, PLANT_LAST)
    If r = 0 Then Notify "The plant register is full.", vbExclamation: Exit Sub

    pName = Trim$(InputBox("Plant name:", "Register plant"))
    If pName = "" Then Exit Sub
    loc = Trim$(InputBox("Site address or location:", "Register plant"))

    n = MatchPlant(pName, loc, "")
    If n > 0 Then
        If MsgBox("'" & ws.Cells(n, P_NAME).Value & "' at this site is already registered as " & ws.Cells(n, P_ID).Value & "." & vbCrLf & _
                  "Issue a new ID anyway?", vbYesNo + vbQuestion, "OGSERC ID Register") <> vbYes Then
            ws.Activate: ws.Cells(n, 1).Select
            Exit Sub
        End If
    End If

    id = NextPlantId()
    ws.Cells(r, P_ID).Value = id
    ws.Cells(r, P_NAME).Value = pName
    ws.Cells(r, P_LOC).Value = loc
    ws.Cells(r, P_OWNER).Value = Trim$(InputBox("Owner / operator:", "Register plant " & id))
    ws.Cells(r, P_LGA).Value = Trim$(InputBox("LGA, if known:", "Register plant " & id))
    v = InputBox("Connection:" & vbCrLf & "1 Grid (TCN)" & vbCrLf & "2 IPP" & vbCrLf & "3 Embedded" & vbCrLf & _
                 "4 Captive" & vbCrLf & "5 Off-grid" & vbCrLf & "6 Mini-grid", "Register plant " & id, "4")
    Select Case Trim$(v)
        Case "1": ws.Cells(r, P_CONN).Value = "Grid (TCN)"
        Case "2": ws.Cells(r, P_CONN).Value = "IPP"
        Case "3": ws.Cells(r, P_CONN).Value = "Embedded"
        Case "4": ws.Cells(r, P_CONN).Value = "Captive"
        Case "5": ws.Cells(r, P_CONN).Value = "Off-Grid"
        Case "6": ws.Cells(r, P_CONN).Value = "Mini-grid"
    End Select
    ws.Cells(r, P_FUEL).Value = Trim$(InputBox("Fuel (e.g. Gas, Solar, Diesel):", "Register plant " & id, "Gas"))
    v = Trim$(InputBox("Installed capacity (MW):", "Register plant " & id))
    If IsNumeric(v) And v <> "" Then ws.Cells(r, P_MW).Value = CDbl(v)
    ws.Cells(r, P_STATUS).Value = "Operating"
    ws.Cells(r, P_ISSUED).Value = Date
    WriteLog "Plant ID issued", id, pName & " - registered individually"
    ws.Activate: ws.Cells(r, 1).Select
    Notify "Issued " & id & " to " & pName & "." & vbCrLf & "Use 'Issue unit IDs' to number its generating units."
End Sub

Private Function MatchPlant(ByVal pName As String, ByVal loc As String, ByVal otherId As String) As Long
    Dim ws As Worksheet, r As Long, n As Long, k As String, lk As String, a As Variant
    Set ws = ThisWorkbook.Worksheets(SH_PLANT)
    n = LastUsedRow(ws, 1, PLANT_LAST)
    k = LooseKey(pName): lk = LooseKey(loc)
    For r = FIRST_ROW To n
        If otherId <> "" Then
            If StrComp(CStr(ws.Cells(r, P_ID).Value), otherId, vbTextCompare) = 0 Then MatchPlant = r: Exit Function
            For Each a In Split(CStr(ws.Cells(r, P_ALIAS).Value), ";")
                If StrComp(Trim$(CStr(a)), otherId, vbTextCompare) = 0 Then MatchPlant = r: Exit Function
            Next a
        End If
        If k <> "" And LooseKey(CStr(ws.Cells(r, P_NAME).Value)) = k Then
            If lk = "" Or LooseKey(CStr(ws.Cells(r, P_LOC).Value)) = lk Or LooseKey(CStr(ws.Cells(r, P_LOC).Value)) = "" Then
                MatchPlant = r: Exit Function
            End If
        End If
    Next r
End Function

Private Function PlantNameMatchElsewhere(ByVal pName As String) As String
    Dim ws As Worksheet, r As Long, n As Long, k As String, out As String
    Set ws = ThisWorkbook.Worksheets(SH_PLANT)
    n = LastUsedRow(ws, 1, PLANT_LAST)
    k = LooseKey(pName)
    For r = FIRST_ROW To n
        If LooseKey(CStr(ws.Cells(r, P_NAME).Value)) = k Then
            If out <> "" Then out = out & ", "
            out = out & ws.Cells(r, P_ID).Value
        End If
    Next r
    PlantNameMatchElsewhere = out
End Function

'---------------------------------------------------------------------
' Issue unit IDs for a plant
'---------------------------------------------------------------------
Public Sub NewUnits()
    Dim wsP As Worksheet, wsU As Worksheet, pid As String, pr As Long, n As String, mw As String, i As Long, r As Long
    Dim id As String, first As String

    EnsureReady
    Set wsP = ThisWorkbook.Worksheets(SH_PLANT)
    Set wsU = ThisWorkbook.Worksheets(SH_UNIT)
    pid = UCase$(Trim$(InputBox("Plant ID (e.g. GP-001):", "Issue unit IDs")))
    If pid = "" Then Exit Sub
    pr = FindRowById(wsP, pid, PLANT_LAST)
    If pr = 0 Then Notify pid & " is not in the plant register.", vbExclamation: Exit Sub
    n = Trim$(InputBox("How many generating units to number for " & wsP.Cells(pr, P_NAME).Value & "?", "Issue unit IDs", "1"))
    If Not IsNumeric(n) Or n = "" Then Exit Sub
    If CLng(n) < 1 Or CLng(n) > 50 Then Notify "Enter between 1 and 50 units.", vbExclamation: Exit Sub
    mw = Trim$(InputBox("Installed capacity of each unit (MW), if they are identical. Leave blank otherwise:", "Issue unit IDs"))

    For i = 1 To CLng(n)
        r = NextEmptyRow(wsU, 1, UNIT_LAST)
        If r = 0 Then Notify "The unit register is full.", vbExclamation: Exit For
        id = NextUnitId(pid)
        If first = "" Then first = id
        wsU.Cells(r, U_ID).Value = id
        wsU.Cells(r, U_PLANT).Value = pid
        If IsNumeric(mw) And mw <> "" Then wsU.Cells(r, U_MW).Value = CDbl(mw)
        wsU.Cells(r, U_TECH).Value = wsP.Cells(pr, P_TECH).Value
        wsU.Cells(r, U_STATUS).Value = "Operating"
        wsU.Cells(r, U_ISSUED).Value = Date
        WriteLog "Unit ID issued", id, "Unit of " & pid & " " & wsP.Cells(pr, P_NAME).Value
    Next i
    wsU.Activate
    Notify "Issued " & n & " unit ID(s) for " & pid & ", starting at " & first & "." & vbCrLf & _
           "Add each unit's name or the GenCo's own unit code in column D."
End Sub

'---------------------------------------------------------------------
' Bulk: feeders submitted by a licensee
'---------------------------------------------------------------------
Public Sub AssignFeederIntake()
    Dim ws As Worksheet, reg As Worksheet, r As Long, n As Long, pass As Long
    Dim lic As String, fName As String, ownId As String, kv As String, level As String, parent As String, pid As String
    Dim m As Long, id As String, note As String
    Dim nMatched As Long, nNew As Long, nReview As Long

    EnsureReady
    Set ws = ThisWorkbook.Worksheets(SH_FIN)
    Set reg = ThisWorkbook.Worksheets(SH_FEED)
    n = LastUsedRow(ws, 2, INTAKE_LAST)
    If n < FIRST_ROW Then Notify "The Feeder intake sheet is empty. Paste the licensee's feeder list into columns A to J first.", vbExclamation: Exit Sub
    Application.ScreenUpdating = False

    ' pass 1: 33 kV feeders (so 11 kV children in the same list find their parents); pass 2: the rest
    For pass = 1 To 2
        For r = FIRST_ROW To n
            fName = Trim$(CStr(ws.Cells(r, 2).Value))
            If fName <> "" And Trim$(CStr(ws.Cells(r, 11).Value)) = "" Then
                kv = NormKv(CStr(ws.Cells(r, 5).Value))
                If (pass = 1 And kv = "33") Or (pass = 2 And kv <> "33") Then
                    lic = UCase$(Trim$(CStr(ws.Cells(r, 1).Value)))
                    ownId = Trim$(CStr(ws.Cells(r, 3).Value))
                    note = ""
                    If Not IsLicensee(lic) Then
                        ws.Cells(r, 12).Value = "Needs review"
                        ws.Cells(r, 13).Value = "Licensee code '" & lic & "' is not on the licensee list."
                        nReview = nReview + 1
                    Else
                        m = MatchFeeder(lic, fName, ownId)
                        If m > 0 Then
                            ws.Cells(r, 11).Value = reg.Cells(m, F_ID).Value
                            ws.Cells(r, 12).Value = "Matched existing"
                            If LooseKey(CStr(reg.Cells(m, F_NAME).Value)) <> LooseKey(fName) Then
                                reg.Cells(m, F_ALIAS).Value = AddAlias(CStr(reg.Cells(m, F_ALIAS).Value), fName)
                                note = "Name recorded as an alternative name. "
                            End If
                            If ownId <> "" Then reg.Cells(m, F_ALIAS).Value = AddAlias(CStr(reg.Cells(m, F_ALIAS).Value), ownId)
                            ws.Cells(r, 13).Value = Trim$(note & "Registered as '" & reg.Cells(m, F_NAME).Value & "'.")
                            nMatched = nMatched + 1
                        ElseIf kv = "" Then
                            ws.Cells(r, 12).Value = "Needs review"
                            ws.Cells(r, 13).Value = "Voltage must be 33 or 11."
                            nReview = nReview + 1
                        Else
                            level = Trim$(CStr(ws.Cells(r, 6).Value))
                            parent = Trim$(CStr(ws.Cells(r, 7).Value))
                            If level = "" Then level = IIf(kv = "33" And parent = "", "Injection", "Fed")
                            pid = ResolveParent(lic, parent)
                            If level = "Fed" And pid = "" Then
                                If parent = "" Then
                                    note = "No parent 33 kV feeder given. "
                                Else
                                    note = "Parent '" & parent & "' not found. "
                                End If
                            End If
                            id = IssueFeeder(lic, fName, Trim$(CStr(ws.Cells(r, 4).Value)), kv, level, pid, _
                                Trim$(CStr(ws.Cells(r, 8).Value)), Trim$(CStr(ws.Cells(r, 9).Value)), _
                                Trim$(CStr(ws.Cells(r, 10).Value)), ownId, "feeder intake row " & r)
                            If id = "" Then
                                ws.Cells(r, 12).Value = "Needs review"
                                ws.Cells(r, 13).Value = "The feeder register is full."
                                nReview = nReview + 1
                            Else
                                ws.Cells(r, 11).Value = id
                                ws.Cells(r, 12).Value = "New ID issued"
                                ws.Cells(r, 13).Value = Trim$(note)
                                nNew = nNew + 1
                            End If
                        End If
                    End If
                End If
            End If
        Next r
    Next pass
    Application.ScreenUpdating = True
    Notify "Feeder intake processed." & vbCrLf & vbCrLf & _
           "Matched to existing IDs: " & nMatched & vbCrLf & _
           "New IDs issued: " & nNew & vbCrLf & _
           "Needs review: " & nReview & vbCrLf & vbCrLf & _
           "Rows with a Feeder ID already in column K were skipped."
End Sub

'---------------------------------------------------------------------
' Bulk: plants
'---------------------------------------------------------------------
Public Sub AssignPlantIntake()
    Dim ws As Worksheet, reg As Worksheet, r As Long, n As Long, m As Long, rr As Long
    Dim pName As String, loc As String, otherId As String, id As String, same As String, v As String
    Dim nMatched As Long, nNew As Long, nReview As Long

    EnsureReady
    Set ws = ThisWorkbook.Worksheets(SH_PIN)
    Set reg = ThisWorkbook.Worksheets(SH_PLANT)
    n = LastUsedRow(ws, 1, INTAKE_LAST)
    If n < FIRST_ROW Then Notify "The Plant intake sheet is empty. Paste the plant list into columns A to I first.", vbExclamation: Exit Sub
    Application.ScreenUpdating = False
    For r = FIRST_ROW To n
        pName = Trim$(CStr(ws.Cells(r, 1).Value))
        If pName <> "" And Trim$(CStr(ws.Cells(r, 10).Value)) = "" Then
            loc = Trim$(CStr(ws.Cells(r, 4).Value))
            otherId = Trim$(CStr(ws.Cells(r, 9).Value))
            m = MatchPlant(pName, loc, otherId)
            If m > 0 Then
                ws.Cells(r, 10).Value = reg.Cells(m, P_ID).Value
                ws.Cells(r, 11).Value = "Matched existing"
                ws.Cells(r, 12).Value = "Registered as '" & reg.Cells(m, P_NAME).Value & "'."
                If otherId <> "" Then reg.Cells(m, P_ALIAS).Value = AddAlias(CStr(reg.Cells(m, P_ALIAS).Value), otherId)
                nMatched = nMatched + 1
            Else
                rr = NextEmptyRow(reg, 1, PLANT_LAST)
                If rr = 0 Then
                    ws.Cells(r, 11).Value = "Needs review"
                    ws.Cells(r, 12).Value = "The plant register is full."
                    nReview = nReview + 1
                Else
                    same = PlantNameMatchElsewhere(pName)
                    id = NextPlantId()
                    reg.Cells(rr, P_ID).Value = id
                    reg.Cells(rr, P_NAME).Value = pName
                    reg.Cells(rr, P_OWNER).Value = ws.Cells(r, 2).Value
                    reg.Cells(rr, P_LIC).Value = UCase$(Trim$(CStr(ws.Cells(r, 3).Value)))
                    reg.Cells(rr, P_LOC).Value = loc
                    reg.Cells(rr, P_LGA).Value = ws.Cells(r, 5).Value
                    reg.Cells(rr, P_CONN).Value = ws.Cells(r, 6).Value
                    reg.Cells(rr, P_FUEL).Value = ws.Cells(r, 7).Value
                    v = Trim$(CStr(ws.Cells(r, 8).Value))
                    If IsNumeric(v) And v <> "" Then reg.Cells(rr, P_MW).Value = CDbl(v)
                    reg.Cells(rr, P_STATUS).Value = "Operating"
                    reg.Cells(rr, P_ISSUED).Value = Date
                    reg.Cells(rr, P_ALIAS).Value = otherId
                    WriteLog "Plant ID issued", id, pName & " - plant intake row " & r
                    ws.Cells(r, 10).Value = id
                    ws.Cells(r, 11).Value = "New ID issued"
                    If same <> "" Then ws.Cells(r, 12).Value = "Same name as " & same & " at a different site - confirm it is a separate plant."
                    nNew = nNew + 1
                End If
            End If
        End If
    Next r
    Application.ScreenUpdating = True
    Notify "Plant intake processed." & vbCrLf & vbCrLf & _
           "Matched to existing IDs: " & nMatched & vbCrLf & _
           "New IDs issued: " & nNew & vbCrLf & _
           "Needs review: " & nReview
End Sub

Public Sub ClearProcessedIntake()
    Dim nm As Variant, ws As Worksheet, r As Long, n As Long, idCol As Long, k As Long
    If Not gQuiet Then
        If MsgBox("Remove intake rows that already have an ID (matched or new) from both intake sheets?", _
                  vbYesNo + vbQuestion, "OGSERC ID Register") <> vbYes Then Exit Sub
    End If
    For Each nm In Array(SH_FIN, SH_PIN)
        Set ws = ThisWorkbook.Worksheets(nm)
        If nm = SH_FIN Then
            idCol = 11
        Else
            idCol = 10
        End If
        n = LastUsedRow(ws, IIf(nm = SH_FIN, 2, 1), INTAKE_LAST)
        For r = n To FIRST_ROW Step -1
            If Trim$(CStr(ws.Cells(r, idCol).Value)) <> "" Then
                ws.Range(ws.Cells(r, 1), ws.Cells(r, idCol + 2)).Delete Shift:=xlUp
                k = k + 1
            End If
        Next r
    Next nm
    Notify k & " processed intake row(s) removed."
End Sub

'---------------------------------------------------------------------
' Retire, merge, split or transfer a feeder (IDs are never reused)
'---------------------------------------------------------------------
Public Sub ChangeFeederStatus()
    Dim ws As Worksheet, id As String, r As Long, v As String, st As String, d As String, sup As String, newLic As String
    EnsureReady
    Set ws = ThisWorkbook.Worksheets(SH_FEED)
    id = UCase$(Trim$(InputBox("Feeder ID to change:", "Change feeder status")))
    If id = "" Then Exit Sub
    r = FindRowById(ws, id, FEEDER_LAST)
    If r = 0 Then Notify id & " is not in the register.", vbExclamation: Exit Sub
    v = InputBox(ws.Cells(r, F_NAME).Value & " (" & ws.Cells(r, F_LIC).Value & ") is " & ws.Cells(r, F_STATUS).Value & "." & vbCrLf & vbCrLf & _
                 "New status:" & vbCrLf & "1 Active" & vbCrLf & "2 Decommissioned" & vbCrLf & "3 Merged" & vbCrLf & _
                 "4 Split" & vbCrLf & "5 Transferred to another licensee", "Change feeder status")
    Select Case Trim$(v)
        Case "1": st = "Active"
        Case "2": st = "Decommissioned"
        Case "3": st = "Merged"
        Case "4": st = "Split"
        Case "5": st = "Transferred"
        Case Else: Exit Sub
    End Select
    d = Trim$(InputBox("Effective date (dd/mm/yyyy):", "Change feeder status", Format$(Date, "dd/mm/yyyy")))
    If Not IsDate(d) Then Notify "Enter a valid date.", vbExclamation: Exit Sub
    If st = "Merged" Or st = "Split" Then
        sup = UCase$(Trim$(InputBox("Feeder ID(s) that replace it, separated by ; (register the new feeders first):", "Change feeder status")))
    ElseIf st = "Transferred" Then
        newLic = LicenseeChoice("New licensee")
        If newLic = "" Then Exit Sub
        ws.Cells(r, F_REM).Value = Trim$(ws.Cells(r, F_REM).Value & " Transferred from " & ws.Cells(r, F_LIC).Value & " to " & newLic & " on " & d & ".")
        ws.Cells(r, F_LIC).Value = newLic
        st = "Active"
    End If
    ws.Cells(r, F_STATUS).Value = st
    ws.Cells(r, F_EFF).Value = CDate(d)
    If sup <> "" Then ws.Cells(r, F_SUPER).Value = sup
    If newLic <> "" Then
        WriteLog "Transferred", id, "To " & newLic & " from " & d
    Else
        WriteLog "Status changed", id, st & " from " & d & IIf(sup <> "", "; replaced by " & sup, "")
    End If
    ws.Activate: ws.Cells(r, 1).Select
    Notify id & " updated: " & st & " from " & d & "." & vbCrLf & "The ID stays in the register and will not be reissued."
End Sub

'---------------------------------------------------------------------
' Find a feeder or plant by ID, name or alias
'---------------------------------------------------------------------
Public Sub FindRecord()
    Dim q As String, k As String, ws As Worksheet, r As Long, n As Long, hits As String, cnt As Long
    Dim firstWs As Worksheet, firstRow As Long, nm As Variant, nameCol As Long, aliasCol As Long, lastR As Long
    q = Trim$(InputBox("Search for a Feeder ID, Plant ID, name or the licensee's own ID:", "Find"))
    If q = "" Then Exit Sub
    k = LooseKey(q)
    For Each nm In Array(SH_FEED, SH_PLANT)
        Set ws = ThisWorkbook.Worksheets(nm)
        If nm = SH_FEED Then
            nameCol = F_NAME: aliasCol = F_ALIAS: lastR = FEEDER_LAST
        Else
            nameCol = P_NAME: aliasCol = P_ALIAS: lastR = PLANT_LAST
        End If
        n = LastUsedRow(ws, 1, lastR)
        For r = FIRST_ROW To n
            If InStr(1, LooseKey(ws.Cells(r, 1).Value & " " & ws.Cells(r, nameCol).Value & " " & ws.Cells(r, aliasCol).Value), k, vbTextCompare) > 0 Then
                cnt = cnt + 1
                If cnt <= 15 Then hits = hits & ws.Cells(r, 1).Value & "   " & ws.Cells(r, nameCol).Value & vbCrLf
                If firstRow = 0 Then Set firstWs = ws: firstRow = r
            End If
        Next r
    Next nm
    If cnt = 0 Then Notify "Nothing matches '" & q & "'.", vbExclamation: Exit Sub
    firstWs.Activate: firstWs.Cells(firstRow, 1).Select
    Notify cnt & " match(es) for '" & q & "':" & vbCrLf & vbCrLf & hits & IIf(cnt > 15, "...and " & (cnt - 15) & " more.", "")
End Sub

'---------------------------------------------------------------------
' Register checks
'---------------------------------------------------------------------
Public Sub CheckRegisters()
    Dim out As Worksheet, ws As Worksheet, r As Long, n As Long, o As Long, i As Long
    Dim ids As Collection, keys As Collection, id As String, k As String, p As String, pr As Long, a As Variant
    Dim nIssues As Long

    EnsureReady
    Set out = ThisWorkbook.Worksheets(SH_CHK)
    out.Range(out.Cells(FIRST_ROW, 1), out.Cells(5005, 5)).ClearContents
    o = FIRST_ROW
    Set ids = New Collection
    Set keys = New Collection

    ' Feeders
    Set ws = ThisWorkbook.Worksheets(SH_FEED)
    n = LastUsedRow(ws, 1, FEEDER_LAST)
    For r = FIRST_ROW To n
        id = Trim$(CStr(ws.Cells(r, F_ID).Value))
        If id <> "" Then
            If InCol(ids, UCase$(id)) Then
                AddIssue out, o, "Duplicate Feeder ID", SH_FEED, r, id, "Also on row " & ids(UCase$(id))
            Else
                ids.Add r, UCase$(id)
            End If
            If Not FeederIdValid(id, CStr(ws.Cells(r, F_KV).Value)) Then AddIssue out, o, "ID format", SH_FEED, r, id, "Does not follow " & SetVal("cfg_FeederPrefix") & "-<kV>-<serial>, or the kV part differs from the voltage column"
            If Trim$(CStr(ws.Cells(r, F_NAME).Value)) = "" Then AddIssue out, o, "Missing name", SH_FEED, r, id, ""
            If Not IsLicensee(CStr(ws.Cells(r, F_LIC).Value)) Then AddIssue out, o, "Unknown licensee", SH_FEED, r, id, CStr(ws.Cells(r, F_LIC).Value)
            If CStr(ws.Cells(r, F_STATUS).Value) = "Active" Then
                k = UCase$(ws.Cells(r, F_LIC).Value) & "|" & LooseKey(CStr(ws.Cells(r, F_NAME).Value))
                If InCol(keys, k) Then
                    AddIssue out, o, "Possible duplicate feeder", SH_FEED, r, id, "Same licensee and name as " & keys(k)
                Else
                    keys.Add id, k
                End If
                If CStr(ws.Cells(r, F_LEVEL).Value) = "Fed" Then
                    p = Trim$(CStr(ws.Cells(r, F_PARENT).Value))
                    If p = "" Then
                        AddIssue out, o, "Missing parent", SH_FEED, r, id, "Fed feeder without a parent 33 kV feeder"
                    Else
                        pr = FindRowById(ws, p, FEEDER_LAST)
                        If pr = 0 Then
                            AddIssue out, o, "Parent not found", SH_FEED, r, id, p
                        ElseIf CStr(ws.Cells(pr, F_KV).Value) <> "33" Then
                            AddIssue out, o, "Parent not 33 kV", SH_FEED, r, id, p
                        ElseIf CStr(ws.Cells(pr, F_STATUS).Value) <> "Active" Then
                            AddIssue out, o, "Parent not active", SH_FEED, r, id, p & " is " & ws.Cells(pr, F_STATUS).Value
                        End If
                    End If
                End If
                If Trim$(CStr(ws.Cells(r, F_BAND).Value)) = "" Then AddIssue out, o, "No band", SH_FEED, r, id, "SBT band not recorded"
            Else
                For Each a In Split(CStr(ws.Cells(r, F_SUPER).Value), ";")
                    If Trim$(CStr(a)) <> "" Then
                        If FindRowById(ws, Trim$(CStr(a)), FEEDER_LAST) = 0 Then AddIssue out, o, "Replacement not found", SH_FEED, r, id, Trim$(CStr(a))
                    End If
                Next a
            End If
        End If
    Next r

    ' Plants
    Set ids = New Collection: Set keys = New Collection
    Set ws = ThisWorkbook.Worksheets(SH_PLANT)
    n = LastUsedRow(ws, 1, PLANT_LAST)
    For r = FIRST_ROW To n
        id = Trim$(CStr(ws.Cells(r, P_ID).Value))
        If id <> "" Then
            If InCol(ids, UCase$(id)) Then
                AddIssue out, o, "Duplicate Plant ID", SH_PLANT, r, id, "Also on row " & ids(UCase$(id))
            Else
                ids.Add r, UCase$(id)
            End If
            If Not (UCase$(id) Like UCase$(SetVal("cfg_PlantPrefix")) & "-#*") Then AddIssue out, o, "ID format", SH_PLANT, r, id, "Does not follow " & SetVal("cfg_PlantPrefix") & "-<serial>"
            k = LooseKey(CStr(ws.Cells(r, P_NAME).Value)) & "|" & LooseKey(CStr(ws.Cells(r, P_LOC).Value))
            If InCol(keys, k) Then
                AddIssue out, o, "Possible duplicate plant", SH_PLANT, r, id, "Same name and site as " & keys(k)
            Else
                keys.Add id, k
            End If
            If Trim$(CStr(ws.Cells(r, P_LGA).Value)) = "" Then AddIssue out, o, "No LGA", SH_PLANT, r, id, "LGA not recorded"
        End If
    Next r

    ' Units
    Set ids = New Collection
    Set ws = ThisWorkbook.Worksheets(SH_UNIT)
    n = LastUsedRow(ws, 1, UNIT_LAST)
    For r = FIRST_ROW To n
        id = Trim$(CStr(ws.Cells(r, U_ID).Value))
        If id <> "" Then
            If InCol(ids, UCase$(id)) Then
                AddIssue out, o, "Duplicate Unit ID", SH_UNIT, r, id, ""
            Else
                ids.Add r, UCase$(id)
            End If
            If FindRowById(ThisWorkbook.Worksheets(SH_PLANT), CStr(ws.Cells(r, U_PLANT).Value), PLANT_LAST) = 0 Then AddIssue out, o, "Plant not found", SH_UNIT, r, id, CStr(ws.Cells(r, U_PLANT).Value)
        End If
    Next r

    nIssues = o - FIRST_ROW
    out.Range("B3").Value = "Last run " & Format$(Now, "dd mmm yyyy hh:mm") & ": " & nIssues & " issue(s)."
    If Not gQuiet Then out.Activate
    Notify IIf(nIssues = 0, "No issues found in the registers.", nIssues & " issue(s) listed on the Checks sheet.")
End Sub

Private Function InCol(ByVal c As Collection, ByVal k As String) As Boolean
    Dim v As Variant
    On Error GoTo nope
    v = c(k)
    InCol = True
    Exit Function
nope:
    InCol = False
End Function

Private Sub AddIssue(ByVal out As Worksheet, ByRef o As Long, ByVal check As String, ByVal sheetName As String, _
                     ByVal r As Long, ByVal id As String, ByVal detail As String)
    If o > 5005 Then Exit Sub
    out.Cells(o, 1).Value = check
    out.Cells(o, 2).Value = sheetName
    out.Cells(o, 3).Value = r
    out.Cells(o, 4).Value = id
    out.Cells(o, 5).Value = detail
    o = o + 1
End Sub

Private Function FeederIdValid(ByVal id As String, ByVal kv As String) As Boolean
    Dim pre As String, parts() As String
    pre = UCase$(SetVal("cfg_FeederPrefix"))
    parts = Split(UCase$(id), "-")
    If UBound(parts) <> 2 Then Exit Function
    If parts(0) <> pre Then Exit Function
    If parts(1) <> "33" And parts(1) <> "11" Then Exit Function
    If parts(1) <> Trim$(kv) Then Exit Function
    If Len(parts(2)) <> CLng(SetVal("cfg_FeederDigits")) Or Not IsNumeric(parts(2)) Then Exit Function
    FeederIdValid = True
End Function

'---------------------------------------------------------------------
' Export a licensee's ID list (to send with its return templates)
'---------------------------------------------------------------------
Public Sub ExportLicenseeIds()
    Dim lic As String
    lic = LicenseeChoice("Export ID list")
    If lic = "" Then Exit Sub
    ExportIdsFor lic, ""
End Sub

Public Function ExportIdsFor(ByVal lic As String, ByVal folder As String) As String
    Dim wb As Workbook, src As Worksheet, dst As Worksheet, r As Long, n As Long, o As Long, c As Long, f As String
    Dim hdr As Variant, cols As Variant

    EnsureReady
    Set src = ThisWorkbook.Worksheets(SH_FEED)
    Set wb = Workbooks.Add
    Set dst = wb.Worksheets(1)
    dst.Name = "Feeder IDs"
    dst.Range("A1").Value = "OGSERC Feeder IDs - " & lic
    dst.Range("A2").Value = "Issued by the Ogun State Electricity Regulatory Commission. Use these IDs in every return. Exported " & Format$(Date, "dd mmm yyyy") & "."
    hdr = Array("Feeder ID", "Feeder name", "Business unit", "Voltage (kV)", "Level", "Parent 33 kV Feeder ID", "Band", "Status", "Your own ID / other names")
    cols = Array(F_ID, F_NAME, F_BU, F_KV, F_LEVEL, F_PARENT, F_BAND, F_STATUS, F_ALIAS)
    For c = 0 To UBound(hdr): dst.Cells(4, c + 1).Value = hdr(c): Next c
    dst.Range(dst.Cells(4, 1), dst.Cells(4, UBound(hdr) + 1)).Font.Bold = True
    o = 5
    n = LastUsedRow(src, 1, FEEDER_LAST)
    For r = FIRST_ROW To n
        If StrComp(CStr(src.Cells(r, F_LIC).Value), lic, vbTextCompare) = 0 Then
            For c = 0 To UBound(cols): dst.Cells(o, c + 1).Value = src.Cells(r, cols(c)).Value: Next c
            o = o + 1
        End If
    Next r
    dst.Range("A1").Font.Bold = True
    dst.Range("A1").Font.Size = 14
    dst.Columns("A:I").AutoFit

    If folder = "" Then folder = ThisWorkbook.Path
    If folder = "" Then folder = CurDir$
    f = folder & Application.PathSeparator & "OGSERC_Feeder_IDs_" & lic & "_" & Format$(Date, "yyyymmdd") & ".xlsx"
    Application.DisplayAlerts = False
    wb.SaveAs Filename:=f, FileFormat:=51
    Application.DisplayAlerts = True
    wb.Close SaveChanges:=False
    WriteLog "ID list exported", lic, (o - 5) & " feeders to " & f
    ExportIdsFor = f
    Notify (o - 5) & " Feeder IDs for " & lic & " saved to:" & vbCrLf & f
End Function
