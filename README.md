# Escriba 2 — Whisper no navegador

Painel branco e lilás para transcrever um áudio ou um ZIP com vários áudios, compilando o resultado em TXT ou PDF. ZIPs com mais de 100 áudios são divididos automaticamente em etapas de até 100, cada uma com seu próprio PDF. A versão web roda o reconhecimento **no aparelho de quem abriu o site**, usando Whisper multilingual via Transformers.js e ONNX Runtime/WebAssembly. **Sem API paga de transcrição, sem chave de IA, sem servidor de inferência e sem Supabase nesta etapa.**

## Como esta versão funciona

1. A Vercel entrega HTML, CSS e JavaScript estáticos.
2. Ao clicar em Transcrever, o navegador baixa as bibliotecas e o modelo aberto necessário. O download é de arquivos de software/pesos, não uma chamada a um serviço de transcrição.
3. Um Web Worker executa o Whisper na CPU do aparelho. O ZIP é lido localmente e seus áudios são processados um por vez, em etapas de até 100.
4. O texto fica na memória da aba. TXT e PDF são preparados no navegador.

**O áudio não é enviado à Vercel, Hugging Face, OpenAI ou Supabase pela versão web.** O aplicativo não pede microfone, não usa Web Speech API e não usa endpoint de inferência. A versão anterior Python permanece como alternativa, mas não participa do deploy web.

## Publicar na Vercel

Importe o repositório `maxeaseoficial-prog/Escriba`, branch `main`, usando a raiz do repositório.

| Configuração | Valor |
|---|---|
| Framework Preset | Other |
| Root Directory | raiz do repositório, `.` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `node --version` (não há pacotes npm para instalar) |
| Node.js | 22.x |
| Variáveis de ambiente / chaves de IA | nenhuma |

O arquivo `vercel.json` já define build, saída e cabeçalhos. Se o projeto existente estava configurado como FastAPI/Python, ajuste o preset e remova overrides antigos. Não configure `uvicorn`, Docker ou `requirements.txt` como comandos deste deploy. O build copia somente a interface web e seus assets para `dist`; não publica o backend Python.

**Deploy público ainda não foi executado pelo assistente.** A configuração foi preparada no GitHub. O teste de aceite com modelo real continua pendente; consulte `docs/VALIDACAO-WEB.md`.

## ZIPs com mais de 100 áudios

A divisão é automática e obrigatória. Antes de iniciar, o painel conta os áudios e informa as etapas. A ordem escolhida (data/nome/ordem do ZIP) é aplicada ao lote inteiro antes da divisão.

- 120 áudios: etapa 1, áudios 1–100; etapa 2, áudios 101–120. Dois PDFs.
- 200 áudios: dois PDFs de 100, sem etapa vazia.
- 250 áudios: três PDFs de 100, 100 e 50.

Cada etapa transcreve seus arquivos em sequência, gera um PDF organizado e libera o botão de download **antes de começar a etapa seguinte**. Não é preciso reenviar o ZIP nem clicar para iniciar a próxima etapa. O PDF da primeira etapa continua disponível enquanto as outras são processadas. O navegador não recebe uma sequência de downloads automáticos: use o botão de cada etapa para salvar seu PDF.

Para mais de 100 áudios, PDF e separação por áudio são obrigatórios, mesmo quando a preferência geral estiver em TXT/texto corrido. O TXT é oferecido adicionalmente por etapa. Os nomes dos PDFs incluem a etapa e o intervalo de áudios; a numeração dos áudios continua de 101 na segunda etapa. Até 100 áudios, o fluxo anterior e as preferências são mantidos.

Se a geração de um PDF falhar, o processamento **pausa antes da etapa seguinte**. O texto fica preservado na memória da aba. O botão **Tentar gerar PDF e continuar** repete a exportação e segue o restante, sem transcrever novamente os arquivos concluídos. Cancelar mantém os PDFs já gerados; a etapa interrompida é identificada como parcial. Arquivos com falha não são omitidos nem apresentados como transcritos.

Dividir em etapas não elimina os limites totais de tamanho do ZIP nem garante estabilidade/velocidade para duas horas de áudio em qualquer aparelho. Sem banco nesta etapa: fechar ou recarregar a aba perde o estado. Consulte `docs/VALIDACAO-ETAPAS.md` para os testes executados e as limitações.

## Desenvolvimento local

Node 22, sem instalar dependências:

```bash
npm run dev
# http://localhost:4173
npm test
npm run build
npm run preview
```

O acesso à internet é necessário para baixar bibliotecas e modelo no navegador. O build em si não precisa de internet. Não abra `web/index.html` via `file://`: Web Workers e módulos devem ser servidos por HTTP/HTTPS.

## Modelos e desempenho

- **Whisper Base (Equilibrado):** padrão.
- **Whisper Tiny (Leve):** opção para aparelhos limitados; pode reconhecer menos precisamente.
- **Whisper Small:** maior demanda de download, memória e CPU; precisão deve ser avaliada nos áudios reais.

Todos os modelos são multilíngues, não as variantes `.en`. Português é o idioma padrão; também há Inglês, Espanhol e detecção automática. O código usa `task: transcribe`, não tradução. Áudios longos são enviados ao pipeline em trechos sobrepostos de 30 segundos, com remontagem pelo próprio pipeline.

Esta primeira versão web usa **WebAssembly na CPU, em um Web Worker**; não exige GPU nem `SharedArrayBuffer`. A velocidade depende do computador e pode ser lenta em áudios longos. Não há garantia de tempo real. Mantenha a aba aberta e o aparelho ligado; fechar, recarregar ou suspender o dispositivo pode interromper o trabalho. O aplicativo tenta manter a tela acordada quando o navegador permite, sem garantia.

## Arquivos e limites iniciais

- Um áudio de até **1,5 GB / 8 horas**, ou um arquivo ou ZIP de até **1,5 GB**.
- Até **1.000 áudios**, **1.000 entradas** e **500 MB descompactados** por ZIP. Cada áudio também deve respeitar 1,5 GB / 8 horas.
- Extensões selecionáveis: MP3, WAV, M4A, OGG, OPUS, FLAC, AAC, WEBM, MP4 e MOV. A decodificação depende dos codecs suportados pelo navegador: extensão aceita não garante compatibilidade. Em caso de erro, use MP3/WAV ou um navegador atualizado; WMA/AIFF não são oferecidos nesta versão web.
- ZIP comum, armazenado sem compressão ou Deflate. ZIP64, multipartes, com senha, links simbólicos, caminhos inseguros, duplicatas de áudio e compressão excessiva são recusados. Tamanho real e CRC são conferidos durante a leitura.
- ZIPs são lidos com APIs nativas (`Blob`, `DecompressionStream`), um áudio por vez, sem biblioteca paga. Textos, fotos e ZIPs aninhados são ignorados com aviso. Não há leitura do `_chat.txt` nem identificação de interlocutores.
- Ordenação por nome natural, ordem do ZIP ou data reconhecida no nome. Sem data conhecida, não se inventa horário. Datas do ZIP não são consideradas datas de gravação.
- Falhas são incluídas no documento, não omitidas. Ao cancelar um lote parcialmente concluído, os resultados prontos podem ser baixados com identificação explícita dos demais arquivos não processados.

O limite de 1,5 GB vale para o arquivo inteiro, inclusive MP4/MOV, e para cada mídia extraída de um ZIP. O teto de 1,5 GB do ZIP e as 8 horas por arquivo continuam independentes. Aumentar o limite de entrada não garante concluir a transcrição de arquivos grandes em todo aparelho.

Os limites são escolhas iniciais para reduzir a pressão de memória, não uma garantia de que todo aparelho processará qualquer arquivo dentro deles. A decodificação de mídia usa o navegador; arquivos pequenos também podem representar longos áudios.

## Resultado, privacidade e dependências

O texto pode ser organizado por áudio ou corrido, com marcações de tempo opcionais. Após a transcrição, essas opções e PDF/TXT podem mudar sem executar o Whisper novamente. Revise nomes, números, repetições e trechos difíceis. Uma transcrição automática pode conter erros, inclusive em silêncio ou ruído.

As transcrições **não são persistidas**: ficam somente nesta aba. Baixe antes de fechá-la. Apenas preferências vão para `localStorage`. O botão Excluir transcrição remove o resultado da página; o navegador gerencia a liberação da memória. Os arquivos originais do usuário nunca são apagados pelo aplicativo.

O modelo pode ser mantido no cache do navegador. Esse cache pode ser recusado ou apagado pelo navegador, exigir novo download ou faltar espaço. Não há promessa de operação totalmente offline: a biblioteca JavaScript, o runtime e o modelo precisam estar disponíveis. A primeira carga pode ser grande e usar centenas de MB, dependendo do modelo.

Dependências de software abertas (não serviços de inferência):

- Transformers.js **3.8.1**, pacote completo `dist/transformers.min.js`, com ONNX Runtime incluído (Apache-2.0 / MIT): https://github.com/huggingface/transformers.js
- Modelos `Xenova/whisper-tiny`, `Xenova/whisper-base`, `Xenova/whisper-small` (conversões ONNX do Whisper): https://huggingface.co/Xenova/whisper-base
- Whisper original (MIT): https://github.com/openai/whisper
- PDF-Lib **1.17.1** (MIT), carregado somente ao gerar PDF: https://pdf-lib.js.org/

As bibliotecas são carregadas do jsDelivr e os modelos do Hugging Face. Não exigem conta/chave para os modelos públicos usados. Essas origens recebem os pedidos de download e os metadados normais de rede, não os áudios. Para auto-hospedar tudo futuramente, copie os assets completos e ajuste `web/runtime-config.js` e a CSP; os pesos não foram incorporados ao repositório. Sem tarifa por minuto de inferência não significa ausência de consumo de CPU, energia, memória, internet ou eventuais custos/limites da hospedagem.

PDFs usam Helvetica/WinAnsi, com acentuação em português. Caracteres que a fonte não suporta são substituídos por `?`, com aviso; TXT preserva Unicode. Não há distribuição de arquivos de fonte.

## Estrutura

`web/` contém a aplicação para Vercel; `worker.js` / `engine.js` executam o reconhecimento; `audio.js` decodifica a 16 kHz; `zip.js` valida e extrai; `export.js` exporta; `tests-web/` contém os testes Node. O build reaproveita o CSS e o favicon da interface original em `escriba/static/`.

A implementação local Python original está preservada em `escriba/`, `Dockerfile` e `compose.yaml`; as instruções antigas foram movidas para `docs/LOCAL-PYTHON.md`. Os 27 testes Python documentados em `docs/VALIDACAO.md` pertencem à primeira versão e não comprovam a transcrição web.

O RTK enviado como referência continua sendo uma ferramenta opcional de desenvolvimento, não um motor de reconhecimento de fala. Nenhum código foi alterado diretamente na Lovable ou no painel da Vercel.

## Vídeos grandes e divisão de PDFs

Arquivos individuais podem ter até **1,5 GB** e **8 horas**. MP4 e MOV são aceitos. A inferência do Whisper é dividida internamente em blocos de até 30 minutos para reduzir o pico de memória do motor. A decodificação inicial ainda ocorre no navegador, então arquivos muito grandes dependem da memória disponível e do codec do vídeo. MOV/MP4 com codec de áudio incompatível devem ser convertidos para MP4/AAC, MP3 ou WAV.

Quando a transcrição ultrapassa **80 páginas**, o Escriba prepara PDFs numerados em partes para facilitar o download e o compartilhamento.
