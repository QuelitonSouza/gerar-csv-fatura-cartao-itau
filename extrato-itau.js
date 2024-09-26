(async function () {

  const normalizeAmount = (text, csv) => {
    if (csv) {
      var result = text.replace('.', '');
      if (result.indexOf('-') !== 0) {
        result = result.split(' ')[1];
        return `-${result}`;
      }
      else {
        result = result.split(' ')[1];
        return result.replace('-', '');
      }
    }
    else
      return text.replace('.', '').replace(',', '.');
  }

  const normalizeDay = (date) => {
    let day = (date.split('/')[0]).trim().toString().padStart(2, '0');
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
    const month = capitalizeFirstLetter(date.split('/')[1]).trim().toLowerCase();
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
    let title = document.getElementsByClassName("header-invoice__tittle")[0].innerText;

    if (title.split(' ').length > 2) {
      return title.split(' ')[2];
    }

    return title;
  }

  const generateCsv = () => {
    let ofx = "Data;Descricao;Valor\n"

    let datefilter = Date.parse(document.getElementById('datefilter').value);
    let tables = document.getElementsByClassName("fatura__table fatura__table--agrupada");

    for (var x = 0; x < tables.length; x++) {

      let rows = tables[x].rows;
      let time = "";
      let dataparse = "";

      for (var i = 0; i < rows.length; i++) {

        if (rows[i].cells[0].innerText.indexOf('data') == 0) {
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
    }

    exportCsv(ofx);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function contarComDelay() {
    let contador = 0;

    while (true) {
      console.log("O contador é: " + contador);
      contador++;

      let div = document.getElementsByClassName("header-invoice-details header-invoice-details--align header-invoice-details--mrg-sm")[0];
      console.log(div);
      if (div !== null && div !== undefined) {
        let newDate = document.createElement("input");
        newDate.setAttribute("type", "date");
        newDate.setAttribute("id", "datefilter");
        newDate.style.cssText = 'color:#FF6200;background-color:white;position:absolute;top:0.3%;right:30%;z-index: 999999;padding:3px';
        div.appendChild(newDate);

        let btn = document.createElement("button");
        btn.innerHTML = "Exportar para CSV";
        btn.style.cssText = 'color:white;background-color:#FF6200;position:absolute;top:0.3%;right:45%;z-index: 999999;padding:4px;margin-right:4px';
        btn.setAttribute('role', 'gen-csv');
        btn.textContent = "Exportar para CSV";
        btn.addEventListener('click', generateCsv);
        div.appendChild(btn);

        break;
      }

      await sleep(3000);
    }
  }

  await contarComDelay();

})();

