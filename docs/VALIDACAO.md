# Validação da primeira versão — 05/10/2026

## Verificações executadas

- `python -m pytest -q`: **27 testes passaram**. Reconhecimento de fala controlado exclusivamente nos testes, sem resultados simulados no código de produção.
- `python -m compileall -q escriba`: passou.
- `node --check escriba/static/app.js`: passou.
- FFmpeg: decodificação real de WAV gerado para o teste, com modelo de reconhecimento substituído por objeto de teste.
- PDF: geração real, extração de texto e inspeção visual da página renderizada. Acentuação em português, cabeçalho, separação de áudios e rodapé conferidos.
- Interface: renderização isolada no Chromium, em desktop e celular; configurações de formato e organização, fechamento por Escape, seleção/remoção de arquivo e estados de botões. Nenhum erro de JavaScript capturado. Somente a resposta de saúde do servidor foi simulada para esse teste visual; a API foi testada separadamente.

A suíte cobre PDF/TXT, texto corrido, timestamps, ZIP com múltiplos áudios, ordenação, datas no nome, entradas inválidas, arquivos vazios, limites, caminhos maliciosos, symlinks, compressão excessiva, falhas parciais, autenticação, validação de host/origem, fila, cancelamento, persistência e expiração dos resultados.

## Não validado neste ambiente

- A instalação do faster-whisper e o download do modelo não foram concluídos neste ambiente. Portanto **não foi executado um teste de reconhecimento com Whisper real** nem foi medida sua precisão ou velocidade.
- A imagem Docker não foi construída aqui.
- Não houve teste de navegador navegando até um servidor real: a navegação local estava bloqueada pelo ambiente. O teste visual não deve ser apresentado como teste ponta a ponta de transcrição.
- Nenhum deploy público ou alteração na Lovable/Vercel foi realizado.

## Aceite após instalar

1. Inicie pelo Docker ou pelo Python conforme o README.
2. Envie um áudio curto com fala clara em português e compare o texto com a fala.
3. Envie um ZIP contendo dois áudios conhecidos, com nomes numerados. Verifique a ordem e a presença dos dois conteúdos no documento.
4. Baixe PDF e TXT, confira acentos e experimente desativar “Separar por áudio” antes de uma nova transcrição.
5. Teste também um arquivo inválido e o cancelamento. Confirme as mensagens e a limpeza dos arquivos em `data/jobs`.

O aplicativo não deve ser considerado homologado para transcrição real antes desse aceite.
