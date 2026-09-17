@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ==============================================
echo  Gestão Delivery - Publicar versão v1.0.1
echo ==============================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo Git não foi encontrado neste computador.
  pause
  exit /b 1
)

if not exist ".git" (
  echo Esta pasta ainda não é um repositório Git.
  echo Extraia estes arquivos DENTRO da pasta PROJETO_GITHUB que você já enviou ao GitHub.
  pause
  exit /b 1
)

git add .
git commit -m "v1.0.1 - edicao de lanches e estoque"
if errorlevel 1 (
  echo.
  echo O commit não foi criado. Se não houver mudanças, talvez a atualização já tenha sido aplicada.
  pause
  exit /b 1
)

git push
if errorlevel 1 (
  echo Falha ao enviar o commit para o GitHub.
  pause
  exit /b 1
)

git tag v1.0.1
if errorlevel 1 (
  echo A tag v1.0.1 já existe ou não pôde ser criada.
  pause
  exit /b 1
)

git push origin v1.0.1
if errorlevel 1 (
  echo Falha ao publicar a tag v1.0.1.
  pause
  exit /b 1
)

echo.
echo Pronto. O GitHub Actions vai gerar a Release v1.0.1 automaticamente.
echo Abra a aba Actions do repositório e aguarde o processo ficar verde.
pause
