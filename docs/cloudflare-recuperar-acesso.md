# Recuperar o acesso ao seu Worker da Cloudflare

Para quando alguém apagou ou perdeu a conexão com o servidor de salas (o Worker `jaca-sala`) sem querer: desinstalou o app, trocou de PC, apagou uma pasta, ou o app disse **"Esse Worker já tem um dono"** ou **"A chave do dono não confere"**.

Quem **só entra em salas** (não cria) nunca precisa disto. Só o dono do Worker.

(In English: [cloudflare-recover-access.md](cloudflare-recover-access.md).)

## O que o app guarda, e onde

- **Conta e chave do dono** ficam no app (Configurações > Rede > Cloudflare). A chave é criada pelo app, fica criptografada e **nunca aparece na tela**.
- **Uma cópia** fica em `%LOCALAPPDATA%\JacaAntiJanja-Backup\cloudflare.json`, **fora** da pasta que o desinstalador apaga. A chave nessa cópia é protegida pelo próprio Windows (só o seu usuário do Windows consegue ler). Ao instalar o app de novo, ele encontra a cópia e **restaura a conexão sozinho**, no mesmo modo que estava.
- O botão **Remover** (Configurações > Rede > Cloudflare) apaga a conexão **e** a cópia, de propósito.

A cópia **não** ajuda se: você apagou a pasta `JacaAntiJanja-Backup` à mão, está em **outro PC**, está em **outro usuário do Windows**, ou o Windows foi reinstalado. Nesses casos use os passos abaixo.

## Primeiro: descubra em que situação você está

1. Abra no navegador `https://jaca-sala.SUA-CONTA.workers.dev/health` (troque `SUA-CONTA` pelo nome da sua conta; o do Ramon é `ramonlopesdev`).
   - Apareceu `{"ok":true,"service":"jaca-sala"}`: o Worker **existe**. Vá para o **Caso A**.
   - Deu erro ou "não encontrado": o Worker foi apagado. Vá para o **Caso B**.
2. Não lembra o nome da conta? Vá para o **Caso C**.

## Caso A: o Worker existe, mas a chave do dono se perdeu (o mais comum)

O Worker só aceita **uma** chave de dono, registrada na primeira vez. Como a antiga se perdeu, você define uma chave nova direto no painel da Cloudflare. Não precisa publicar nada de novo.

1. **Crie uma chave nova.** No PowerShell (cole a linha inteira e aperte Enter):

   ```
   $r=[Security.Cryptography.RandomNumberGenerator]::Create(); $b=New-Object byte[] 24; $r.GetBytes($b); [Convert]::ToBase64String($b)
   ```

   Ele imprime uma sequência de letras e números. Essa é a chave. Copie.
2. **Coloque a chave no Worker.** No painel da Cloudflare (dash.cloudflare.com): **Workers e Pages** > **jaca-sala** > **Configurações** > **Variáveis e segredos** > **Adicionar**.
   - Tipo: **Segredo**
   - Nome: `OWNER_KEY` (exatamente assim, maiúsculas)
   - Valor: a chave do passo 1
   - Salve e **implante**.
3. **No app:** Configurações > Rede > Cloudflare.
   - Endereço: o nome da conta (ou `jaca-sala.SUA-CONTA.workers.dev`)
   - Chave do dono: cole a chave do passo 1
   - Toque em **Salvar e testar**. Deve aparecer "Worker conectado".

Daí em diante o app guarda a chave de novo, inclusive na cópia que sobrevive a desinstalar.

> **Cuidado:** a chave é segredo. Não cole em chat, e-mail ou print. Quem tem a chave pode criar salas no seu Worker (gasta o seu limite grátis, mas não dá acesso à sua conta da Cloudflare nem ao seu PC). Se ela vazar, repita o passo 1 e o 2 com uma chave nova: a antiga deixa de valer na hora.
> Guarde a chave num gerenciador de senhas, assim você não depende do app para tê-la.

## Caso B: o Worker foi apagado

1. No app: Configurações > Rede > Cloudflare > **Publicar na minha conta Cloudflare**. Faça o mesmo de antes: entre na Cloudflare, confirme a conexão com o GitHub (se pedir), crie direto, deixe o nome `jaca-sala` e espere "Success".
2. Copie o endereço que aparecer no fim do log (`https://jaca-sala.SUA-CONTA.workers.dev`).
3. No app, cole o endereço e toque em **Salvar e testar** com a chave **vazia**: o app cria e registra a chave nova.
4. Confira no painel (Workers e Pages > jaca-sala > Configurações > Domínios e rotas) que o **workers.dev** está **Habilitado**.

A conta não muda, então o endereço e o final dos códigos de sala continuam iguais.

## Caso C: não lembro o nome da conta

No painel da Cloudflare, abra **Workers e Pages** > **jaca-sala**. O endereço do Worker aparece no topo (`jaca-sala.SUA-CONTA.workers.dev`). O trecho `SUA-CONTA` é o nome da conta. Também aparece em **Workers e Pages** > **Visão geral** como "Subdomínio workers.dev".

## Caso D: apaguei o repositório `jaca-sala` do GitHub

Pode ficar tranquilo: o Worker **continua funcionando**. O repositório é só uma cópia do código que a Cloudflare usa para republicar. Você só precisa dele se quiser atualizar o Worker. Nesse caso, use o botão **Publicar na minha conta Cloudflare** de novo (Caso B).

## Caso E: meu amigo não consegue entrar

- Peça para ele usar o app na versão **0.1.12 ou mais nova**. As versões 0.1.5 a 0.1.8 cortavam o final do código ao colar (o campo aceitava só 24 caracteres), e a conta ficava errada, como `ramonlopesde` em vez de `ramonlopesdev`.
- A sala só existe enquanto o **dono está nela**. Se o dono saiu, o código deixa de valer.
- O app agora explica o motivo na própria mensagem de erro. Se continuar sem entender: Configurações > Sobre > **Abrir pasta do registro** e mande o arquivo `jaca.log` (não tem chave nem o código inteiro da sala).

## Resumo das mensagens do app

| Mensagem | O que fazer |
|---|---|
| "Esse Worker já tem um dono (outra chave)" | A chave guardada se perdeu: **Caso A**. |
| "A chave do dono não confere" | A chave colada não é a do Worker. Se perdeu a certa: **Caso A**. |
| "Não consegui alcançar o Worker" | Confira o nome da conta, a internet e se o Worker existe (`/health`): **Caso B** se foi apagado. |
| "O endereço ... não existe. O código tem a conta errada ou cortada" | Peça o código de novo ao dono e cole inteiro (**Caso E**). |
| "A sala não existe ou já foi encerrada" | O dono saiu da sala ou o código é de uma sala antiga. |
