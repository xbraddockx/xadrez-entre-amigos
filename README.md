# Copa Mata-Mata | Xadrez Entre Amigos

Site completo para organizar um torneio online eliminatório de xadrez no Lichess.

## O que já está pronto

- Inscrição pública: **nome, nick do Lichess e rating Rapid**.
- Consulta do rating Rapid público do Lichess quando a API está disponível; quando não está, utiliza o rating informado e sinaliza a ausência de verificação.
- Evita inscrições duplicadas para o mesmo nick.
- Lista de participantes e **prévia das chaves**, atualizada a cada nova inscrição.
- **Sorteio com preferência por jogadores de ratings próximos**, sorteado novamente entre os classificados a cada rodada.
- Classificação por **folga (bye)** caso a quantidade de participantes não seja potência de 2, procurando não repetir a folga para o mesmo jogador nas fases seguintes.
- Painel de administrador protegido por senha: remover inscrições antes do início, encerrar inscrições, iniciar rodada, lançar vitórias, empates, W.O. individual e W.O. duplo, e iniciar fase seguinte.
- Prazo automático de **5 dias corridos por rodada**, a partir do início daquela rodada, com divulgação do horário de encerramento no site.
- Jogos **10+0** (10 minutos por jogador, sem incremento). Em caso de empate, novo jogo 10+0 com cores alternadas, até haver vencedor.
- Botão **Buscar no Lichess** no painel: consulta o histórico público de ambos os jogadores por meio da API oficial, filtra partidas 10+0 realizadas dentro do prazo e permite **confirmar** a partida que valeu pelo torneio.
- Chaveamento e resultado de todas as rodadas visíveis ao público; nome do campeão ao final.
- Interface responsiva, adaptada a computadores e celulares.

### Limitação importante da integração

O Lichess não sabe quais jogos particulares fazem parte **deste** torneio. O site pode encontrar partidas elegíveis por nicks, ritmo e data, mas **o organizador confirma** qual valeu oficialmente. Não se registra o resultado automaticamente sem sua confirmação. A consulta depende de a API do Lichess estar disponível e de as partidas estarem acessíveis no histórico público.

A inscrição pelo nick **não prova que quem se inscreve controla aquela conta**. Para autenticar a propriedade do perfil, seria necessária uma integração adicional via login OAuth do Lichess.

## Como testar no seu computador

**Requisitos:** Python 3.11 ou superior.

1. Descompacte o arquivo `.zip`.
2. Abra o terminal na pasta `torneio_xadrez_site`.
3. Instale as bibliotecas:

   ```bash
   pip install -r requirements.txt
   ```

4. Crie variáveis de ambiente antes de executar. Exemplos:

   **Windows (PowerShell):**

   ```powershell
   $env:ADMIN_PASSWORD="troque-por-uma-senha-longa-e-unica"
   $env:SECRET_KEY="troque-por-uma-sequencia-aleatoria-de-64-caracteres"
   uvicorn app:app --reload
   ```

   **macOS/Linux:**

   ```bash
   export ADMIN_PASSWORD='troque-por-uma-senha-longa-e-unica'
   export SECRET_KEY='troque-por-uma-sequencia-aleatoria-de-64-caracteres'
   uvicorn app:app --reload
   ```

5. Entre em **http://127.0.0.1:8000/**.
6. Vá em **Área do organizador** e acesse com sua senha.

Sem `DATABASE_URL`, o sistema cria um arquivo `torneio.db` (SQLite) automaticamente na própria pasta. Os dados ficam salvos entre reinícios. O arquivo **não** faz parte do pacote entregue e começa vazio.

## Como publicar para inscrições de verdade

A aplicação precisa de um servidor Python e banco persistente. **Não basta abrir `index.html` ou publicar apenas os arquivos HTML/CSS/JS em hospedagem estática.**

Uma opção é hospedar o projeto no **Render**, usando `render.yaml`, com um banco **PostgreSQL persistente**:

1. Suba a pasta do projeto para um repositório do GitHub (não inclua senhas nem arquivos `.env`).
2. No Render, crie um serviço Web a partir do repositório, ou use o blueprint `render.yaml`.
3. Configure as variáveis de ambiente:
   - `ADMIN_PASSWORD`: uma senha forte e exclusiva para o organizador;
   - `SECRET_KEY`: chave aleatória longa e privada;
   - `DATABASE_URL`: URL de conexão a um PostgreSQL persistente;
   - `COOKIE_SECURE=1`: obrigatório com HTTPS.
4. Publique o serviço e use o endereço HTTPS disponibilizado pela hospedagem para divulgar a inscrição.

> **Atenção:** sistemas que apagam os arquivos locais em reinicializações/deploys não devem usar SQLite em produção, pois você perderia inscrições e resultados. Use PostgreSQL ou outro armazenamento persistente. Faça backups periódicos do banco.

Também é possível executar com:

```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```

## Operação do torneio

1. Compartilhe a URL. Enquanto inscrições estiverem abertas, todos veem uma **prévia**, que pode mudar.
2. Quando encerrar inscrições, entre na **Área do organizador** e selecione **Realizar sorteio oficial**.
3. Cada confronto terá seu par definido e 5 dias corridos para ser realizado. A data e a hora exatas aparecem no site. Os participantes devem tentar agendar a partida até o segundo dia.
4. O resultado pode ser **lançado manualmente** ou conferido clicando **Buscar no Lichess** e, depois, **Confirmar resultado**.
5. Se terminar em empate, registre o empate e peça um novo jogo 10+0 com cores invertidas; o confronto permanece pendente.
6. Para jogador ausente, use a vitória por **W.O.** do adversário. Se nenhum jogar, e não houver um responsável individual identificado, use **Dois W.O.**. A decisão depende da organização.
7. Com todos os confrontos resolvidos, selecione **Concluir rodada** para criar a seguinte. Repita até o site declarar o campeão.

## Transparência do pareamento

O algoritmo **prioriza proximidade de rating**, mas preserva alguma aleatoriedade no sorteio. Portanto, não promete diferenças mínimas absolutas em todo confronto. Cada fase é sorteada novamente entre quem venceu, para continuar aproximando níveis. Isso é um sistema de *repescagem de adversários/novo pareamento por rodada*, não uma chave única pré-fixada do começo ao fim.

O formato é de **eliminação simples**: quem perde sai. Quando existem folgas, alguns jogadores avançam sem jogar; o algoritmo busca evitar folgas repetidas. O administrador tem a decisão final em casos omissos.

## Testes automáticos

```bash
pip install pytest httpx
pytest -q
```

## Estrutura

- `app.py` — API, regras de chaveamento, banco, painel, integração com o Lichess;
- `static/index.html`, `static/app.css`, `static/app.js` — interface;
- `requirements.txt` — dependências;
- `render.yaml`, `Procfile` — configuração sugerida de publicação;
- `tests/` — testes de lógica e endpoints.

**Privacidade:** nome, nick e rating são públicos no torneio. Não compartilhe senhas do Lichess. O administrador pode remover inscrições antes do início; pedidos de remoção após o início exigem ajuste administrativo. Como todo site público, recomenda-se publicar uma política de privacidade e manter os dados protegidos.

## Reutilizar o site para novos torneios (versão multi-edições)

Na **Área do organizador**, após entrar com a senha:

1. Em **Editar dados do torneio atual**, atualize nome da competição, descrição, prêmio opcional, tempo por jogador, incremento, dias por rodada, prazo inicial de contato e tolerância para W.O. Salve para atualizar a página pública imediatamente.
2. Após o sorteio da primeira rodada, os campos de ritmo e prazos ficam bloqueados, para não alterar as condições das partidas em andamento. Nome, descrição e prêmio continuam editáveis.
3. Assim que a competição terminar, selecione **Criar nova edição**. O sistema preserva os inscritos, todas as rodadas, resultados e o campeão da edição anterior em um **arquivo de histórico**. A nova edição abre com inscrições vazias.
4. O público pode usar a caixa **Edição em exibição** para consultar os torneios anteriores. Edições arquivadas não aceitam novas inscrições nem alterações nos resultados.
5. Use **Baixar histórico em JSON** no painel administrativo para fazer backup das edições. Este arquivo não contém senhas, mas contém nomes e dados públicos dos jogadores. Guarde-o em local seguro.

**Atenção à hospedagem:** o banco PostgreSQL gratuito do Render pode expirar. Para preservar dados por muitos meses e realizar várias edições, configure uma opção de armazenamento persistente, como um banco mantido no Supabase, e faça backups antes da expiração. O backup JSON é uma cópia de segurança, não uma restauração automática.

O sistema gerencia **uma edição ativa por vez**, mantendo quantas edições encerradas forem necessárias como histórico. Para torneios simultâneos, seria necessária uma estrutura diferente.