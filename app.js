(() => {
  'use strict';

  const STORAGE_KEYS = {
    TX: 'hkd_transactions',
    BUDGETS: 'hkd_budgets'
  };

  const EXPENSE_CATEGORIES = [
    "Oziq-ovqat", "Transport", "Kommunal to'lovlar", "Kiyim-kechak",
    "Sog'liqni saqlash", "Ta'lim", "Ko'ngilochar", "Boshqa"
  ];

  const INCOME_CATEGORIES = [
    "Maosh", "Frilans/Qo'shimcha", "Sovg'a", "Investitsiya", "Boshqa daromad"
  ];

  const DONUT_COLORS = [
    '#d4af37', '#b8763e', '#e5534b', '#3ecf8e', '#4a90d9',
    '#9b6bd4', '#e0952f', '#5fb3c4'
  ];

  // ---------- State ----------
  let transactions = loadTransactions();
  let budgets = loadBudgets();
  let pendingConfirmAction = null;
  let donutChartInstance = null;
  let barChartInstance = null;

  // ---------- Persistence ----------
  function loadTransactions() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.TX);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function loadBudgets() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.BUDGETS);
      const parsed = raw ? JSON.parse(raw) : {};
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveTransactions() {
    localStorage.setItem(STORAGE_KEYS.TX, JSON.stringify(transactions));
  }

  function saveBudgets() {
    localStorage.setItem(STORAGE_KEYS.BUDGETS, JSON.stringify(budgets));
  }

  // ---------- Helpers ----------
  function formatSom(amount) {
    const sign = amount < 0 ? '-' : '';
    const abs = Math.round(Math.abs(amount));
    const str = String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${sign}${str} so'm`;
  }

  function genId() {
    return `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function todayStr() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function currentMonthStr() {
    return todayStr().slice(0, 7);
  }

  function monthLabel(monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    const names = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
      'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
    return `${names[m - 1]} ${y}`;
  }

  function shiftMonth(monthStr, delta) {
    const [y, m] = monthStr.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { toast.hidden = true; }, 2600);
  }

  // ---------- DOM refs ----------
  const form = document.getElementById('transactionForm');
  const btnExpense = document.getElementById('btnExpense');
  const btnIncome = document.getElementById('btnIncome');
  const txType = document.getElementById('txType');
  const txAmount = document.getElementById('txAmount');
  const txCategory = document.getElementById('txCategory');
  const txDate = document.getElementById('txDate');
  const txNote = document.getElementById('txNote');
  const formError = document.getElementById('formError');

  const totalBalanceEl = document.getElementById('totalBalance');
  const monthlyIncomeEl = document.getElementById('monthlyIncome');
  const monthlyExpenseEl = document.getElementById('monthlyExpense');

  const budgetListEl = document.getElementById('budgetList');
  const monthSelector = document.getElementById('monthSelector');

  const searchInput = document.getElementById('searchInput');
  const filterType = document.getElementById('filterType');
  const filterCategory = document.getElementById('filterCategory');
  const txTableBody = document.getElementById('txTableBody');
  const historyEmpty = document.getElementById('historyEmpty');

  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const clearAllBtn = document.getElementById('clearAllBtn');

  const confirmModal = document.getElementById('confirmModal');
  const modalMessage = document.getElementById('modalMessage');
  const modalCancelBtn = document.getElementById('modalCancelBtn');
  const modalConfirmBtn = document.getElementById('modalConfirmBtn');

  // ---------- Init ----------
  function init() {
    txDate.value = todayStr();
    txDate.max = todayStr();
    monthSelector.value = currentMonthStr();

    populateCategorySelect();
    populateFilterCategoryOptions();

    form.addEventListener('submit', onSubmit);
    btnExpense.addEventListener('click', () => setType('expense'));
    btnIncome.addEventListener('click', () => setType('income'));

    monthSelector.addEventListener('change', () => {
      renderCharts();
    });

    searchInput.addEventListener('input', renderHistory);
    filterType.addEventListener('change', renderHistory);
    filterCategory.addEventListener('change', renderHistory);

    exportCsvBtn.addEventListener('click', exportCsv);
    clearAllBtn.addEventListener('click', () => {
      openConfirmModal("Barcha ma'lumotlar butunlay o'chiriladi. Davom etasizmi?", () => {
        transactions = [];
        budgets = {};
        saveTransactions();
        saveBudgets();
        renderAll();
        showToast("Barcha ma'lumotlar tozalandi");
      });
    });

    modalCancelBtn.addEventListener('click', closeConfirmModal);
    modalConfirmBtn.addEventListener('click', () => {
      if (pendingConfirmAction) pendingConfirmAction();
      closeConfirmModal();
    });
    confirmModal.addEventListener('click', (e) => {
      if (e.target === confirmModal) closeConfirmModal();
    });

    renderAll();
  }

  function setType(type) {
    txType.value = type;
    btnExpense.classList.toggle('active', type === 'expense');
    btnIncome.classList.toggle('active', type === 'income');
    populateCategorySelect();
  }

  function populateCategorySelect() {
    const list = txType.value === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    txCategory.innerHTML = list.map(c => `<option value="${c}">${c}</option>`).join('');
  }

  function populateFilterCategoryOptions() {
    const all = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];
    filterCategory.innerHTML = '<option value="all">Barcha toifalar</option>' +
      all.map(c => `<option value="${c}">${c}</option>`).join('');
  }

  // ---------- Form submit ----------
  function onSubmit(e) {
    e.preventDefault();
    formError.textContent = '';

    const amountVal = Number(txAmount.value);
    const dateVal = txDate.value;
    const categoryVal = txCategory.value;
    const noteVal = txNote.value.trim();

    if (!amountVal || amountVal <= 0 || !Number.isFinite(amountVal)) {
      formError.textContent = "Summani to'g'ri kiriting (musbat son bo'lishi kerak)";
      return;
    }
    if (!dateVal) {
      formError.textContent = 'Sanani tanlang';
      return;
    }
    if (dateVal > todayStr()) {
      formError.textContent = "Sana kelajakda bo'lishi mumkin emas";
      return;
    }
    if (!categoryVal) {
      formError.textContent = 'Toifani tanlang';
      return;
    }

    const tx = {
      id: genId(),
      type: txType.value,
      amount: Math.round(amountVal),
      category: categoryVal,
      date: dateVal,
      note: noteVal
    };

    transactions.push(tx);
    saveTransactions();

    form.reset();
    txDate.value = todayStr();
    setType(txType.value === 'income' ? 'income' : 'expense');

    renderAll();
    showToast("Yozuv qo'shildi");
  }

  // ---------- Rendering ----------
  function renderAll() {
    renderSummary();
    renderBudgets();
    renderCharts();
    renderHistory();
  }

  function renderSummary() {
    let totalBalance = 0;
    let monthlyIncome = 0;
    let monthlyExpense = 0;
    const curMonth = currentMonthStr();

    for (const tx of transactions) {
      const signed = tx.type === 'income' ? tx.amount : -tx.amount;
      totalBalance += signed;
      if (tx.date.slice(0, 7) === curMonth) {
        if (tx.type === 'income') monthlyIncome += tx.amount;
        else monthlyExpense += tx.amount;
      }
    }

    totalBalanceEl.textContent = formatSom(totalBalance);
    monthlyIncomeEl.textContent = formatSom(monthlyIncome);
    monthlyExpenseEl.textContent = formatSom(monthlyExpense);
  }

  function renderBudgets() {
    const curMonth = currentMonthStr();
    const spentByCategory = {};
    for (const tx of transactions) {
      if (tx.type === 'expense' && tx.date.slice(0, 7) === curMonth) {
        spentByCategory[tx.category] = (spentByCategory[tx.category] || 0) + tx.amount;
      }
    }

    const frag = document.createDocumentFragment();
    for (const cat of EXPENSE_CATEGORIES) {
      const spent = spentByCategory[cat] || 0;
      const limit = budgets[cat] || 0;
      const percent = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;

      const item = document.createElement('div');
      item.className = 'budget-item';

      const top = document.createElement('div');
      top.className = 'budget-item-top';
      top.innerHTML = `
        <span class="cat-name">${cat}</span>
        <span class="cat-amounts">${formatSom(spent)}${limit > 0 ? ' / ' + formatSom(limit) : ''}</span>
      `;

      const track = document.createElement('div');
      track.className = 'progress-track';
      const fill = document.createElement('div');
      fill.className = 'progress-fill';
      fill.style.width = percent + '%';
      if (limit > 0) {
        const ratio = spent / limit;
        if (ratio >= 1) fill.classList.add('danger');
        else if (ratio >= 0.7) fill.classList.add('warn');
      }
      track.appendChild(fill);

      const limitRow = document.createElement('div');
      limitRow.className = 'budget-item-top';
      limitRow.innerHTML = `<span class="cat-amounts">Limit belgilash:</span>`;
      const limitInput = document.createElement('input');
      limitInput.type = 'number';
      limitInput.min = '0';
      limitInput.className = 'budget-limit-input';
      limitInput.placeholder = 'Limit';
      limitInput.value = limit > 0 ? limit : '';
      limitInput.addEventListener('change', () => {
        const val = Number(limitInput.value);
        if (val > 0 && Number.isFinite(val)) {
          budgets[cat] = Math.round(val);
        } else {
          delete budgets[cat];
        }
        saveBudgets();
        renderBudgets();
      });
      limitRow.appendChild(limitInput);

      item.appendChild(top);
      item.appendChild(track);
      item.appendChild(limitRow);
      frag.appendChild(item);
    }

    budgetListEl.innerHTML = '';
    budgetListEl.appendChild(frag);
  }

  function renderCharts() {
    renderDonutChart();
    renderBarChart();
  }

  function renderDonutChart() {
    const selectedMonth = monthSelector.value || currentMonthStr();
    const totals = {};
    for (const tx of transactions) {
      if (tx.type === 'expense' && tx.date.slice(0, 7) === selectedMonth) {
        totals[tx.category] = (totals[tx.category] || 0) + tx.amount;
      }
    }
    const labels = Object.keys(totals);
    const data = Object.values(totals);

    const canvas = document.getElementById('donutChart');
    const emptyEl = document.getElementById('donutEmpty');

    if (labels.length === 0) {
      if (donutChartInstance) { donutChartInstance.destroy(); donutChartInstance = null; }
      canvas.hidden = true;
      emptyEl.hidden = false;
      return;
    }
    canvas.hidden = false;
    emptyEl.hidden = true;

    if (donutChartInstance) donutChartInstance.destroy();
    donutChartInstance = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: labels.map((_, i) => DONUT_COLORS[i % DONUT_COLORS.length]),
          borderColor: '#10233d',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#eef2f7', boxWidth: 12, padding: 12, font: { size: 11 } }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${formatSom(ctx.raw)}`
            }
          }
        }
      }
    });
  }

  function renderBarChart() {
    const anchor = monthSelector.value || currentMonthStr();
    const months = [];
    for (let i = 5; i >= 0; i--) months.push(shiftMonth(anchor, -i));

    const incomeData = months.map(m =>
      transactions.filter(tx => tx.type === 'income' && tx.date.slice(0, 7) === m)
        .reduce((s, tx) => s + tx.amount, 0)
    );
    const expenseData = months.map(m =>
      transactions.filter(tx => tx.type === 'expense' && tx.date.slice(0, 7) === m)
        .reduce((s, tx) => s + tx.amount, 0)
    );

    const canvas = document.getElementById('barChart');
    const emptyEl = document.getElementById('barEmpty');
    const hasData = incomeData.some(v => v > 0) || expenseData.some(v => v > 0);

    if (!hasData) {
      if (barChartInstance) { barChartInstance.destroy(); barChartInstance = null; }
      canvas.hidden = true;
      emptyEl.hidden = false;
      return;
    }
    canvas.hidden = false;
    emptyEl.hidden = true;

    if (barChartInstance) barChartInstance.destroy();
    barChartInstance = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: months.map(m => monthLabel(m)),
        datasets: [
          { label: 'Daromad', data: incomeData, backgroundColor: '#3ecf8e' },
          { label: 'Xarajat', data: expenseData, backgroundColor: '#e5534b' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#9db0c7' }, grid: { color: '#23405f' } },
          y: { ticks: { color: '#9db0c7' }, grid: { color: '#23405f' } }
        },
        plugins: {
          legend: { labels: { color: '#eef2f7' } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${formatSom(ctx.raw)}`
            }
          }
        }
      }
    });
  }

  function getFilteredTransactions() {
    const search = searchInput.value.trim().toLowerCase();
    const type = filterType.value;
    const category = filterCategory.value;

    return transactions
      .filter(tx => {
        if (type !== 'all' && tx.type !== type) return false;
        if (category !== 'all' && tx.category !== category) return false;
        if (search) {
          const hay = `${tx.note} ${tx.category}`.toLowerCase();
          if (!hay.includes(search)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return a.id < b.id ? 1 : -1;
      });
  }

  function renderHistory() {
    const filtered = getFilteredTransactions();

    if (filtered.length === 0) {
      txTableBody.innerHTML = '';
      historyEmpty.hidden = false;
      return;
    }
    historyEmpty.hidden = true;

    const frag = document.createDocumentFragment();
    for (const tx of filtered) {
      const tr = document.createElement('tr');

      const tdDate = document.createElement('td');
      tdDate.textContent = tx.date;

      const tdType = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `type-badge ${tx.type}`;
      badge.textContent = tx.type === 'income' ? 'Daromad' : 'Xarajat';
      tdType.appendChild(badge);

      const tdCategory = document.createElement('td');
      tdCategory.textContent = tx.category;

      const tdNote = document.createElement('td');
      tdNote.textContent = tx.note || '—';

      const tdAmount = document.createElement('td');
      tdAmount.className = `text-right amount-cell ${tx.type}`;
      tdAmount.textContent = (tx.type === 'income' ? '+' : '-') + formatSom(tx.amount);

      const tdActions = document.createElement('td');
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'row-delete-btn';
      delBtn.title = "O'chirish";
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', () => {
        openConfirmModal("Ushbu yozuvni o'chirmoqchimisiz?", () => {
          transactions = transactions.filter(t => t.id !== tx.id);
          saveTransactions();
          renderAll();
          showToast("Yozuv o'chirildi");
        });
      });
      tdActions.appendChild(delBtn);

      tr.append(tdDate, tdType, tdCategory, tdNote, tdAmount, tdActions);
      frag.appendChild(tr);
    }

    txTableBody.innerHTML = '';
    txTableBody.appendChild(frag);
  }

  // ---------- CSV export ----------
  function exportCsv() {
    if (transactions.length === 0) {
      showToast("Eksport qilish uchun ma'lumot yo'q");
      return;
    }
    const header = ['Sana', 'Turi', 'Toifa', 'Izoh', 'Summa'];
    const rows = [...transactions]
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map(tx => [
        tx.date,
        tx.type === 'income' ? 'Daromad' : 'Xarajat',
        tx.category,
        (tx.note || '').replace(/"/g, '""'),
        tx.amount
      ]);

    const csvLines = [header, ...rows].map(cols =>
      cols.map(c => `"${String(c)}"`).join(',')
    );
    const csvContent = '﻿' + csvLines.join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hisob-kitob-daftari_${todayStr()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------- Confirm modal ----------
  function openConfirmModal(message, onConfirm) {
    modalMessage.textContent = message;
    pendingConfirmAction = onConfirm;
    confirmModal.hidden = false;
  }

  function closeConfirmModal() {
    confirmModal.hidden = true;
    pendingConfirmAction = null;
  }

  document.addEventListener('DOMContentLoaded', init);
})();
