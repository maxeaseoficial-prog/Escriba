# Validação da versão web — 05/10/2026

## Executado

- `npm test`: **50 testes passaram**, sem dependências npm.
- `npm run build`: passou; saída estática em `dist`.
- `node --check` em todos os módulos de `web/`: passou.
- Servidor HTTP local: resposta HTTP 200 via curl, com os cabeçalhos de segurança configurados em `vercel.json`.
- Leitura **real** de ZIPs Deflate e sem compressão: ordem, nomes, CRC32 e conteúdo extraído conferidos; ZIP com data descriptor também testado.
- Testes de entradas inválidas: caminhos inseguros, links simbólicos, nomes duplicados, senha, CRC corrompido, expansão/tamanho, quantidade de áudios, arquivos sem áudio, cancelamento.
- Testes de datas e textos: não inventa data/horário; ordenação natural; falhas preservadas no documento; configuração multilíngue e operação `transcribe` em vez de `translate`.
- Chromium em renderização **isolada**, sem navegação até o servidor: interface desktop e celular, configurações, fechamento por Escape, seleção de arquivo, cancelamento e reabilitação de controles, resultado, exclusão e download real de TXT com texto de teste. Sem erros JavaScript capturados e sem overflow horizontal a 390 px.
- Dentro desse Chromium: decodificação real de WAV sintetizado em português por Web Audio; 100.499 amostras a 16 kHz, aproximadamente 6,28 segundos, valores finitos. Isto é decodificação, não reconhecimento de fala.
- Dentro desse Chromium: ZIP Deflate gerado, extração real, ordem e conteúdo confirmados.

## Não executado / não afirmar como validado

**O reconhecimento com o modelo Whisper real não foi executado neste ambiente.** O ambiente não resolveu domínios externos na tentativa de obter dependências (`EAI_AGAIN`), e Chromium bloqueou navegação ao servidor local com `ERR_BLOCKED_BY_ADMINISTRATOR`. O comando agent-browser também não estava instalado nem disponível no cache local. Foi usado Playwright/Chromium apenas para a renderização isolada descrita acima.

A renderização isolada usa o código real da interface com um transporte de worker controlado exclusivamente no harness de testes para testar cancelamento e estados. Nenhum reconhecedor falso ou texto predefinido foi colocado em `web/`. O código de produção importa o pipeline real de Transformers.js no Web Worker.

Não houve teste ponta a ponta, download de pesos, medição de qualidade/velocidade do reconhecimento, construção de um deployment Vercel ou alteração no painel Vercel/Lovable. A nova exportação PDF-Lib do navegador não foi executada neste ambiente; a geração PDF Python validada anteriormente é outra implementação. Nenhuma aprovação da versão Python deve ser extrapolada para a versão web.

## Aceite obrigatório após publicar

1. Importe o repositório na Vercel como Other, build `npm run build`, saída `dist`, conforme README. Confirme que `/` e `/worker.js` retornam seus conteúdos corretos, não páginas de erro.
2. Em navegador atualizado, escolha Whisper Tiny para o primeiro teste e selecione um áudio curto conhecido em português, sem informações sensíveis.
3. Clique em Transcrever, acompanhe o download de bibliotecas/pesos, aguarde o processamento e compare o texto com a fala. Falhas de rede ou WebAssembly devem aparecer como erro; uma interface bonita não comprova reconhecimento.
4. Repita com o modelo Base e o mesmo áudio; compare nomes, números e pontuação. Registre navegador, hardware e tempo total.
5. Teste um áudio com mais de 30 segundos para validar a remontagem dos trechos; depois um ZIP com dois áudios conhecidos e nomes numerados. Confira ambos e a ordem.
6. Baixe PDF e TXT, abra os arquivos e confira acentos, quebras de página e organização. Teste uma transcrição extensa e um nome de arquivo longo.
7. Cancele um lote e confirme o documento parcial. Teste um áudio corrompido e confira que não há omissão silenciosa.
8. Em Network, confirme que não há POST de áudio nem chamada a endpoint de inferência. Devem existir downloads da aplicação, bibliotecas, runtime e modelos.
9. Feche/reabra a página: resultados não devem reaparecer (não há armazenamento de transcrições). O modelo pode continuar em cache, sujeito ao navegador.

Só após esse aceite a transcrição web deve ser considerada homologada.
