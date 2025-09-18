(async function () {

  const normalizeAmount = (text, csv) => {
    if (csv) {
      var result = text.replace('.', '');
      if (result.indexOf('-') !== 0) {
        let valor = result.split(' ')[1];
        if (isNaN(valor))
          valor = result.split(' ')[1];

        return `-${valor}`;
      }
      else {
        let valor = result.split(' ')[1];
        if (isNaN(valor))
          valor = result.split(' ')[1];

        return valor.replace('-', '');
      }
    }
    else
      return text.replace('.', '').replace(',', '.');
  }

  const normalizeDay = (date) => {
    let day = (date.split(' ')[0]).trim().toString().padStart(2, '0');
    return day;
  }

  const capitalizeFirstLetter = (month) => {
    if (month) {
      month = month.toLowerCase();
      return month.charAt(0).toUpperCase() + month.slice(1);
    }

    return month;
  }

  const normalizeMonth = (date) => {
    const month = capitalizeFirstLetter(date.split(' ')[1]).trim().toLowerCase();
    const months = {
      'jan': '01',
      'fev': '02',
      'mar': '03',
      'abr': '04',
      'mai': '05',
      'jun': '06',
      'jul': '07',
      'ago': '08',
      'set': '09',
      'out': '10',
      'nov': '11',
      'dez': '12',
      'jan.': '01',
      'fev.': '02',
      'mar.': '03',
      'abr.': '04',
      'mai.': '05',
      'jun.': '06',
      'jul.': '07',
      'ago.': '08',
      'set.': '09',
      'out.': '10',
      'nov.': '11',
      'dez.': '12',
    }

    return months[month];
  }

  const normalizeYear = (date) => {
    const dateArray = date.split('/');
    if (dateArray.length > 2) {
      return dateArray[2];
    } else {
      return new Date().getFullYear();
    };
  }

  const normalizeDate = (date, csv) => {
    if (csv) {
      var month = normalizeMonth(date);
      if (month)
        return normalizeDay(date) + "/" + normalizeMonth(date) + "/" + normalizeYear(date);
      else
        return normalizeDay(date) + "/" + normalizeYear(date);
    }
    else
      return normalizeYear(date) + normalizeMonth(date) + normalizeDay(date);
  }

  const exportCsv = (csv) => {
    const period = nameFile();
    link = document.createElement("a");
    link.setAttribute("href", 'data:application/vnd.ms-excel,' + encodeURIComponent(csv));
    link.setAttribute("download", "itau-" + period + ".csv");
    link.click();
  }

  const nameFile = () => {
    const el = document.getElementsByClassName("header-invoice__tittle")[0];
    if (el && el.innerText) {
      const title = el.innerText;
      if (title.split(' ').length > 2) {
        return title.split(' ')[2];
      }
      return title;
    }
    // Fallback: yyyymmdd-hhmm when header title is not found (site changed)
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  }

  const generateCsv = () => {
    let ofx = "Data;Descricao;Valor\n"

    let datefilter = Date.parse(document.getElementById('datefilter').value);

    let section1;
    try {
      section1 =  document.querySelector("#render-mf-shell-bkl-cartoes-pf > mf-shell-bkl-cartoes-pf > mft-wc-wrapper > div > mf-cartoesconsultafaturapfmf").shadowRoot; 
    } catch (error) {
      section1 = document.querySelector("#render-mf-shell-bkl-cartoes-pf > mf-shell-bkl-cartoes-pf > mft-wc-wrapper > div > mf-cartoesconsultafaturapfmf");  
    }
  
    let section2 = section1.querySelector("#ids-tabs-0-panel-1");
    let section3 = section2.querySelector("mf-fatura-transactions-details");
    let tables = section3.querySelector("div > table");

    let rows = tables.rows;
    let time = "";
    let dataparse = "";

    for (var i = 0; i < rows.length; i++) {

      if (rows[i].cells[0].innerText.indexOf('data') !== -1) {
        continue;
      }

      let timerow = "";
      if (rows[i].cells[0].innerText !== "") {
        timerow = `${rows[i].cells[0].innerText}`;
        if (timerow == "" && time !== "") {
          timerow = time;
        }
        else {
          time = normalizeDate(timerow, true);
          dataparse = Date.parse(`${time.substr(6, 4)}-${time.substr(3, 2)}-${time.substr(0, 2)}`)
        }
      }

      if (isNaN(datefilter) || dataparse >= datefilter) {
        let desc = ""
        if (rows[i].cells[1])
          desc = `${rows[i].cells[1].innerText}`;

        let valor = ""
        if (rows[i].cells[2]) {

          if (desc.toLowerCase().indexOf("pagamento recebido") == 0)
            valor = `-${rows[i].cells[2].innerText}`;
          else
            valor = `${rows[i].cells[2].innerText}`;

          valor = normalizeAmount(valor, true);
        }

        if (valor !== "") {
          ofx += `${time};${desc};${valor}\n`;
        }
      }
    }

    exportCsv(ofx);
  }

  // UI helpers: floating button and panel with controls
  const removeIfExists = (selector) => {
    const el = document.querySelector(selector);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  };

  const createOrRecreatePanel = () => {

    // Remove any existing panel and controls
    removeIfExists('#itau-export-panel');
    // Create panel container
    const panel = document.createElement('div');
    panel.id = 'itau-export-panel';
    panel.style.cssText = [
      'position:fixed',
      'right:24px',
      'bottom:90px',
      'z-index:2147483647',
      'background:#fff',
      'border:1px solid #ddd',
      'border-radius:12px',
      'box-shadow:0 6px 20px rgba(0,0,0,0.15)',
      'padding:12px',
      'display:flex',
      'gap:8px',
      'align-items:center',
      'font-family:inherit'
    ].join(';');

    const label = document.createElement('label');
    label.setAttribute('for', 'datefilter');
    label.textContent = 'Data mínima:';
    label.style.cssText = 'margin-right:4px;color:#333;font-size:12px;';

    const newDate = document.createElement('input');
    newDate.type = 'date';
    newDate.id = 'datefilter';
    newDate.style.cssText = 'color:#FF6200;background-color:white;border:1px solid #ddd;border-radius:6px;padding:6px;';

    const btn = document.createElement('button');
    btn.setAttribute('data-role', 'gen-csv');
    btn.textContent = 'Exportar para CSV';
    btn.style.cssText = 'color:white;background-color:#FF6200;border:none;border-radius:6px;padding:8px 10px;cursor:pointer;';
    btn.addEventListener('click', generateCsv);

    panel.appendChild(label);
    panel.appendChild(newDate);
    panel.appendChild(btn);

    document.body.appendChild(panel);
  };

  const ensureFloatingButton = () => {
    let fab = document.getElementById('itau-export-fab');
    if (fab) return fab;

    fab = document.createElement('button');
    fab.id = 'itau-export-fab';
    fab.title = 'Exportar extrato (CSV)';
    fab.textContent = 'CSV';
    fab.style.cssText = [
      'position:fixed',
      'right:24px',
      'bottom:24px',
      'width:56px',
      'height:56px',
      'border-radius:50%',
      'background:#FF6200',
      'color:#fff',
      'border:none',
      'box-shadow:0 6px 12px rgba(0,0,0,0.2)',
      'cursor:pointer',
      'z-index:2147483647',
      'font-weight:700'
    ].join(';');

    fab.addEventListener('click', () => {
      const panel = document.getElementById('itau-export-panel');
      if (panel) {
        panel.remove();
      } else {
        createOrRecreatePanel();
      }
    });

    document.body.appendChild(fab);
    return fab;
  };

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function contarComDelay() {
    let contador = 0;

    while (true) {
      console.log("O contador é: " + contador);
      contador++;

      try {

        let section = document.querySelector("#render-mf-shell-bkl-cartoes-pf > mf-shell-bkl-cartoes-pf > mft-wc-wrapper > div > mf-cartoesconsultafaturapfmf").shadowRoot;
        let h1 = section.querySelector("mf-fatura-main > mf-fatura-lib > div > h1");

        console.log(h1);
        if (h1 !== null && h1 !== undefined) {
          ensureFloatingButton();
          break;
        }
      } catch (error) {
        try {

          let section = document.querySelector("#render-mf-shell-bkl-cartoes-pf > mf-shell-bkl-cartoes-pf > mft-wc-wrapper > div > mf-cartoesconsultafaturapfmf");
          let h1 = section.querySelector("mf-fatura-main > mf-fatura-lib > div > h1");

          console.log(h1);
          if (h1 !== null && h1 !== undefined) {
            ensureFloatingButton();
            break;
          }
        } catch (error) {

        }
      }

      await sleep(3000);
    }
  }

  await contarComDelay();


})();
