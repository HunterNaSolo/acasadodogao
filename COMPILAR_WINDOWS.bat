@echo off
chcp 65001 >nul
where go >nul 2>nul
if errorlevel 1 (
  echo Go não encontrado. Para compilar manualmente, instale Go 1.23 ou superior.
  pause
  exit /b 1
)
set GOOS=windows
set GOARCH=amd64
go build -trimpath -ldflags="-s -w -H=windowsgui" -o GestaoDelivery.exe .
echo.
echo Arquivo criado: GestaoDelivery.exe
pause
