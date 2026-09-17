@echo off
chcp 65001 >nul
setlocal
where go >nul 2>nul
if errorlevel 1 (
  echo Go não encontrado. Instale o Go ou use o GitHub Actions para compilar.
  pause
  exit /b 1
)
echo Compilando Gestão Delivery v1.0.1...
set GOOS=windows
set GOARCH=amd64
set CGO_ENABLED=0
go build -trimpath -ldflags="-s -w -H=windowsgui -X main.AppVersion=1.0.1" -o GestaoDelivery.exe .
if errorlevel 1 (
  echo Falha na compilação.
  pause
  exit /b 1
)
echo.
echo GestaoDelivery.exe gerado com sucesso.
pause
