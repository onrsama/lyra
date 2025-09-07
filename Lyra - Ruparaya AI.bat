@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Photoshop JSX Installer/Updater (GitHub Raw + Prompt Path)

:: ============================================================
::  KONFIGURASI (ISI MANUAL DI SINI)
:: ============================================================
:: URL RAW GitHub ke file JSX terbaru (edit ini!)
set "RAW_URL=https://raw.githubusercontent.com/onrsama/lyra/main/Lyra%%20-%%20Ruparaya%%20AI.jsx"
:: Nama file JSX yang akan ada di Presets\Scripts (edit ini!)
set "TARGET_NAME=Lyra - Ruparaya AI.jsx"

:: 1 = backup file lama sebelum diganti, 0 = tidak backup
set "DO_BACKUP=1"

:: ============================================================
::  ELEVASI ADMIN (tanpa .vbs)
:: ============================================================
>nul 2>&1 net session
if %errorlevel% NEQ 0 (
  echo [i] Meminta hak Administrator...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

:: ============================================================
::  MINTA PATH INSTALASI PHOTOSHOP
::     Contoh: C:\Program Files\Adobe\Adobe Photoshop (Beta)
:: ============================================================
:askPath
echo.
echo Masukkan path instalasi Photoshop (root folder):
echo   Contoh: C:\Program Files\Adobe\Adobe Photoshop (Beta)
set "PS_PATH="
set /p "PS_PATH=> "

if not defined PS_PATH (
  echo [ERR] Path kosong. Coba lagi.
  goto :askPath
)

if not exist "%PS_PATH%" (
  echo [ERR] Path tidak ditemukan: "%PS_PATH%"
  goto :askPath
)

:: Bentuk folder Presets\Scripts dari PS_PATH
set "DEST=%PS_PATH%\Presets\Scripts"

:: Pastikan folder Presets\Scripts ada (buat jika belum)
if not exist "%DEST%" (
  echo [i] Folder "%DEST%" tidak ada, membuat...
  mkdir "%DEST%" >nul 2>&1 || (
    echo [ERR] Gagal membuat folder: "%DEST%"
    pause
    exit /b 1
  )
)

echo [OK] Target folder: "%DEST%"
echo.

:: ============================================================
::  Tutup Photoshop jika sedang berjalan (hindari file terkunci)
:: ============================================================
for /f "tokens=1,* delims= " %%P in ('tasklist /fi "imagename eq Photoshop.exe" ^| find /i "Photoshop.exe"') do (
  echo [i] Menutup Photoshop agar bisa melakukan install...
  taskkill /IM Photoshop.exe /F >nul 2>&1
  timeout /t 1 >nul
  goto :psClosed
)
:psClosed

:: ============================================================
::  CEK: UPDATE atau INSTALL baru
:: ============================================================
set "TARGET_PATH=%DEST%\%TARGET_NAME%"
if exist "%TARGET_PATH%" (
  set "MODE=UPDATE"
) else (
  set "MODE=INSTALL"
)

echo [i] Mode: %MODE%
echo [i] File target: "%PS_PATH%"
echo.

:: ============================================================
::  BACKUP (hanya saat UPDATE)
:: ============================================================
if /I "%MODE%"=="UPDATE" if "%DO_BACKUP%"=="1" (
  for /f %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "TS=%%T"
  set "BKP=%DEST%\_backup_%TS%"
  mkdir "%BKP%" >nul 2>&1
  attrib -h -s -r "%TARGET_PATH%" >nul 2>&1
  copy /y "%TARGET_PATH%" "%BKP%\%TARGET_NAME%" >nul
  echo [BKP] Versi lama disalin ke: "%BKP%\%TARGET_NAME%"
  echo.
)

:: ============================================================
::  DOWNLOAD FILE DARI GITHUB RAW
::     - Utamakan curl; fallback ke PowerShell
:: ============================================================
set "TMP_NEW=%TEMP%\%TARGET_NAME%.new"
if exist "%TMP_NEW%" del /f /q "%TMP_NEW%" >nul 2>&1

for /f "usebackq delims=" %%U in (`
  powershell -NoProfile -Command ^
    "$b='%RAW_BASE%'; $f='%RAW_FILE%';" ^
    "$u=[System.Uri]::EscapeUriString($b + $f);" ^
    "Write-Output $u"
`) do set "RAW_URL=%%U"
echo [URL] Github

where curl >nul 2>&1
if %errorlevel% EQU 0 (
  echo [GET] curl: clone data...
  curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 15 "%RAW_URL%" -o "%TMP_NEW%"
) else (
  echo [GET] PowerShell: %RAW_URL%
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$u='%RAW_URL%'; $o='%TMP_NEW%'; Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile $o"
)

if not exist "%TMP_NEW%" (
  echo [ERR] Gagal mengunduh file dari GitHub Raw.
  echo       Cek RAW_URL atau koneksi internet.
  pause
  exit /b 1
)

for %%A in ("%TMP_NEW%") do set "NEWSIZE=%%~zA"
if "%NEWSIZE%"=="0" (
  echo [ERR] File terunduh berukuran 0 byte. URL salah/akses ditolak?
  del /f /q "%TMP_NEW%" >nul 2>&1
  pause
  exit /b 1
)

:: ============================================================
::  PASANG FILE BARU (REPLACE/INSTALL)
:: ============================================================
attrib -h -s -r "%TARGET_PATH%" >nul 2>&1
copy /y "%TMP_NEW%" "%TARGET_PATH%" >nul
del /f /q "%TMP_NEW%" >nul 2>&1

:: Pastikan terlihat di Explorer
attrib -h -s -r "%TARGET_PATH%" >nul 2>&1
icacls "%TARGET_PATH%" /inheritance:e >nul 2>&1

:: Verifikasi
if exist "%TARGET_PATH%" (
  echo.
  echo [SUCCESS] %MODE% selesai!
  echo          (Jika belum terlihat di menu, restart Photoshop)
) else (
  echo [ERR] Gagal menulis file di folder target.
  pause
  exit /b 1
)

echo.
echo Selesai.
echo.
pause
exit /b 0