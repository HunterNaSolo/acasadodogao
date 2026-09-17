@echo off
setlocal
cd /d "%~dp0"

echo ==============================================
echo  Gestao Delivery - Publicar versao v1.0.1
echo ==============================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo ERRO: Git nao foi encontrado neste computador.
  pause
  exit /b 1
)

if not exist ".git\" (
  echo ERRO: Esta pasta nao e o repositorio Git.
  echo Coloque este arquivo dentro da pasta PROJETO_GITHUB.
  pause
  exit /b 1
)

echo [1/5] Preparando arquivos...
git add .
if errorlevel 1 goto :erro

git diff --cached --quiet
if errorlevel 1 (
  echo [2/5] Criando commit...
  git commit -m "v1.0.1 - edicao de lanches e estoque"
  if errorlevel 1 goto :erro

  echo [3/5] Enviando alteracoes para o GitHub...
  git push
  if errorlevel 1 goto :erro
) else (
  echo [2/5] Nenhuma alteracao nova para commit. Continuando...
)

echo [4/5] Conferindo tag v1.0.1...
git rev-parse -q --verify "refs/tags/v1.0.1" >nul 2>nul
if errorlevel 1 (
  git tag v1.0.1
  if errorlevel 1 goto :erro
) else (
  echo A tag v1.0.1 ja existe localmente.
)

echo [5/5] Publicando tag v1.0.1...
git push origin v1.0.1
if errorlevel 1 goto :erro

echo.
echo ==============================================
echo  PRONTO! v1.0.1 enviada para o GitHub.
echo  Agora abra GitHub ^> Actions e aguarde ficar verde.
echo ==============================================
pause
exit /b 0

:erro
echo.
echo ==============================================
echo  OCORREU UM ERRO. Tire um print desta tela.
echo ==============================================
pause
exit /b 1
