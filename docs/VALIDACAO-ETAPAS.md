# Etapas automáticas de 100 áudios — 05/10/2026

Base conferida: commit `724b53c9ce58a220e2b8b9a172cfe911f24e441a`, árvore `0a7b9d9bdc5745bcf2e9580b5f068286f253cd70`.

## Implementado

ZIPs com mais de 100 áudios passam pelo leitor, mantendo limites de segurança. A ordenação global precede a divisão. Cada etapa tem no máximo 100 áudios, resultado próprio, numeração global e PDF próprio. O primeiro PDF é disponibilizado antes do áudio 101. A próxima etapa começa sem reenvio. Erro na geração do PDF pausa a sequência, preserva texto e permite repetir apenas a exportação. Cancelar preserva PDFs concluídos e identifica resultados parciais. Não há persistência após fechar/recarregar a aba.

## Verificações executadas

- `npm test`: **86 testes passaram**. Os testes de orquestração substituem somente reconhecimento e exportação por adaptadores controlados. Não são evidência de precisão de Whisper nem de bytes PDF válidos.
- Leitura e extração reais de ZIPs Deflate com 100, 101, 120, 200, 201 e 1.000 entradas de áudio: quantidade, ordem natural e conteúdo conferidos. Os demais testes de ZIP malicioso, CRC, tamanho e cancelamento continuam passando.
- Planejamento de 1, 99, 100, 101, 120, 200, 201, 250 e 1.000 áudios; nenhuma etapa acima de 100 ou etapa extra vazia.
- Processamento controlado de 120 áudios: 100 + 20, execução sequencial, sem repetição/omissão, primeiro evento de PDF disponível antes do áudio 101. Numeração 101–120 no segundo documento.
- Falha no primeiro PDF: pausa em 100; repetição da exportação prossegue até 120 sem repetir reconhecimentos. Falha no segundo PDF não invalida o primeiro. PDF vazio não é considerado sucesso.
- Cancelamento na segunda etapa, na fronteira entre etapas e durante exportação; falha de um áudio preservada como erro, sem bloquear as próximas etapas.
- `npm run build` e `node --check` em todos os módulos web: passaram.
- Chromium via Playwright, em renderização isolada: código real de interface, ZIP, decodificação WAV e orquestrador, com transporte Whisper e criação PDF controlados somente no harness de teste. Aviso ao selecionar ZIP de 120, primeiro botão antes do áudio 101, dois botões ao concluir, nomes dos downloads, pausa/repetição, cancelamento, documento parcial e regressão de áudio único conferidos.
- Desktop 1440 px e celular 390 px: sem erros JavaScript capturados; sem overflow horizontal no celular. A transferência do Blob de teste pelo botão de download foi confirmada (não é um PDF real).

## Limitações desta validação

Não houve inferência com Whisper real, processamento das duas horas do usuário ou geração de PDF real por PDF-Lib. O ambiente não resolveu o domínio externo das bibliotecas, `agent-browser` não estava instalado e a navegação Chromium até localhost foi bloqueada por `ERR_BLOCKED_BY_ADMINISTRATOR`. A renderização isolada descrita acima não contorna essa limitação nem equivale a um teste ponta a ponta do site publicado.

Nenhum reconhecedor falso, conteúdo predefinido ou gerador de PDF de teste foi colocado na aplicação de produção. Os adaptadores controlados existem apenas nos testes.

## Aceite após o deploy

1. Transcrever um áudio curto real e abrir o PDF para validar o motor e PDF-Lib no navegador.
2. Selecionar um ZIP real de 120 áudios dentro dos limites; conferir o aviso de duas etapas.
3. Confirmar primeiro PDF com 100 áudios e segundo com os 20 restantes, na ordem e sem omissões. Conferir acentos, páginas e arquivos com falha.
4. Baixar o primeiro PDF enquanto a segunda etapa ainda processa. Confirmar que interromper a segunda não remove o primeiro.
5. Avaliar tempo e uso de memória no aparelho-alvo. Não declarar homologado para um lote de duas horas antes desse teste.

Somente o código no GitHub foi atualizado. Sem alteração direta em Lovable, Vercel ou Supabase.
