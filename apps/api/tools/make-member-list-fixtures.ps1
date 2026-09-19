# Makes the member list's real Excel test files (spec Part 3 §9.10) with the Excel
# installed on this machine, by COM automation. Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File apps\api\tools\make-member-list-fixtures.ps1
# Every person is invented; every address is example.com. The files it writes are
# committed under apps/api/test/fixtures/member-list/excel/, byte for byte (the
# folder is -text in .gitattributes, so no line ending is ever rewritten), and the
# tests pin what each one holds. Re-running it on another Excel may change the bytes.
param([string]$OutDir = (Join-Path $PSScriptRoot '..\test\fixtures\member-list\excel'))
$ErrorActionPreference = 'Stop'
$OutDir = [System.IO.Path]::GetFullPath($OutDir)
New-Item -ItemType Directory -Force $OutDir | Out-Null

$x = New-Object -ComObject Excel.Application
$x.Visible = $false
$x.DisplayAlerts = $false
$excelVersion = $x.Version
try {
  $wb = $x.Workbooks.Add()
  # The repository is public: no author or "last saved by" name goes into a file.
  $wb.RemovePersonalInformation = $true
  while ($wb.Worksheets.Count -lt 2) { [void]$wb.Worksheets.Add() }
  $ws = $wb.Worksheets.Item(1)
  $ws.Name = 'Members'
  # TEXT: typed as text. NUM: a number in a General cell. DATE: a date serial shown
  # as yyyy-mm-dd. BOOL: TRUE/FALSE. FORMULA: a formula whose cached value is read.
  $rows = @(
    @('Member No', 'Full Name', 'Email', 'Mobile', 'Joined', 'Status', 'Paid'),
    @('000123', ('Jos' + [char]0x00E9 + ' ' + [char]0x00C1 + 'lvarez'), 'jose@example.com', '+44 7911 123456', 'DATE:45296', 'Active', 'BOOL:1'),
    @('000124', ('Zo' + [char]0x00EB + ' M' + [char]0x00FC + 'ller'), 'ZOE.MULLER@Example.com ', '07911 123456', 'DATE:45323', 'Frozen', 'BOOL:0'),
    @('000125', ([char]0x0141 + 'ukasz Nowak'), 'lukasz@example.com', 'NUM:919876543210', 'DATE:45352', 'Active', ''),
    @('000126', ([string][char]0x0905 + [char]0x092E + [char]0x093F + [char]0x0924 + ' Sharma'), 'amit@example.com', 'NUM:9876543210', 'DATE:45353', 'Expired', ''),
    @('NUM:1234567890123456', 'Long Id, With "Quote"', 'long@example.com', 'NUM:4155552671', 'DATE:45354', 'Active', ''),
    @('000127', ('H' + [char]0x00E9 + 'l' + [char]0x00E8 + 'ne Dupont'), 'helene@example.com', 'FORMULA:=CONCATENATE("+33 ","6 12 34 56 78")', 'DATE:45355', 'Pending', ''),
    @('000128', ("Ann`nLee"), 'ann.lee@example.com', '(415) 555-0100', 'DATE:45356', 'Active', '')
  )
  for ($r = 0; $r -lt $rows.Count; $r++) {
    for ($c = 0; $c -lt $rows[$r].Count; $c++) {
      $cell = $ws.Cells.Item($r + 1, $c + 1)
      $v = [string]$rows[$r][$c]
      if ($v -eq '') { continue }
      if ($v.StartsWith('NUM:')) { $cell.NumberFormat = 'General'; $cell.Value2 = [double]$v.Substring(4) }
      elseif ($v.StartsWith('DATE:')) { $cell.NumberFormat = 'yyyy-mm-dd'; $cell.Value2 = [double]$v.Substring(5) }
      elseif ($v.StartsWith('BOOL:')) { $cell.Value2 = [bool][int]$v.Substring(5) }
      elseif ($v.StartsWith('FORMULA:')) { $cell.NumberFormat = 'General'; $cell.Formula = $v.Substring(8) }
      else { $cell.NumberFormat = '@'; $cell.Value2 = $v }
    }
  }
  # Row 7 (Hélène) is hidden, as a filtered export stores it.
  $ws.Rows.Item(7).Hidden = $true
  $staff = $wb.Worksheets.Item(2)
  $staff.Name = 'Staff'
  $staff.Cells.Item(1, 1).Value2 = 'Coach'
  $staff.Cells.Item(2, 1).Value2 = 'Sam Coach'
  $ws.Activate()

  # Each Excel "Save as" kind, by its XlFileFormat number. The CSV and text kinds
  # write the active sheet only.
  $formats = [ordered]@{
    'book.xlsx' = 51
    'book-strict.xlsx' = 61
    'book.xlsb' = 50
    'book.xls' = 56
    'book.ods' = 60
    'csv-utf8.csv' = 62
    'csv-comma.csv' = 6
    'unicode-text.txt' = 42
    'csv-mac.csv' = 22
    'csv-msdos.csv' = 24
  }
  foreach ($name in $formats.Keys) {
    $path = Join-Path $OutDir $name
    if (Test-Path $path) { Remove-Item $path -Force }
    $wb.SaveAs($path, $formats[$name])
  }
  $path = Join-Path $OutDir 'book-password.xlsx'
  if (Test-Path $path) { Remove-Item $path -Force }
  $wb.SaveAs($path, 51, 'invented-password')

  # "Export to Excel" buttons that write a web page or Excel 2003 XML under an
  # Excel name: Excel's own web page and XML kinds, renamed .xls (one sheet, so no
  # folder of supporting files is written beside them).
  $wb.Worksheets.Item('Staff').Delete()
  $web = [ordered]@{ 'web-page.htm' = 44; 'single-file-web-page.mht' = 45; 'xml-spreadsheet-2003.xml' = 46 }
  foreach ($name in $web.Keys) {
    $path = Join-Path $OutDir $name
    if (Test-Path $path) { Remove-Item $path -Force }
    $wb.SaveAs($path, $web[$name], '')
  }
  $wb.Close($false)
  foreach ($name in $web.Keys) {
    $from = Join-Path $OutDir $name
    $to = Join-Path $OutDir ([System.IO.Path]::GetFileNameWithoutExtension($name) + '.xls')
    if (Test-Path $to) { Remove-Item $to -Force }
    Move-Item $from $to
  }
  $files = Join-Path $OutDir 'web-page_files'
  if (Test-Path $files) { Remove-Item $files -Recurse -Force }
} finally {
  $x.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($x)
}
"Excel " + $excelVersion + " | list separator " + (Get-ItemProperty 'HKCU:\Control Panel\International').sList + " | ANSI code page " + (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Nls\CodePage').ACP
Get-ChildItem $OutDir -File | Select-Object Name, Length | Format-Table -AutoSize
