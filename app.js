(() => {
  'use strict';

  const STORAGE_KEYS = {
    TX: 'hkd_transactions',
    BUDGETS: 'hkd_budgets',
    CATEGORIES: 'hkd_categories'
  };

  const DEFAULT_EXPENSE_CATEGORIES = [
    "Oziq-ovqat", "Transport", "Kommunal to'lovlar", "Kiyim-kechak",
    "Sog'liqni saqlash", "Ta'lim", "Ko'ngilochar", "Boshqa"
  ];

  const DEFAULT_INCOME_CATEGORIES = [
    "Maosh", "Frilans/Qo'shimcha", "Sovg'a", "Investitsiya", "Boshqa daromad"
  ];

  const DONUT_COLORS = [
    '#d4af37', '#b8763e', '#e5534b', '#3ecf8e', '#4a90d9',
    '#9b6bd4', '#e0952f', '#5fb3c4'
  ];

  // ---------- State ----------
  let transactions = loadTransactions();
  let budgets = loadBudgets();
  let categories = loadCategories();
  let pendingConfirmAction = null;
  let donutChartInstance = null;
  let barChartInstance = null;
  let editingId = null;
  let categoryModalType = 'expense';
  let renamingCategory = null;
  let viewMode = 'month';
  let selectedYear = new Date().getFullYear();

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

  function loadCategories() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CATEGORIES);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.expense) && Array.isArray(parsed.income)) {
          return parsed;
        }
      }
    } catch {
      // fall through to seed defaults
    }
    const seeded = {
      expense: [...DEFAULT_EXPENSE_CATEGORIES],
      income: [...DEFAULT_INCOME_CATEGORIES]
    };
    localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(seeded));
    return seeded;
  }

  function saveTransactions() {
    localStorage.setItem(STORAGE_KEYS.TX, JSON.stringify(transactions));
  }

  function saveBudgets() {
    localStorage.setItem(STORAGE_KEYS.BUDGETS, JSON.stringify(budgets));
  }

  function saveCategories() {
    localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(categories));
  }

  function getCategories(type) {
    return categories[type];
  }

  function addCategory(type, rawName) {
    const name = rawName.trim();
    if (!name) {
      showToast('Toifa nomini kiriting');
      return false;
    }
    if (name.length > 30) {
      showToast("Toifa nomi 30 belgidan oshmasligi kerak");
      return false;
    }
    const exists = categories[type].some(c => c.toLowerCase() === name.toLowerCase());
    if (exists) {
      showToast('Bunday toifa allaqachon mavjud');
      return false;
    }
    categories[type].push(name);
    saveCategories();
    return true;
  }

  function renameCategory(type, oldName, rawNewName) {
    const newName = rawNewName.trim();
    if (!newName) {
      showToast('Toifa nomini kiriting');
      return false;
    }
    if (newName.length > 30) {
      showToast("Toifa nomi 30 belgidan oshmasligi kerak");
      return false;
    }
    const duplicate = categories[type].some(c => c.toLowerCase() === newName.toLowerCase() && c !== oldName);
    if (duplicate) {
      showToast('Bunday toifa allaqachon mavjud');
      return false;
    }
    if (newName === oldName) return true;

    const idx = categories[type].indexOf(oldName);
    if (idx === -1) return false;
    categories[type][idx] = newName;

    for (const tx of transactions) {
      if (tx.type === type && tx.category === oldName) tx.category = newName;
    }
    if (type === 'expense' && Object.prototype.hasOwnProperty.call(budgets, oldName)) {
      budgets[newName] = budgets[oldName];
      delete budgets[oldName];
    }

    saveCategories();
    saveTransactions();
    saveBudgets();
    return true;
  }

  function deleteCategory(type, name) {
    if (categories[type].length <= 1) {
      showToast("Kamida bitta toifa qolishi kerak");
      return;
    }
    const usageCount = transactions.filter(t => t.type === type && t.category === name).length;

    const performDelete = () => {
      categories[type] = categories[type].filter(c => c !== name);
      const fallback = categories[type][categories[type].length - 1];
      if (usageCount > 0) {
        for (const tx of transactions) {
          if (tx.type === type && tx.category === name) tx.category = fallback;
        }
        saveTransactions();
      }
      if (type === 'expense' && Object.prototype.hasOwnProperty.call(budgets, name)) {
        delete budgets[name];
        saveBudgets();
      }
      saveCategories();
      renderCategoryList();
      populateCategorySelect();
      populateFilterCategoryOptions();
      renderAll();
    };

    if (usageCount > 0) {
      const fallbackPreview = categories[type][categories[type].length - 1] === name
        ? categories[type][categories[type].length - 2]
        : categories[type][categories[type].length - 1];
      openConfirmModal(
        `"${name}" toifasiga tegishli ${usageCount} ta yozuv "${fallbackPreview}"ga ko'chiriladi. Davom etasizmi?`,
        performDelete
      );
    } else {
      performDelete();
    }
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
  const submitBtn = document.getElementById('submitBtn');
  const cancelEditBtn = document.getElementById('cancelEditBtn');

  const totalBalanceEl = document.getElementById('totalBalance');
  const monthlyIncomeEl = document.getElementById('monthlyIncome');
  const monthlyExpenseEl = document.getElementById('monthlyExpense');

  const budgetListEl = document.getElementById('budgetList');
  const monthSelector = document.getElementById('monthSelector');
  const yearSelector = document.getElementById('yearSelector');
  const viewModeMonthBtn = document.getElementById('viewModeMonthBtn');
  const viewModeYearBtn = document.getElementById('viewModeYearBtn');
  const donutChartTitle = document.getElementById('donutChartTitle');
  const barChartTitle = document.getElementById('barChartTitle');
  const statAvgDaily = document.getElementById('statAvgDaily');
  const statAvgMonthly = document.getElementById('statAvgMonthly');
  const statSavingsRate = document.getElementById('statSavingsRate');
  const topCategoriesList = document.getElementById('topCategoriesList');
  const topCategoriesEmpty = document.getElementById('topCategoriesEmpty');

  const searchInput = document.getElementById('searchInput');
  const filterType = document.getElementById('filterType');
  const filterCategory = document.getElementById('filterCategory');
  const txTableBody = document.getElementById('txTableBody');
  const historyEmpty = document.getElementById('historyEmpty');

  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const exportJsonBtn = document.getElementById('exportJsonBtn');
  const importJsonBtn = document.getElementById('importJsonBtn');
  const importFileInput = document.getElementById('importFileInput');
  const clearAllBtn = document.getElementById('clearAllBtn');

  const importModal = document.getElementById('importModal');
  const importModalMessage = document.getElementById('importModalMessage');
  const importCancelBtn = document.getElementById('importCancelBtn');
  const importMergeBtn = document.getElementById('importMergeBtn');
  const importReplaceBtn = document.getElementById('importReplaceBtn');
  let pendingImport = null;

  const confirmModal = document.getElementById('confirmModal');
  const modalMessage = document.getElementById('modalMessage');
  const modalCancelBtn = document.getElementById('modalCancelBtn');
  const modalConfirmBtn = document.getElementById('modalConfirmBtn');

  const manageCategoriesBtn = document.getElementById('manageCategoriesBtn');
  const categoryModal = document.getElementById('categoryModal');
  const categoryListEl = document.getElementById('categoryListEl');
  const catTypeIncomeBtn = document.getElementById('catTypeIncomeBtn');
  const catTypeExpenseBtn = document.getElementById('catTypeExpenseBtn');
  const newCategoryInput = document.getElementById('newCategoryInput');
  const addCategoryBtn = document.getElementById('addCategoryBtn');
  const categoryModalCloseBtn = document.getElementById('categoryModalCloseBtn');

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
      renderAdvancedStats();
      renderTopCategories();
    });

    viewModeMonthBtn.addEventListener('click', () => setViewMode('month'));
    viewModeYearBtn.addEventListener('click', () => setViewMode('year'));
    yearSelector.addEventListener('change', () => {
      selectedYear = Number(yearSelector.value);
      renderCharts();
      renderAdvancedStats();
      renderTopCategories();
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

    cancelEditBtn.addEventListener('click', exitEditMode);

    manageCategoriesBtn.addEventListener('click', () => {
      categoryModalType = txType.value === 'income' ? 'income' : 'expense';
      setCategoryModalType(categoryModalType);
      categoryModal.hidden = false;
    });
    categoryModalCloseBtn.addEventListener('click', () => { categoryModal.hidden = true; });
    categoryModal.addEventListener('click', (e) => {
      if (e.target === categoryModal) categoryModal.hidden = true;
    });
    catTypeIncomeBtn.addEventListener('click', () => setCategoryModalType('income'));
    catTypeExpenseBtn.addEventListener('click', () => setCategoryModalType('expense'));
    addCategoryBtn.addEventListener('click', () => {
      if (addCategory(categoryModalType, newCategoryInput.value)) {
        newCategoryInput.value = '';
        renderCategoryList();
        populateCategorySelect();
        populateFilterCategoryOptions();
        renderAll();
      }
    });
    newCategoryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addCategoryBtn.click(); }
    });

    exportJsonBtn.addEventListener('click', exportJson);
    importJsonBtn.addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', handleImportFileChange);
    importCancelBtn.addEventListener('click', closeImportModal);
    importModal.addEventListener('click', (e) => {
      if (e.target === importModal) closeImportModal();
    });
    importMergeBtn.addEventListener('click', () => {
      if (pendingImport) {
        mergeImportedData(pendingImport);
        showToast("Ma'lumotlar birlashtirildi");
      }
      closeImportModal();
    });
    importReplaceBtn.addEventListener('click', () => {
      if (pendingImport) {
        replaceImportedData(pendingImport);
        showToast("Ma'lumotlar almashtirildi");
      }
      closeImportModal();
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
    const list = txType.value === 'income' ? getCategories('income') : getCategories('expense');
    txCategory.innerHTML = list.map(c => `<option value="${c}">${c}</option>`).join('');
  }

  function populateFilterCategoryOptions() {
    const all = [...getCategories('expense'), ...getCategories('income')];
    filterCategory.innerHTML = '<option value="all">Barcha toifalar</option>' +
      all.map(c => `<option value="${c}">${c}</option>`).join('');
  }

  // ---------- Category management ----------
  function setCategoryModalType(type) {
    categoryModalType = type;
    catTypeExpenseBtn.classList.toggle('active', type === 'expense');
    catTypeIncomeBtn.classList.toggle('active', type === 'income');
    renamingCategory = null;
    renderCategoryList();
  }

  function renderCategoryList() {
    const list = getCategories(categoryModalType);
    const frag = document.createDocumentFragment();

    for (const name of list) {
      const row = document.createElement('div');
      row.className = 'category-row';

      if (name === renamingCategory) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'category-rename-input';
        input.maxLength = 30;
        input.value = name;

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'row-edit-btn';
        saveBtn.title = 'Saqlash';
        saveBtn.textContent = '✓';
        saveBtn.addEventListener('click', () => {
          if (renameCategory(categoryModalType, name, input.value)) {
            renamingCategory = null;
            renderCategoryList();
            populateCategorySelect();
            populateFilterCategoryOptions();
            renderAll();
          }
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'row-delete-btn';
        cancelBtn.title = 'Bekor qilish';
        cancelBtn.textContent = '✕';
        cancelBtn.addEventListener('click', () => {
          renamingCategory = null;
          renderCategoryList();
        });

        const actions = document.createElement('div');
        actions.className = 'category-row-actions';
        actions.append(saveBtn, cancelBtn);

        row.append(input, actions);
      } else {
        const nameSpan = document.createElement('span');
        nameSpan.className = 'category-row-name';
        nameSpan.textContent = name;

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'row-edit-btn';
        editBtn.title = "Nomini o'zgartirish";
        editBtn.textContent = '✏️';
        editBtn.addEventListener('click', () => {
          renamingCategory = name;
          renderCategoryList();
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'row-delete-btn';
        deleteBtn.title = "O'chirish";
        deleteBtn.textContent = '✕';
        deleteBtn.addEventListener('click', () => deleteCategory(categoryModalType, name));

        const actions = document.createElement('div');
        actions.className = 'category-row-actions';
        actions.append(editBtn, deleteBtn);

        row.append(nameSpan, actions);
      }

      frag.appendChild(row);
    }

    categoryListEl.innerHTML = '';
    categoryListEl.appendChild(frag);
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

    if (editingId) {
      const existing = transactions.find(t => t.id === editingId);
      existing.type = txType.value;
      existing.amount = Math.round(amountVal);
      existing.category = categoryVal;
      existing.date = dateVal;
      existing.note = noteVal;
      saveTransactions();
      exitEditMode();
      renderAll();
      showToast('Yozuv yangilandi');
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

  function enterEditMode(tx) {
    editingId = tx.id;
    setType(tx.type);
    txCategory.value = tx.category;
    txAmount.value = tx.amount;
    txDate.value = tx.date;
    txNote.value = tx.note;
    formError.textContent = '';
    submitBtn.textContent = 'Saqlash';
    cancelEditBtn.hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function exitEditMode() {
    editingId = null;
    form.reset();
    txDate.value = todayStr();
    setType('expense');
    formError.textContent = '';
    submitBtn.textContent = "Qo'shish";
    cancelEditBtn.hidden = true;
  }

  // ---------- Rendering ----------
  function renderAll() {
    renderSummary();
    renderBudgets();
    renderCharts();
    renderAdvancedStats();
    renderTopCategories();
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
    for (const cat of getCategories('expense')) {
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
    donutChartTitle.textContent = viewMode === 'year'
      ? `${selectedYear}-yil xarajatlar taqsimoti`
      : 'Oylik xarajatlar taqsimoti';

    const totals = {};
    for (const tx of getPeriodTransactions()) {
      if (tx.type === 'expense') {
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
    let months;
    if (viewMode === 'year') {
      months = [];
      for (let m = 1; m <= 12; m++) months.push(`${selectedYear}-${String(m).padStart(2, '0')}`);
      barChartTitle.textContent = `${selectedYear}-yil oylik dinamikasi`;
    } else {
      const anchor = monthSelector.value || currentMonthStr();
      months = [];
      for (let i = 5; i >= 0; i--) months.push(shiftMonth(anchor, -i));
      barChartTitle.textContent = 'Oxirgi 6 oylik dinamika';
    }

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

  // ---------- Chuqurroq tahlil ----------
  function populateYearSelector() {
    const years = new Set(transactions.map(t => Number(t.date.slice(0, 4))));
    years.add(new Date().getFullYear());
    const sorted = [...years].sort((a, b) => b - a);
    yearSelector.innerHTML = sorted.map(y => `<option value="${y}">${y}</option>`).join('');
    if (!sorted.includes(selectedYear)) selectedYear = sorted[0];
    yearSelector.value = String(selectedYear);
  }

  function setViewMode(mode) {
    viewMode = mode;
    viewModeMonthBtn.classList.toggle('active', mode === 'month');
    viewModeYearBtn.classList.toggle('active', mode === 'year');
    monthSelector.hidden = mode !== 'month';
    yearSelector.hidden = mode !== 'year';
    if (mode === 'year') populateYearSelector();
    renderCharts();
    renderAdvancedStats();
    renderTopCategories();
  }

  function getPeriodTransactions() {
    if (viewMode === 'year') {
      const y = String(selectedYear);
      return transactions.filter(t => t.date.slice(0, 4) === y);
    }
    const m = monthSelector.value || currentMonthStr();
    return transactions.filter(t => t.date.slice(0, 7) === m);
  }

  function getPeriodDayCount() {
    const today = new Date();
    if (viewMode === 'year') {
      const isLeap = (selectedYear % 4 === 0 && selectedYear % 100 !== 0) || selectedYear % 400 === 0;
      const totalDays = isLeap ? 366 : 365;
      if (selectedYear === today.getFullYear()) {
        const start = new Date(selectedYear, 0, 1);
        return Math.min(Math.floor((today - start) / 86400000) + 1, totalDays);
      }
      return totalDays;
    }
    const m = monthSelector.value || currentMonthStr();
    const [y, mo] = m.split('-').map(Number);
    const daysInMonth = new Date(y, mo, 0).getDate();
    return m === currentMonthStr() ? today.getDate() : daysInMonth;
  }

  function getElapsedMonthsInPeriod() {
    if (viewMode === 'year') {
      const today = new Date();
      return selectedYear === today.getFullYear() ? today.getMonth() + 1 : 12;
    }
    return 1;
  }

  function renderAdvancedStats() {
    const periodTx = getPeriodTransactions();
    let income = 0;
    let expense = 0;
    for (const t of periodTx) {
      if (t.type === 'income') income += t.amount;
      else expense += t.amount;
    }

    const days = Math.max(1, getPeriodDayCount());
    const months = Math.max(1, getElapsedMonthsInPeriod());
    statAvgDaily.textContent = formatSom(expense / days);
    statAvgMonthly.textContent = formatSom(expense / months);

    statSavingsRate.classList.remove('positive', 'negative');
    if (income > 0) {
      const rate = Math.round(((income - expense) / income) * 100);
      statSavingsRate.textContent = `${rate}%`;
      statSavingsRate.classList.add(rate >= 0 ? 'positive' : 'negative');
    } else {
      statSavingsRate.textContent = '—';
    }
  }

  function renderTopCategories(n = 5) {
    const totals = {};
    let grandTotal = 0;
    for (const t of getPeriodTransactions()) {
      if (t.type !== 'expense') continue;
      totals[t.category] = (totals[t.category] || 0) + t.amount;
      grandTotal += t.amount;
    }
    const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, n);

    if (ranked.length === 0) {
      topCategoriesList.innerHTML = '';
      topCategoriesEmpty.hidden = false;
      return;
    }
    topCategoriesEmpty.hidden = true;

    const frag = document.createDocumentFragment();
    ranked.forEach(([cat, amount], idx) => {
      const percent = grandTotal > 0 ? (amount / grandTotal) * 100 : 0;

      const row = document.createElement('div');
      row.className = 'top-cat-row';

      const rank = document.createElement('div');
      rank.className = 'top-cat-rank';
      rank.textContent = String(idx + 1);

      const body = document.createElement('div');
      body.className = 'top-cat-body';

      const top = document.createElement('div');
      top.className = 'top-cat-top';
      top.innerHTML = `<span class="top-cat-name">${cat}</span><span class="top-cat-amounts">${formatSom(amount)} · ${Math.round(percent)}%</span>`;

      const track = document.createElement('div');
      track.className = 'progress-track';
      const fill = document.createElement('div');
      fill.className = 'progress-fill';
      fill.style.width = percent + '%';
      track.appendChild(fill);

      body.append(top, track);
      row.append(rank, body);
      frag.appendChild(row);
    });

    topCategoriesList.innerHTML = '';
    topCategoriesList.appendChild(frag);
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
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'row-edit-btn';
      editBtn.title = "Tahrirlash";
      editBtn.textContent = '✏️';
      editBtn.addEventListener('click', () => enterEditMode(tx));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'row-delete-btn';
      delBtn.title = "O'chirish";
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', () => {
        openConfirmModal("Ushbu yozuvni o'chirmoqchimisiz?", () => {
          transactions = transactions.filter(t => t.id !== tx.id);
          saveTransactions();
          if (tx.id === editingId) exitEditMode();
          renderAll();
          showToast("Yozuv o'chirildi");
        });
      });
      tdActions.append(editBtn, delBtn);

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

  // ---------- JSON zaxira nusxa ----------
  function exportJson() {
    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      app: 'hisob-kitob-daftari',
      data: { transactions, budgets, categories }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hisob-kitob-zaxira_${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function validateImportedPayload(raw) {
    if (!raw || typeof raw !== 'object' || !raw.data || typeof raw.data !== 'object') {
      return { valid: false, error: "Fayl formati noto'g'ri" };
    }

    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const rawTx = Array.isArray(raw.data.transactions) ? raw.data.transactions : [];
    const cleanTx = [];
    for (const t of rawTx) {
      if (
        t && typeof t.id === 'string' &&
        (t.type === 'income' || t.type === 'expense') &&
        Number.isFinite(t.amount) && t.amount > 0 &&
        typeof t.date === 'string' && dateRe.test(t.date) &&
        typeof t.category === 'string' && t.category.trim()
      ) {
        cleanTx.push({
          id: t.id,
          type: t.type,
          amount: Math.round(t.amount),
          date: t.date,
          category: t.category.trim(),
          note: typeof t.note === 'string' ? t.note : ''
        });
      }
    }
    const skippedCount = rawTx.length - cleanTx.length;

    const cleanBudgets = {};
    if (raw.data.budgets && typeof raw.data.budgets === 'object') {
      for (const [key, val] of Object.entries(raw.data.budgets)) {
        if (Number.isFinite(val) && val > 0) cleanBudgets[key] = Math.round(val);
      }
    }

    const cleanCategories = { expense: [], income: [] };
    const srcCat = raw.data.categories;
    for (const type of ['expense', 'income']) {
      const arr = srcCat && Array.isArray(srcCat[type]) ? srcCat[type] : [];
      const seenLower = new Set();
      for (const name of arr) {
        if (typeof name === 'string' && name.trim() && !seenLower.has(name.trim().toLowerCase())) {
          seenLower.add(name.trim().toLowerCase());
          cleanCategories[type].push(name.trim());
        }
      }
      for (const t of cleanTx) {
        if (t.type === type && !seenLower.has(t.category.toLowerCase())) {
          seenLower.add(t.category.toLowerCase());
          cleanCategories[type].push(t.category);
        }
      }
      if (cleanCategories[type].length === 0) {
        cleanCategories[type] = type === 'expense'
          ? [...DEFAULT_EXPENSE_CATEGORIES]
          : [...DEFAULT_INCOME_CATEGORIES];
      }
    }

    return { valid: true, transactions: cleanTx, budgets: cleanBudgets, categories: cleanCategories, skippedCount };
  }

  function handleImportFileChange(e) {
    const file = e.target.files[0];
    importFileInput.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      let rawParsed;
      try {
        rawParsed = JSON.parse(reader.result);
      } catch {
        showToast("Fayl formati noto'g'ri");
        return;
      }
      const result = validateImportedPayload(rawParsed);
      if (!result.valid) {
        showToast(result.error || "Fayl formati noto'g'ri");
        return;
      }
      if (result.transactions.length === 0 && result.skippedCount === 0) {
        showToast("Faylda ma'lumot topilmadi");
        return;
      }
      pendingImport = result;
      const skipMsg = result.skippedCount > 0
        ? ` (${result.skippedCount} ta noto'g'ri yozuv o'tkazib yuborildi)`
        : '';
      importModalMessage.textContent =
        `Faylda ${result.transactions.length} ta tranzaksiya topildi${skipMsg}. Mavjud ma'lumotlar bilan qanday davom etamiz?`;
      importModal.hidden = false;
    };
    reader.onerror = () => showToast("Faylni o'qib bo'lmadi");
    reader.readAsText(file);
  }

  function persistAllOrWarn() {
    try {
      saveTransactions();
      saveBudgets();
      saveCategories();
      return true;
    } catch {
      showToast('Xotira yetarli emas — zaxira saqlanmadi');
      return false;
    }
  }

  function replaceImportedData(parsed) {
    transactions = parsed.transactions;
    budgets = parsed.budgets;
    categories = parsed.categories;
    persistAllOrWarn();
    populateCategorySelect();
    populateFilterCategoryOptions();
    renderAll();
  }

  function mergeImportedData(parsed) {
    const existingIds = new Set(transactions.map(t => t.id));
    for (const t of parsed.transactions) {
      if (!existingIds.has(t.id)) {
        transactions.push(t);
        existingIds.add(t.id);
      }
    }
    Object.assign(budgets, parsed.budgets);
    for (const type of ['expense', 'income']) {
      const existingLower = new Set(categories[type].map(c => c.toLowerCase()));
      for (const name of parsed.categories[type]) {
        if (!existingLower.has(name.toLowerCase())) {
          categories[type].push(name);
          existingLower.add(name.toLowerCase());
        }
      }
    }
    persistAllOrWarn();
    populateCategorySelect();
    populateFilterCategoryOptions();
    renderAll();
  }

  function closeImportModal() {
    importModal.hidden = true;
    pendingImport = null;
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
