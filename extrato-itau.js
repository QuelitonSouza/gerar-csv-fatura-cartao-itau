/**
 * Extensão Chrome - Exportador de Fatura Itaú
 * 
 * Extrai dados da fatura do cartão de crédito do site do Itaú
 * e exporta para CSV, OFX ou copia para clipboard.
 * 
 * Suporta Shadow DOM e Web Components utilizados pelo banco.
 * 
 * @version 3.0.0
 */
(() => {
  'use strict';

  // ============================================================================
  // CONSTANTES E CONFIGURAÇÃO
  // ============================================================================

  /**
   * Mapeamento de meses em português (abreviações) para número
   */
  const MONTHS_MAP = {
    'jan': '01', 'jan.': '01',
    'fev': '02', 'fev.': '02',
    'mar': '03', 'mar.': '03',
    'abr': '04', 'abr.': '04',
    'mai': '05', 'mai.': '05',
    'jun': '06', 'jun.': '06',
    'jul': '07', 'jul.': '07',
    'ago': '08', 'ago.': '08',
    'set': '09', 'set.': '09',
    'out': '10', 'out.': '10',
    'nov': '11', 'nov.': '11',
    'dez': '12', 'dez.': '12'
  };

  /**
   * Palavras-chave que indicam crédito (redução na fatura)
   * Verificação case-insensitive
   */
  const CREDIT_KEYWORDS = [
    'pagamento recebido',
    'pagamento',
    'estorno',
    'crédito',
    'credito',
    'devolução',
    'devolucao',
    'reembolso'
  ];

  /**
   * Timeout máximo para aguardar elementos (ms)
   */
  const OBSERVER_TIMEOUT = 30000;

  // ============================================================================
  // UTILITÁRIOS DE SHADOW DOM
  // ============================================================================

  /**
   * Busca um elemento recursivamente através de Shadow DOMs aninhados.
   * Esta função é mais resiliente a mudanças de layout pois busca por
   * seletores parciais e navega automaticamente em shadow roots.
   * 
   * @param {Element|Document} root - Elemento raiz para iniciar a busca
   * @param {string} selector - Seletor CSS para buscar
   * @param {Object} options - Opções de busca
   * @param {boolean} options.partial - Se true, busca por seletores parciais
   * @param {number} options.maxDepth - Profundidade máxima de busca (padrão: 10)
   * @returns {Element|null} - Elemento encontrado ou null
   */
  const queryShadowDOM = (root, selector, options = {}) => {
    const { partial = false, maxDepth = 10 } = options;

    if (maxDepth <= 0 || !root) return null;

    // Tenta encontrar diretamente no elemento atual
    let element = null;
    try {
      if (partial) {
        // Busca por atributo que contém o texto do seletor
        element = root.querySelector(`[class*="${selector}"], [id*="${selector}"], ${selector}`);
      } else {
        element = root.querySelector(selector);
      }
    } catch (e) {
      // Seletor inválido, ignora
    }

    if (element) return element;

    // Se o root tem shadowRoot, busca dentro dele
    if (root.shadowRoot) {
      element = queryShadowDOM(root.shadowRoot, selector, { partial, maxDepth: maxDepth - 1 });
      if (element) return element;
    }

    // Busca em todos os elementos filhos que podem ter shadowRoot
    const allElements = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const el of allElements) {
      if (el.shadowRoot) {
        element = queryShadowDOM(el.shadowRoot, selector, { partial, maxDepth: maxDepth - 1 });
        if (element) return element;
      }
    }

    return null;
  };

  /**
   * Encontra a tabela de transações navegando pelo Shadow DOM do Itaú.
   * Utiliza múltiplas estratégias de busca para maior resiliência.
   * 
   * @returns {HTMLTableElement|null} - Tabela de transações ou null
   */
  const findTransactionsTable = () => {
    // Estratégia 1: Buscar pelo componente principal de fatura
    const mainComponent = document.querySelector('mf-cartoesconsultafaturapfmf');
    if (mainComponent) {
      // Busca pela tabela de detalhes de transações
      const table = queryShadowDOM(mainComponent, 'mf-fatura-transactions-details', { partial: true });
      if (table) {
        const actualTable = queryShadowDOM(table, 'table') || table.querySelector('table');
        if (actualTable) return actualTable;
      }

      // Fallback: busca direta por tabela com classe details
      const detailsTable = queryShadowDOM(mainComponent, 'details__table', { partial: true });
      if (detailsTable && detailsTable.tagName === 'TABLE') return detailsTable;
    }

    // Estratégia 2: Buscar em shadow roots conhecidos
    const shellComponent = document.querySelector('#render-mf-shell-bkl-cartoes-pf mf-shell-bkl-cartoes-pf');
    if (shellComponent) {
      const table = queryShadowDOM(shellComponent, 'table.details__table');
      if (table) return table;
    }

    // Estratégia 3: Buscar qualquer tabela com classe de detalhes
    const anyTable = queryShadowDOM(document.body, 'details__table', { partial: true });
    if (anyTable) return anyTable;

    return null;
  };

  /**
   * Verifica se a página de fatura está carregada verificando
   * a presença do título "consulta de fatura" ou similar.
   * 
   * @returns {boolean} - true se a página está pronta
   */
  const isInvoicePageReady = () => {
    const mainComponent = document.querySelector('mf-cartoesconsultafaturapfmf');
    if (!mainComponent) return false;

    // Busca por h1 com título de fatura
    const title = queryShadowDOM(mainComponent, 'h1');
    if (title && title.textContent) {
      const text = title.textContent.toLowerCase();
      return text.includes('fatura') || text.includes('consulta');
    }

    return false;
  };

  // ============================================================================
  // FUNÇÕES DE NORMALIZAÇÃO DE DADOS
  // ============================================================================

  /**
   * Extrai o dia de uma string de data.
   * Formatos suportados: "16 set.", "16 set", "16/09/2023"
   * 
   * @param {string} dateStr - String de data
   * @returns {string} - Dia com 2 dígitos (ex: "16")
   */
  const normalizeDay = (dateStr) => {
    const trimmed = dateStr.trim();

    // Formato "DD/MM/YYYY" ou "DD/MM"
    if (trimmed.includes('/')) {
      return trimmed.split('/')[0].padStart(2, '0');
    }

    // Formato "DD mês" (ex: "16 set.")
    const parts = trimmed.split(/\s+/);
    return parts[0].padStart(2, '0');
  };

  /**
   * Extrai o mês de uma string de data e converte para número.
   * 
   * @param {string} dateStr - String de data
   * @returns {string|null} - Mês com 2 dígitos (ex: "09") ou null
   */
  const normalizeMonth = (dateStr) => {
    const trimmed = dateStr.trim().toLowerCase();

    // Formato "DD/MM/YYYY" ou "DD/MM"
    if (trimmed.includes('/')) {
      const parts = trimmed.split('/');
      if (parts.length >= 2) {
        return parts[1].padStart(2, '0');
      }
    }

    // Formato "DD mês" (ex: "16 set.")
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      const monthStr = parts[1].toLowerCase().replace('.', '');
      // Tenta com e sem ponto
      return MONTHS_MAP[monthStr] || MONTHS_MAP[monthStr + '.'] || null;
    }

    return null;
  };

  /**
   * Determina o ano correto para uma transação, considerando
   * o bug de virada de ano.
   * 
   * REGRA: Se a transação é de dezembro e estamos em janeiro,
   * a transação pertence ao ano anterior.
   * 
   * @param {string} dateStr - String de data
   * @param {number} transactionMonth - Mês da transação (1-12)
   * @returns {number} - Ano da transação
   */
  const normalizeYear = (dateStr, transactionMonth) => {
    // Se a data já contém o ano, usa ele
    if (dateStr.includes('/')) {
      const parts = dateStr.split('/');
      if (parts.length >= 3) {
        const year = parseInt(parts[2], 10);
        // Se o ano tem 2 dígitos, assume 2000s
        return year < 100 ? 2000 + year : year;
      }
    }

    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentYear = now.getFullYear();

    // Correção do bug de virada de ano:
    // Se a transação é de dezembro e estamos em janeiro,
    // a transação pertence ao ano anterior
    if (transactionMonth === 12 && currentMonth === 1) {
      return currentYear - 1;
    }

    // Se a transação é de um mês futuro no contexto atual,
    // provavelmente é do ano anterior
    // (ex: transação de nov em jan = ano anterior)
    if (transactionMonth > currentMonth + 2) {
      return currentYear - 1;
    }

    return currentYear;
  };

  /**
   * Formata uma data para o formato especificado.
   * 
   * @param {string} dateStr - String de data original
   * @param {string} format - 'csv' para DD/MM/YYYY, 'ofx' para YYYYMMDD
   * @returns {string} - Data formatada
   */
  const normalizeDate = (dateStr, format = 'csv') => {
    const day = normalizeDay(dateStr);
    const monthStr = normalizeMonth(dateStr);

    if (!monthStr) {
      console.warn('[Itau Export] Não foi possível parsear o mês de:', dateStr);
      return dateStr;
    }

    const month = parseInt(monthStr, 10);
    const year = normalizeYear(dateStr, month);

    if (format === 'ofx') {
      return `${year}${monthStr}${day}`;
    }

    // Formato CSV: DD/MM/YYYY
    return `${day}/${monthStr}/${year}`;
  };

  /**
   * Normaliza um valor monetário para número.
   * Remove formatação brasileira (R$ 1.234,56) e converte para número.
   * Usa regex para limpeza robusta.
   * 
   * @param {string} text - Texto contendo o valor
   * @returns {number} - Valor numérico
   */
  const parseAmount = (text) => {
    // Remove tudo exceto números, vírgula, ponto e hífen
    const cleaned = text.replace(/[^\d,.\-]/g, '');

    if (!cleaned) return 0;

    // Detecta formato brasileiro: último separador é vírgula
    // e pontos são separadores de milhares
    // ou formato simples sem milhares
    let normalized;

    if (cleaned.includes(',')) {
      // Formato brasileiro: 1.234,56 ou 1234,56
      normalized = cleaned
        .replace(/\./g, '')     // Remove separador de milhares
        .replace(',', '.');     // Converte vírgula decimal para ponto
    } else {
      // Formato já com ponto decimal ou sem decimais
      normalized = cleaned;
    }

    return parseFloat(normalized) || 0;
  };

  /**
   * Determina se uma transação é um crédito (reduz a fatura).
   * Verifica por palavras-chave, classes CSS e sinais no valor.
   * 
   * @param {string} description - Descrição da transação
   * @param {HTMLElement} amountCell - Célula do valor
   * @param {string} amountText - Texto do valor
   * @returns {boolean} - true se é crédito
   */
  const isCredit = (description, amountCell, amountText) => {
    const descLower = (description || '').toLowerCase();

    // Verifica palavras-chave na descrição
    for (const keyword of CREDIT_KEYWORDS) {
      if (descLower.includes(keyword)) {
        return true;
      }
    }

    // Verifica classes CSS que indicam crédito
    if (amountCell) {
      const classes = amountCell.className.toLowerCase();
      if (classes.includes('credit') || classes.includes('credito') ||
        classes.includes('positive') || classes.includes('positivo')) {
        return true;
      }

      // Verifica cor verde (pode indicar crédito)
      const style = window.getComputedStyle(amountCell);
      const color = style.color;
      if (color.includes('0, 128, 0') || // green
        color.includes('34, 139, 34') || // forestgreen
        color.includes('0, 100, 0')) { // darkgreen
        return true;
      }
    }

    // Verifica se o valor tem sinal negativo (incomum, mas possível)
    if (amountText && amountText.trim().startsWith('-')) {
      return true;
    }

    return false;
  };

  /**
   * Formata um valor para CSV (formato brasileiro com vírgula).
   * Débitos são valores positivos (aumentam a fatura).
   * Créditos são valores negativos (reduzem a fatura).
   * 
   * @param {number} amount - Valor numérico
   * @param {boolean} credit - Se é crédito
   * @returns {string} - Valor formatado para CSV
   */
  const formatAmountForCsv = (amount, credit) => {
    const absValue = Math.abs(amount);
    const formatted = absValue.toFixed(2).replace('.', ',');

    // Créditos são negativos no CSV (reduzem o saldo devedor)
    return credit ? `-${formatted}` : formatted;
  };

  /**
   * Formata um valor para OFX.
   * Segue padrão OFX: DEBIT é negativo, CREDIT é positivo.
   * 
   * @param {number} amount - Valor numérico
   * @param {boolean} credit - Se é crédito
   * @returns {string} - Valor formatado para OFX
   */
  const formatAmountForOfx = (amount, credit) => {
    const absValue = Math.abs(amount);
    // No OFX de cartão de crédito:
    // - Compras (DEBIT) são negativas (aumentam a dívida)
    // - Pagamentos (CREDIT) são positivos (reduzem a dívida)
    return credit ? absValue.toFixed(2) : `-${absValue.toFixed(2)}`;
  };

  // ============================================================================
  // EXTRAÇÃO DE DADOS
  // ============================================================================

  /**
   * Extrai todas as transações da tabela de fatura.
   * 
   * @returns {Array<Object>} - Lista de transações
   */
  const extractTransactions = () => {
    const table = findTransactionsTable();
    if (!table) {
      console.error('[Itau Export] Tabela de transações não encontrada');
      return [];
    }

    const transactions = [];
    const rows = table.rows;
    let currentDate = '';

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const cells = row.cells;

      if (!cells || cells.length < 3) continue;

      // Ignora cabeçalho
      const firstCellText = cells[0].innerText.trim().toLowerCase();
      if (firstCellText.includes('data') && firstCellText.length < 10) {
        continue;
      }

      // Extrai data (pode estar vazia se for continuação)
      const dateCell = cells[0].innerText.trim();
      if (dateCell) {
        currentDate = dateCell;
      }

      if (!currentDate) continue;

      // Extrai descrição
      const description = cells[1] ? cells[1].innerText.trim() : '';
      if (!description) continue;

      // Extrai valor
      const amountCell = cells[2];
      const amountText = amountCell ? amountCell.innerText.trim() : '';
      if (!amountText) continue;

      const amount = parseAmount(amountText);
      if (amount === 0) continue;

      const credit = isCredit(description, amountCell, amountText);

      transactions.push({
        date: currentDate,
        dateFormatted: normalizeDate(currentDate, 'csv'),
        dateOfx: normalizeDate(currentDate, 'ofx'),
        description: description.replace(/\s+/g, ' '), // Normaliza espaços
        amount,
        amountCsv: formatAmountForCsv(amount, credit),
        amountOfx: formatAmountForOfx(amount, credit),
        isCredit: credit,
        type: credit ? 'CREDIT' : 'DEBIT'
      });
    }

    console.log(`[Itau Export] Extraídas ${transactions.length} transações`);
    return transactions;
  };

  // ============================================================================
  // GERAÇÃO DE ARQUIVOS
  // ============================================================================

  /**
   * Gera o nome do arquivo baseado no período da fatura.
   * 
   * @returns {string} - Nome do período (ex: "DEZ-2023")
   */
  const getFilePeriod = () => {
    // Tenta encontrar o título da fatura
    const titleElement = document.querySelector('.header-invoice__tittle') ||
      queryShadowDOM(document.body, 'header-invoice', { partial: true });

    if (titleElement && titleElement.innerText) {
      const title = titleElement.innerText.trim();
      const parts = title.split(/\s+/);
      if (parts.length >= 3) {
        return parts[2];
      }
      if (parts.length >= 1) {
        return parts[0];
      }
    }

    // Fallback: data atual
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  };

  /**
   * Gera conteúdo CSV das transações.
   * 
   * @param {Array<Object>} transactions - Lista de transações
   * @param {Date|null} minDate - Data mínima para filtrar
   * @returns {string} - Conteúdo CSV
   */
  const generateCsvContent = (transactions, minDate = null) => {
    let csv = 'Data;Descricao;Valor\n';

    for (const tx of transactions) {
      // Aplica filtro de data se especificado
      if (minDate) {
        const txDate = new Date(
          tx.dateOfx.substring(0, 4),
          parseInt(tx.dateOfx.substring(4, 6)) - 1,
          parseInt(tx.dateOfx.substring(6, 8))
        );
        if (txDate < minDate) continue;
      }

      csv += `${tx.dateFormatted};${tx.description};${tx.amountCsv}\n`;
    }

    return csv;
  };

  /**
   * Gera conteúdo OFX das transações.
   * OFX (Open Financial Exchange) é um formato XML padrão para softwares financeiros.
   * 
   * @param {Array<Object>} transactions - Lista de transações
   * @param {Date|null} minDate - Data mínima para filtrar
   * @returns {string} - Conteúdo OFX
   */
  const generateOfxContent = (transactions, minDate = null) => {
    const now = new Date();
    const dtServer = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}120000`;

    // Encontra datas de início e fim
    let dtStart = '99999999';
    let dtEnd = '00000000';

    const filteredTx = transactions.filter(tx => {
      if (minDate) {
        const txDate = new Date(
          tx.dateOfx.substring(0, 4),
          parseInt(tx.dateOfx.substring(4, 6)) - 1,
          parseInt(tx.dateOfx.substring(6, 8))
        );
        if (txDate < minDate) return false;
      }

      if (tx.dateOfx < dtStart) dtStart = tx.dateOfx;
      if (tx.dateOfx > dtEnd) dtEnd = tx.dateOfx;

      return true;
    });

    if (filteredTx.length === 0) {
      dtStart = dtServer.substring(0, 8);
      dtEnd = dtServer.substring(0, 8);
    }

    // Gera transações OFX
    const transactionsXml = filteredTx.map((tx, index) => {
      // Gera ID único baseado na data e índice
      const fitId = `ITAU${tx.dateOfx}${String(index).padStart(6, '0')}`;

      return `
        <STMTTRN>
          <TRNTYPE>${tx.type}</TRNTYPE>
          <DTPOSTED>${tx.dateOfx}120000</DTPOSTED>
          <TRNAMT>${tx.amountOfx}</TRNAMT>
          <FITID>${fitId}</FITID>
          <MEMO>${escapeXml(tx.description)}</MEMO>
        </STMTTRN>`;
    }).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <SIGNONMSGSRSV1>
    <SONRS>
      <STATUS>
        <CODE>0</CODE>
        <SEVERITY>INFO</SEVERITY>
      </STATUS>
      <DTSERVER>${dtServer}</DTSERVER>
      <LANGUAGE>POR</LANGUAGE>
      <FI>
        <ORG>Itau</ORG>
        <FID>341</FID>
      </FI>
    </SONRS>
  </SIGNONMSGSRSV1>
  <CREDITCARDMSGSRSV1>
    <CCSTMTTRNRS>
      <TRNUID>1</TRNUID>
      <STATUS>
        <CODE>0</CODE>
        <SEVERITY>INFO</SEVERITY>
      </STATUS>
      <CCSTMTRS>
        <CURDEF>BRL</CURDEF>
        <CCACCTFROM>
          <ACCTID>ITAU-CREDIT-CARD</ACCTID>
        </CCACCTFROM>
        <BANKTRANLIST>
          <DTSTART>${dtStart}120000</DTSTART>
          <DTEND>${dtEnd}120000</DTEND>${transactionsXml}
        </BANKTRANLIST>
      </CCSTMTRS>
    </CCSTMTTRNRS>
  </CREDITCARDMSGSRSV1>
</OFX>`;
  };

  /**
   * Escapa caracteres especiais para XML.
   * 
   * @param {string} str - String para escapar
   * @returns {string} - String escapada
   */
  const escapeXml = (str) => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };

  // ============================================================================
  // EXPORTAÇÃO E CLIPBOARD
  // ============================================================================

  /**
   * Faz download de um arquivo.
   * 
   * @param {string} content - Conteúdo do arquivo
   * @param {string} filename - Nome do arquivo
   * @param {string} mimeType - Tipo MIME
   */
  const downloadFile = (content, filename, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();

    // Limpa URL após download
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /**
   * Exporta transações para CSV.
   */
  const exportCsv = () => {
    const minDate = getMinDateFilter();
    const transactions = extractTransactions();
    const csv = generateCsvContent(transactions, minDate);
    const period = getFilePeriod();

    downloadFile(csv, `itau-${period}.csv`, 'text/csv;charset=utf-8');
    showNotification('CSV exportado com sucesso!', 'success');
  };

  /**
   * Exporta transações para OFX.
   */
  const exportOfx = () => {
    const minDate = getMinDateFilter();
    const transactions = extractTransactions();
    const ofx = generateOfxContent(transactions, minDate);
    const period = getFilePeriod();

    downloadFile(ofx, `itau-${period}.ofx`, 'application/x-ofx');
    showNotification('OFX exportado com sucesso!', 'success');
  };

  /**
   * Copia transações CSV para clipboard.
   */
  const copyToClipboard = async () => {
    const minDate = getMinDateFilter();
    const transactions = extractTransactions();
    const csv = generateCsvContent(transactions, minDate);

    try {
      await navigator.clipboard.writeText(csv);
      showNotification('Copiado para a área de transferência!', 'success');
    } catch (err) {
      // Fallback para execCommand (navegadores antigos)
      const textarea = document.createElement('textarea');
      textarea.value = csv;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();

      try {
        document.execCommand('copy');
        showNotification('Copiado para a área de transferência!', 'success');
      } catch (e) {
        showNotification('Erro ao copiar. Tente novamente.', 'error');
      }

      document.body.removeChild(textarea);
    }
  };

  /**
   * Obtém a data mínima do filtro, se definida.
   * 
   * @returns {Date|null} - Data mínima ou null
   */
  const getMinDateFilter = () => {
    const dateInput = document.getElementById('itau-datefilter');
    if (dateInput && dateInput.value) {
      return new Date(dateInput.value);
    }
    return null;
  };

  // ============================================================================
  // INTERFACE DO USUÁRIO
  // ============================================================================

  /**
   * Estilos CSS da extensão.
   */
  const STYLES = {
    panel: `
      position: fixed;
      right: 24px;
      bottom: 90px;
      z-index: 2147483647;
      background: #fff;
      border: 1px solid #ddd;
      border-radius: 12px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.15);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-width: 280px;
    `,
    fab: `
      position: fixed;
      right: 24px;
      bottom: 24px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: linear-gradient(135deg, #FF6200, #FF8C00);
      color: #fff;
      border: none;
      box-shadow: 0 6px 12px rgba(255, 98, 0, 0.4);
      cursor: pointer;
      z-index: 2147483647;
      font-weight: 700;
      font-size: 12px;
      transition: transform 0.2s, box-shadow 0.2s;
    `,
    button: `
      color: white;
      background: linear-gradient(135deg, #FF6200, #FF8C00);
      border: none;
      border-radius: 8px;
      padding: 10px 16px;
      cursor: pointer;
      font-weight: 600;
      font-size: 13px;
      transition: transform 0.1s, opacity 0.1s;
    `,
    buttonSecondary: `
      color: #FF6200;
      background: #FFF3E8;
      border: 1px solid #FF6200;
      border-radius: 8px;
      padding: 10px 16px;
      cursor: pointer;
      font-weight: 600;
      font-size: 13px;
      transition: transform 0.1s, opacity 0.1s;
    `,
    input: `
      color: #333;
      background-color: white;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 13px;
      width: 100%;
      box-sizing: border-box;
    `,
    label: `
      color: #666;
      font-size: 12px;
      font-weight: 500;
      margin-bottom: 4px;
    `,
    title: `
      color: #333;
      font-size: 14px;
      font-weight: 700;
      margin: 0 0 8px 0;
      padding-bottom: 8px;
      border-bottom: 1px solid #eee;
    `,
    notification: `
      position: fixed;
      bottom: 160px;
      right: 24px;
      z-index: 2147483648;
      padding: 12px 20px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transition: opacity 0.3s, transform 0.3s;
    `
  };

  /**
   * Exibe uma notificação temporária.
   * 
   * @param {string} message - Mensagem a exibir
   * @param {string} type - Tipo: 'success', 'error', 'info'
   */
  const showNotification = (message, type = 'info') => {
    // Remove notificação anterior
    const existing = document.getElementById('itau-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.id = 'itau-notification';
    notification.textContent = message;

    const colors = {
      success: { bg: '#E8F5E9', text: '#2E7D32', border: '#4CAF50' },
      error: { bg: '#FFEBEE', text: '#C62828', border: '#F44336' },
      info: { bg: '#E3F2FD', text: '#1565C0', border: '#2196F3' }
    };

    const color = colors[type] || colors.info;
    notification.style.cssText = STYLES.notification + `
      background: ${color.bg};
      color: ${color.text};
      border: 1px solid ${color.border};
    `;

    document.body.appendChild(notification);

    // Remove após 3 segundos
    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transform = 'translateY(10px)';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  };

  /**
   * Cria ou remove o painel de controles.
   */
  const togglePanel = () => {
    const existingPanel = document.getElementById('itau-export-panel');
    if (existingPanel) {
      existingPanel.remove();
      return;
    }

    const panel = document.createElement('div');
    panel.id = 'itau-export-panel';
    panel.style.cssText = STYLES.panel;

    // Título
    const title = document.createElement('h3');
    title.textContent = '📊 Exportar Fatura';
    title.style.cssText = STYLES.title;
    panel.appendChild(title);

    // Container do filtro de data
    const dateContainer = document.createElement('div');
    dateContainer.style.cssText = 'display: flex; flex-direction: column;';

    const label = document.createElement('label');
    label.setAttribute('for', 'itau-datefilter');
    label.textContent = 'Data mínima (opcional):';
    label.style.cssText = STYLES.label;

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.id = 'itau-datefilter';
    dateInput.style.cssText = STYLES.input;

    dateContainer.appendChild(label);
    dateContainer.appendChild(dateInput);
    panel.appendChild(dateContainer);

    // Container de botões
    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 8px; margin-top: 8px;';

    // Botão CSV
    const btnCsv = document.createElement('button');
    btnCsv.textContent = '📥 Exportar CSV';
    btnCsv.style.cssText = STYLES.button;
    btnCsv.addEventListener('click', exportCsv);
    btnCsv.addEventListener('mouseenter', () => btnCsv.style.opacity = '0.9');
    btnCsv.addEventListener('mouseleave', () => btnCsv.style.opacity = '1');
    buttonsContainer.appendChild(btnCsv);

    // Botão OFX
    const btnOfx = document.createElement('button');
    btnOfx.textContent = '📥 Exportar OFX';
    btnOfx.style.cssText = STYLES.button;
    btnOfx.addEventListener('click', exportOfx);
    btnOfx.addEventListener('mouseenter', () => btnOfx.style.opacity = '0.9');
    btnOfx.addEventListener('mouseleave', () => btnOfx.style.opacity = '1');
    buttonsContainer.appendChild(btnOfx);

    // Botão Copiar
    const btnCopy = document.createElement('button');
    btnCopy.textContent = '📋 Copiar para Clipboard';
    btnCopy.style.cssText = STYLES.buttonSecondary;
    btnCopy.addEventListener('click', copyToClipboard);
    btnCopy.addEventListener('mouseenter', () => btnCopy.style.opacity = '0.9');
    btnCopy.addEventListener('mouseleave', () => btnCopy.style.opacity = '1');
    buttonsContainer.appendChild(btnCopy);

    panel.appendChild(buttonsContainer);
    document.body.appendChild(panel);
  };

  /**
   * Cria o botão flutuante (FAB).
   */
  const createFloatingButton = () => {
    // Evita duplicação
    if (document.getElementById('itau-export-fab')) return;

    const fab = document.createElement('button');
    fab.id = 'itau-export-fab';
    fab.title = 'Exportar fatura (CSV/OFX)';
    fab.textContent = 'CSV';
    fab.style.cssText = STYLES.fab;

    fab.addEventListener('mouseenter', () => {
      fab.style.transform = 'scale(1.1)';
      fab.style.boxShadow = '0 8px 16px rgba(255, 98, 0, 0.5)';
    });

    fab.addEventListener('mouseleave', () => {
      fab.style.transform = 'scale(1)';
      fab.style.boxShadow = '0 6px 12px rgba(255, 98, 0, 0.4)';
    });

    fab.addEventListener('click', togglePanel);

    document.body.appendChild(fab);
    console.log('[Itau Export] Botão flutuante criado com sucesso');
  };

  // ============================================================================
  // INICIALIZAÇÃO COM MUTATION OBSERVER
  // ============================================================================

  /**
   * Aguarda o carregamento da página de fatura usando MutationObserver.
   * Muito mais eficiente que polling com setInterval/setTimeout.
   * 
   * @returns {Promise<void>}
   */
  const waitForInvoicePage = () => {
    return new Promise((resolve, reject) => {
      // Verifica se já está pronto
      if (isInvoicePageReady()) {
        console.log('[Itau Export] Página de fatura já carregada');
        resolve();
        return;
      }

      let timeoutId;

      const observer = new MutationObserver((mutations, obs) => {
        if (isInvoicePageReady()) {
          console.log('[Itau Export] Página de fatura detectada via MutationObserver');
          obs.disconnect();
          clearTimeout(timeoutId);
          resolve();
        }
      });

      // Observa mudanças em todo o documento
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: false
      });

      // Timeout de segurança
      timeoutId = setTimeout(() => {
        observer.disconnect();
        // Mesmo com timeout, tenta criar o botão se houver qualquer conteúdo de fatura
        if (document.querySelector('mf-cartoesconsultafaturapfmf')) {
          console.log('[Itau Export] Timeout, mas componente de fatura encontrado');
          resolve();
        } else {
          console.log('[Itau Export] Timeout - página de fatura não encontrada');
          reject(new Error('Timeout aguardando página de fatura'));
        }
      }, OBSERVER_TIMEOUT);
    });
  };

  /**
   * Inicializa a extensão.
   */
  const init = async () => {
    console.log('[Itau Export] Inicializando extensão v3.0.0...');

    try {
      await waitForInvoicePage();
      createFloatingButton();
    } catch (error) {
      console.log('[Itau Export] Não foi possível inicializar:', error.message);
      // Não é um erro crítico - pode não estar na página de fatura
    }
  };

  // Inicia a extensão
  init();

})();
