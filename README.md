# Gestão Delivery

Aplicativo portátil para Windows para delivery de cachorro-quente, com caixa, estoque, cardápio, ficha técnica, baixa automática de ingredientes e análise de lucro/prejuízo.

## Uso

A versão pronta está em `GestaoDelivery.exe`. Não exige Node.js, Python, Java nem instalação de dependências.

- `INSTALAR_NO_WINDOWS.bat`: copia o EXE para `%LOCALAPPDATA%\Programs\GestaoDelivery` e cria atalho no Desktop.
- `ABRIR_SEM_INSTALAR.bat`: abre o EXE diretamente.
- Dados persistentes: `%APPDATA%\GestaoDelivery\delivery-data.json`.

## Financeiro

O app separa **lucro operacional** de **saldo de caixa**:

- Lucro operacional = receitas - custo dos ingredientes consumidos - taxas - despesas operacionais.
- Saldo de caixa = receitas recebidas - compras de estoque - taxas - demais despesas pagas.

Assim, uma compra de estoque não é contada duas vezes como custo.

## Atualização pelo GitHub

O workflow `.github/workflows/release.yml` compila o EXE para Windows quando uma tag `v*` é enviada.

Exemplo:

```bash
git tag v1.0.1
git push origin v1.0.1
```

O workflow usa a tag como versão embutida no EXE e publica `GestaoDelivery.exe` em um GitHub Release. Configure o proprietário e o repositório dentro do próprio app em **Configurações**.

## Novidades da v1.0.1

- Botão **Editar** em cada lanche do cardápio.
- Edição de nome, preço e ficha técnica do lanche.
- Botão **Duplicar** para criar variações de um lanche rapidamente.
- Botão **Ativar/Desativar** sem apagar o cadastro.
- Botão **Editar** no estoque para alterar nome, quantidade, unidade, estoque mínimo e custo.
- Os IDs dos cadastros são preservados durante a edição, portanto fichas técnicas continuam vinculadas corretamente.
