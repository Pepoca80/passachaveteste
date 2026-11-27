# Passachave

Aluguel de carros entre pessoas. HTML, CSS e JavaScript puro, com banco, login e fotos no [Supabase](https://supabase.com).

## O que mudou nesta versão

- **Uma conta só.** Não existe mais "tipo de conta". Na tela `app.html` a pessoa alterna entre **Quero alugar** e **Quero anunciar**. Ninguém consegue reservar o próprio carro.
- **Fotos nos anúncios.** Até 6 por carro, enviadas ao Supabase Storage (bucket `veiculos`). As fotos são reduzidas para no máximo 1280 px antes do envio. Dá para adicionar e remover fotos depois. Sem foto, aparece a ilustração.
- **Contrato de locação.** Gerado pelo banco no pedido de reserva, com os dados reais das partes, do carro, do período e dos valores. O locatário assina ao enviar o pedido (checkbox obrigatório) e o proprietário, ao aceitar. As duas datas ficam registradas. O contrato responsabiliza o locatário por multas, danos, furto e roubo.

## Telas

| Arquivo | Tela |
|---|---|
| `index.html` | Início e carrossel de anúncios (sem login) |
| `login.html`, `cadastro.html` | Login e cadastro (nome, e-mail, senha) |
| `app.html` | Área logada: buscar, reservas, solicitações recebidas, meus carros e perfil |

`locatario.html` e `proprietario.html` foram removidos. Apague os dois, além de `js/locatario.js` e `js/proprietario.js`, se ainda estiverem no seu projeto.

## Como fica o contrato

1. Em **Meu perfil**, a pessoa informa CPF, telefone e CNH. Ficam na tabela `documentos`, que só o próprio usuário lê. Para alugar são obrigatórios os três. Para anunciar bastam CPF e telefone.
2. Na tela do carro, o locatário escolhe as datas, lê a **prévia** (o CPF do dono aparece parcialmente oculto) e marca o aceite.
3. Ao solicitar, o banco recalcula os valores, monta o contrato e grava o aceite do locatário.
4. O proprietário vê o contrato na solicitação e, ao clicar em **Aceitar e assinar**, registra o aceite dele.
5. Os dois podem abrir o contrato em **Ver contrato** e usar **Imprimir / salvar em PDF**.

Depois de criado, o contrato não pode ser alterado: um trigger só permite mudar o `status` da reserva.

## Como rodar

1. No Supabase, abra o **SQL Editor**, cole `supabase/schema.sql` e clique em **Run**. O script serve para projeto novo e para o projeto que já tinha a versão anterior: usuários, carros e reservas existentes são mantidos.
2. Em **Authentication > Sign In / Providers > Email**, desative **Confirm email** para facilitar os testes.
3. Confira `js/config.js` com a URL e a chave do projeto.
4. Abra `index.html` com Live Server ou publique no GitHub Pages.
5. Opcional: `supabase/seed.sql` cria 6 carros de exemplo (sem fotos).

Para testar: crie duas contas, complete o perfil das duas (a que vai alugar precisa da CNH), anuncie um carro com fotos na primeira e peça a reserva na segunda.

## Observações

- O modelo de contrato é um texto-base. Peça a revisão de um advogado antes de usar com pessoas reais.
- O contrato prevê registro de fotos na retirada e na devolução, mas o sistema ainda não tem essa tela.
- A cobrança de multas e danos acontece fora do sistema, entre as partes.
- Linhas antigas de `veiculos` não têm placa e as de `reservas` não têm contrato. Os carros antigos aparecem no contrato como "placa não informada" até serem recadastrados.
