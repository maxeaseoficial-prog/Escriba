# Escriba

Painel simples, branco e lilás para transformar **um áudio ou um ZIP com vários áudios** em **PDF ou texto**, reunindo todas as transcrições em um documento. Interface em português, com identidade de lápis, sem cadastro, sem banco externo e sem chave de API de IA.

## Começar pelo Docker

Com Docker e Docker Compose instalados:

```bash
git clone https://github.com/maxeaseoficial-prog/Escriba.git
cd Escriba
docker compose up --build
```

Abra **http://localhost:8000**. O serviço fica acessível somente no próprio computador por padrão. O primeiro processamento baixa o modelo Whisper `small`; é necessário acesso à internet nessa etapa. Depois do download, o modelo é reutilizado no armazenamento local.

Para encerrar: `docker compose down`. Os modelos e resultados ainda não expirados permanecem no volume `escriba-data`.

## Rodar sem Docker (macOS / Linux)

Use **Python 3.11 ou 3.12**. No macOS, instale Python e FFmpeg (por exemplo, `brew install python@3.12 ffmpeg`), depois:

```bash
git clone https://github.com/maxeaseoficial-prog/Escriba.git
cd Escriba
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
bash scripts/start.sh
```

Abra **http://localhost:8000**. No Linux, instale também FFmpeg e, para PDFs Unicode, `fonts-dejavu-core` pelo gerenciador do sistema. No Windows, instale Python e FFmpeg, use `.venv\Scripts\activate` e execute `python -m uvicorn escriba.app:app --host 127.0.0.1 --port 8000 --workers 1`.

## Uso

1. Selecione um áudio ou um arquivo ZIP. Para vários áudios, coloque todos em um ZIP.
2. Dê um nome ao documento, se desejar. Em **Configurações**, escolha PDF/TXT, idioma, ordem dos arquivos, separação por áudio e marcação dos tempos.
3. Clique **Transcrever arquivo**. Acompanhe o envio e o processamento de cada áudio.
4. Copie o texto ou baixe o resultado. Os dois formatos podem ser baixados sem transcrever novamente.

A configuração **Separar por áudio** inclui os nomes dos arquivos; desative-a para texto corrido. O aplicativo **transcreve**, não resume nem reescreve o conteúdo. Revise nomes próprios, números e trechos de áudio difíceis.

## Arquivos e organização

- Formatos: MP3, WAV, M4A, OGG, OPUS (incluindo áudio de WhatsApp), FLAC, AAC, AIFF, WMA, WEBM e MP4 com faixa de áudio, além de ZIP.
- Até **500 MB** por envio, **100 áudios** por ZIP e **1 GB** de conteúdo descompactado. Cada áudio do ZIP pode ter até 300 MB. Limite de **2 horas por áudio**. Esses limites são definidos em `escriba/config.py`.
- ZIPs com senha, links simbólicos, caminhos inseguros ou compressão excessiva são recusados. ZIPs dentro de ZIPs não são processados.
- Documentos, fotos e arquivos como `_chat.txt` são ignorados, com aviso na interface. Esta versão **não interpreta o histórico do WhatsApp nem identifica interlocutores**.
- Ordenação por data reconhecida no **nome**, nome natural (`1, 2, 10`) ou ordem do ZIP. Nomes como `AUDIO-2026-10-05-14-12-31.opus` fornecem data e hora; `PTT-20261005-WA0001.opus` fornece somente data. Arquivos sem data vão depois dos datados, por nome. Nunca é usada a data de modificação do ZIP como data da gravação.
- A transcrição de cada arquivo é preservada. Falhas parciais aparecem na interface e no documento; um arquivo com erro não é silenciosamente omitido.

## Motor de transcrição

O motor é **faster-whisper**, uma implementação do Whisper baseada em CTranslate2:

- https://github.com/SYSTRAN/faster-whisper
- https://github.com/openai/whisper

Padrão: `small`, CPU e `int8`, idioma português. Para um computador mais limitado, altere o modelo para `base` ou `tiny`, aceitando a possível perda de precisão. Não há cobrança por minuto de API nesta implementação, mas o processamento usa CPU, memória, disco e energia da máquina. A duração do processamento depende do hardware e dos áudios.

```bash
ESCRIBA_MODEL=base bash scripts/start.sh
```

Com Docker Compose, crie `.env` a partir de `.env.example` e ajuste `ESCRIBA_MODEL`. Rodando Python diretamente, exporte as variáveis no terminal: o `.env` não é carregado automaticamente.

## Sobre o repositório RTK fornecido como referência

Referência analisada: **https://github.com/rtk-ai/rtk**.

O RTK é um utilitário Rust para filtrar saídas de terminal e reduzir tokens usados por agentes de programação. **Ele não contém um motor de áudio, uma interface de transcrição ou exportação de transcrições.** Por isso, não foi renomeado nem apresentado falsamente como a base de reconhecimento de fala do Escriba. O painel e o fluxo de áudio foram implementados especificamente para este projeto.

A referência está integrada como **ferramenta opcional de desenvolvimento**, sem ser uma dependência do aplicativo:

```bash
bash scripts/rtk-dev.sh
```

O script clona o RTK em `.tools/rtk` (ignorado pelo Git), preservando o código, licenças e avisos originais. A compilação requer Rust. Nada do RTK é instalado automaticamente, e ele não processa nem reduz o texto das transcrições. Nenhum componente de terceiros foi rebatizado como código próprio.

## Privacidade, segurança e limites desta versão

**Aplicação local e de usuário único.** O servidor e o processador rodam na mesma máquina. Áudios não são enviados a provedores de IA. Quando hospedado em outra máquina, o navegador envia os arquivos para esse servidor — nesse caso, “local” significa local ao servidor, não ao navegador.

Os áudios enviados e extraídos são apagados ao concluir, falhar ou cancelar. Os resultados ficam na pasta `data/jobs` por até 24 horas desde a última atualização e são removidos pela limpeza periódica (até 60 segundos de tolerância), ou pelo botão **Excluir transcrição**. O cache dos modelos permanece. Não há histórico público nem listagem de trabalhos.

O código aplica limite durante a leitura do upload, validação do ZIP, execução de FFmpeg sem shell, bloqueio de playlists/protocolos de rede, proteção de origem nas mutações, validação de host, política de conteúdo e URLs de trabalho imprevisíveis. Preferências ficam no navegador; a chave opcional de acesso ao servidor fica apenas na memória da página.

Para expor na internet, configure **HTTPS**, domínio explícito em `ESCRIBA_ALLOWED_HOSTS` e `ESCRIBA_ACCESS_TOKEN` aleatório com pelo menos 32 caracteres. O app recusa configuração de host remoto sem token adequado. Também configure limites de upload, tempo limite, autenticação e rate limiting no proxy. A configuração Compose fornecida permanece deliberadamente limitada a `127.0.0.1`.

Use **um único worker Uvicorn**. A fila é local ao processo, executa um trabalho por vez e aceita até quatro trabalhos ativos (incluindo uploads). Após reinício, trabalhos concluídos são preservados; os interrompidos são marcados como falha e precisam de reenvio. Cancelamento de uma inferência/download em andamento é cooperativo, não instantâneo. Não é uma arquitetura multiusuário distribuída.

A hospedagem de uma página estática, sozinha, **não executa o Whisper**. Este repositório precisa de um processo Python persistente ou do contêiner Docker. Nada foi publicado via Lovable ou Vercel.

## Desenvolvimento e testes

A interface usa HTML/CSS/JavaScript nativos: não precisa de Node, build de frontend, CDN ou chaves no navegador.

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

Os testes automatizados usam um reconhecedor controlado exclusivamente em `tests/` para verificar fila, ZIP, formatos de saída e erros sem baixar modelos. Existe também teste de decodificação **real por FFmpeg** com modelo de teste. **Passar esses testes não equivale a validar precisão de transcrição com Whisper real.** Faça o teste de aceite com um áudio real após instalar as dependências e baixar o modelo.

Estrutura: `escriba/app.py` (API), `jobs.py` (fila/persistência), `ingest.py` (ZIP/ordenação), `engine.py` (FFmpeg/Whisper), `export.py` (PDF/TXT), `static/` (interface), `tests/` (testes).

PDFs usam uma fonte Unicode instalada no sistema, quando disponível, sem distribuir arquivos de fonte no repositório. Na ausência dela, usam Helvetica com substituição de caracteres fora de Windows-1252. O Docker inclui DejaVu Sans pelo gerenciador de pacotes.
