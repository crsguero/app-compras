// --- Firebase ---
const firebaseConfig = {
  apiKey: "AIzaSyDEBCJbasCSAH_o6L-VR63LLxoL9IM9BWk",
  authDomain: "app-tareas-f38e5.firebaseapp.com",
  databaseURL: "https://app-tareas-f38e5-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "app-tareas-f38e5",
  storageBucket: "app-tareas-f38e5.firebasestorage.app",
  messagingSenderId: "991941627960",
  appId: "1:991941627960:web:7a6eeedda963354e3596cd"
};
firebase.initializeApp(firebaseConfig);
const db   = firebase.database();
const auth = firebase.auth();

// -----------------------
// ESTADO INICIAL
// -----------------------
function safeLoad(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    console.warn(`localStorage "${key}" corrupto, usando valor por defecto.`);
    return fallback;
  }
}

let ingredients = safeLoad('ingredients', []);

// Migración: asignar shoppingType 'semanal' a ingredientes sin ese campo
if (ingredients.some(i => !i.shoppingType)) {
  ingredients = ingredients.map(i => i.shoppingType ? i : { ...i, shoppingType: 'semanal' });
  localStorage.setItem('ingredients', JSON.stringify(ingredients));
}
let recipes = safeLoad('recipes', []);
let editingRecipeId = null;
let calendarEntries = safeLoad('calendarEntries', []);
let purchasedItems = safeLoad('purchasedItems', {});
let lastShoppingList = safeLoad('lastShoppingList', null);
let lista2Items = safeLoad('lista2Items', []);
let lista2Checked = safeLoad('lista2Checked', {});
let lista2ShopQty = safeLoad('lista2ShopQty', {});
let lista2ShopMode = false;
let editingIngredientId = null;

// -----------------------
// CONSTANTES DE ETIQUETAS
// -----------------------
const STORE_LABELS = {
  fruteria: 'Frutería',
  hiperdino: 'Hiperdino',
  mercadona: 'Mercadona',
  eci: 'Supermercado ECI',
  panaderia: 'Panadería',
};

const PRODUCT_UNIT_LABELS = {
  botella: { singular: 'botella', plural: 'botellas' },
  bote:    { singular: 'bote',    plural: 'botes' },
  lata:    { singular: 'lata',    plural: 'latas' },
  envase:  { singular: 'envase',  plural: 'envases' },
  unidad:   { singular: 'unidad',   plural: 'unidades' },
  paquete:  { singular: 'paquete',  plural: 'paquetes' },
};

const MEAL_LABELS = {
  'desayuno': 'Desayuno',
  'media-manana': 'Media mañana',
  'almuerzo': 'Almuerzo',
  'merienda': 'Merienda',
  'cena': 'Cena',
};

const LOCATION_LABELS = {
  decorativo: 'Decorativo',
  despensabalda: 'Despensa - Balda',
  despensacajon01: 'Despensa - Cajón 01',
  despensacajon02: 'Despensa - Cajón 02',
  despensacajon03: 'Despensa - Cajón 03',
  despensacajon04: 'Despensa - Cajón 04',
  nevera: 'Nevera',
  congelador: 'Congelador',
  despensamueblealto: 'Despensa - Mueble alto',
  despensamueblebajo: 'Despensa - Mueble bajo',
  frutero: 'Frutero',
};

const WEEKDAY_PLURAL = {
  'lunes': 'lunes',
  'martes': 'martes',
  'miércoles': 'miércoles',
  'jueves': 'jueves',
  'viernes': 'viernes',
  'sábado': 'sábados',
  'domingo': 'domingos',
};

// Orden de visualización: lun–dom (0=domingo va al final)
const DOW_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DOW_PLURAL = {
  0: 'domingos', 1: 'lunes', 2: 'martes',
  3: 'miércoles', 4: 'jueves', 5: 'viernes', 6: 'sábados',
};

function buildWeeklyRepeatText(days) {
  const WEEKDAYS = [1, 2, 3, 4, 5];
  if (WEEKDAYS.length === days.length && WEEKDAYS.every(d => days.includes(d))) {
    return 'Entre semana';
  }
  const sorted = [...days].sort((a, b) => DOW_DISPLAY_ORDER.indexOf(a) - DOW_DISPLAY_ORDER.indexOf(b));
  const names = sorted.map(d => DOW_PLURAL[d]);
  if (names.length === 1) return `Todos los ${names[0]}`;
  return `Todos los ${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

const ACTIVE_TAB_KEY = 'activeTab';

let _ingredientSort = { col: 'name', dir: 'asc' };
let _recipeSort = { dir: 'asc' };
let _ingredientFilters = { stores: new Set(), locations: new Set(), pantry: null, shoppingType: null };
let _ingredientSearch = '';
let _recipeSearch = '';
let _recipeTooltip = null;


// 🔧 LIMPIEZA DE ENTRADAS CORRUPTAS
// 🔧 Limpieza defensiva de entradas antiguas o corruptas
// Elimina cualquier entrada sin fecha ISO válida (previene "Invalid date")

calendarEntries.forEach((e) => {
  if (!Array.isArray(e.excludedDates)) return;
  e.excludedDates = e.excludedDates.filter(isValidISODateString);
});

function isValidISODateString(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

calendarEntries = calendarEntries.filter((e) => {
  const repeat = e.repeat || 'never';
const isPattern = repeat === 'daily' || repeat === 'weekly';

const keyDate = isPattern
  ? (e.startDate || e.date)
  : (e.date || e.startDate);

return isValidISODateString(keyDate);
});

// Elimina entradas anteriores a la semana actual
const _currentWeekStart = toISODateString(startOfWeekMonday(new Date()));
calendarEntries = calendarEntries.filter((e) => {
  const repeat = e.repeat || 'never';
  if (repeat === 'never') {
    return (e.date || '') >= _currentWeekStart;
  }
  // Recurrentes: eliminar solo si tienen `until` ya pasado
  if (e.until && e.until < _currentWeekStart) return false;
  return true;
});
// Limpiar excludedDates pasadas en entradas recurrentes
calendarEntries.forEach((e) => {
  if (Array.isArray(e.excludedDates) && e.excludedDates.length) {
    e.excludedDates = e.excludedDates.filter(d => d >= _currentWeekStart);
  }
});

saveCalendarEntries();

// -----------------------
// GUARDAR EN LOCALSTORAGE
// -----------------------
function saveIngredients() {
  localStorage.setItem('ingredients', JSON.stringify(ingredients));
  db.ref('compra/ingredients').set(ingredients);
}

function saveRecipes() {
  localStorage.setItem('recipes', JSON.stringify(recipes));
  db.ref('compra/recipes').set(recipes);
}

function saveCalendarEntries() {
  localStorage.setItem('calendarEntries', JSON.stringify(calendarEntries));
  db.ref('compra/calendarEntries').set(calendarEntries);
}

function saveLista2Items() {
  localStorage.setItem('lista2Items', JSON.stringify(lista2Items));
  db.ref('compra/lista2Items').set(lista2Items);
}

function saveLista2Checked() {
  localStorage.setItem('lista2Checked', JSON.stringify(lista2Checked));
  db.ref('compra/lista2Checked').set(lista2Checked);
}

function saveLista2ShopQty() {
  localStorage.setItem('lista2ShopQty', JSON.stringify(lista2ShopQty));
  db.ref('compra/lista2ShopQty').set(lista2ShopQty);
}

function savePurchasedItems() {
  localStorage.setItem('purchasedItems', JSON.stringify(purchasedItems));
  db.ref('compra/purchasedItems').set(purchasedItems);
}

function saveLastShoppingList() {
  localStorage.setItem('lastShoppingList', JSON.stringify(lastShoppingList));
  db.ref('compra/lastShoppingList').set(lastShoppingList);
}


// -----------------------
// FUNCIONES UTILITARIAS
// -----------------------

function parseISODate(dateString) {
  const [y, m, d] = dateString.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(dateString, { separator = ' ', monthLength = 'short' } = {}) {
  if (!dateString) return '';

  const date = parseISODate(dateString);

  const weekday = date.toLocaleDateString('es-ES', { weekday: 'long' });
  const rest = date.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: monthLength,
    year: 'numeric',
  });

  return (
    weekday.charAt(0).toUpperCase() + weekday.slice(1) +
    separator +
    rest.replace(/ de /g, ' ')
  );
}

function formatDateShortRange(dateString) {
  return formatDate(dateString, { separator: ' ' });
}

function renderShoppingDateRange() {
  if (!shoppingDateRange) return;

  // Si no hay lista generada, vaciar
  if (!lastShoppingList?.startDate || !lastShoppingList?.endDate) {
    shoppingDateRange.textContent = '';
    return;
  }

  const start = formatDateShortRange(lastShoppingList.startDate);
  const end = formatDateShortRange(lastShoppingList.endDate);

  shoppingDateRange.textContent = `${start} - ${end}`;
}

function formatDateReadable(dateString) {
  return formatDate(dateString, { separator: ' - ' });
}

function formatDateReadableLongMonth(dateString) {
  return formatDate(dateString, { separator: ' - ', monthLength: 'long' });
}


function toISODateString(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Añade una entrada evitando duplicados (misma fecha + receta + ingesta)
function addCalendarEntry({ date, startDate, recipeId, meal, repeat = 'never', days = null }) {
  const isPattern = repeat === 'daily' || repeat === 'weekly';
  const keyDate = isPattern ? startDate : date;

  if (!keyDate || !recipeId || !meal) return;

  const exists = calendarEntries.some((e) => {
    const eRepeat = e.repeat || 'never';
    const eIsPattern = eRepeat === 'daily' || eRepeat === 'weekly';
    const eKeyDate = eIsPattern ? (e.startDate || e.date) : (e.date || e.startDate);

    return eKeyDate === keyDate && e.recipeId === recipeId && e.meal === meal && eRepeat === repeat;
  });

  if (exists) return;

  calendarEntries.push({
    id: Date.now() + Math.random(),
    repeat,                          // 'never' | 'daily' | 'weekly'
    date: isPattern ? null : keyDate,
    startDate: isPattern ? keyDate : null,
    recipeId,
    meal,
    ...(repeat === 'weekly' && days && days.length > 0 ? { days } : {}),
  });
}

function startOfWeekMonday(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=dom,1=lun...
  const diff = day === 0 ? -6 : 1 - day; // llevar a lunes
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeekSunday(date) {
  const start = startOfWeekMonday(date);
  const end = addDays(start, 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

function getWeekdayName(dateString) {
  const date = new Date(dateString);

  return date.toLocaleDateString('es-ES', {
    weekday: 'long',
  });
}


// -----------------------
// INGREDIENTES
// -----------------------
const ingredientForm = document.getElementById('ingredientForm');
const nameInput = document.getElementById('nameInput');
const unitInput = document.getElementById('unitInput');
const ingredientList = document.getElementById('ingredientList');
const storeSelect = document.getElementById('storeSelect');
const locationSelect = document.getElementById('locationSelect');
const shoppingTypeSelect = document.getElementById('shoppingTypeSelect');
const productInput = document.getElementById('productInput');
const productUnitSelect = document.getElementById('productUnitSelect');
const formatoInput = document.getElementById('formatoInput');
const formatoUnit = document.getElementById('formatoUnit');
const pantryToggle = document.getElementById('pantryToggle');
const minQuantityWrapper = document.getElementById('minQuantityWrapper');
const minQuantityInput = document.getElementById('minQuantityInput');
const deleteIngredientBtn = document.getElementById('deleteIngredientBtn');
const ingredientModalTitle = document.getElementById('ingredientModalTitle');


const openIngredientModalBtn =
  document.getElementById('openIngredientModal');
const ingredientEditPanel =
  document.getElementById('ingredientEditPanel');
const closeIngredientModalBtn =
  document.getElementById('closeIngredientModal');

// Modal: nuevo ingrediente
const newIngredientModal = document.getElementById('newIngredientModal');
const newIngredientForm = document.getElementById('newIngredientForm');
const newNameInput = document.getElementById('newNameInput');
const newUnitInput = document.getElementById('newUnitInput');
const newLocationSelect = document.getElementById('newLocationSelect');
const newPantryToggle = document.getElementById('newPantryToggle');
const newMinQuantityWrapper = document.getElementById('newMinQuantityWrapper');
const newMinQuantityInput = document.getElementById('newMinQuantityInput');
const newShoppingTypeSelect = document.getElementById('newShoppingTypeSelect');
const newStoreSelect = document.getElementById('newStoreSelect');
const newProductInput = document.getElementById('newProductInput');
const newProductUnitSelect = document.getElementById('newProductUnitSelect');
const newFormatoInput = document.getElementById('newFormatoInput');
const newFormatoUnit = document.getElementById('newFormatoUnit');

function openIngredientPanel() {
  ingredientEditPanel?.classList.add('is-open');
}

function closeIngredientPanel() {
  ingredientEditPanel?.classList.remove('is-open');
  document.querySelectorAll('.ingredient-table tr.is-selected')
    .forEach((r) => r.classList.remove('is-selected'));
}

if (openIngredientModalBtn) {
  openIngredientModalBtn.addEventListener('click', () => {
    if (newIngredientForm) newIngredientForm.reset();
    if (newPantryToggle) newPantryToggle.checked = false;
    if (newMinQuantityWrapper) newMinQuantityWrapper.classList.add('hidden');
    if (newMinQuantityInput) newMinQuantityInput.required = false;
    if (newFormatoUnit) newFormatoUnit.textContent = '';
    openModal(newIngredientModal);
  });
}

document.getElementById('closeNewIngredientModal')?.addEventListener('click', () => {
  closeModal(newIngredientModal);
});

newIngredientModal?.addEventListener('click', (e) => {
  if (e.target === newIngredientModal) closeModal(newIngredientModal);
});

if (newUnitInput && newFormatoUnit) {
  newUnitInput.addEventListener('change', () => {
    newFormatoUnit.textContent = newUnitInput.value;
  });
}

if (newPantryToggle) {
  newPantryToggle.addEventListener('change', () => {
    if (newPantryToggle.checked) {
      newMinQuantityWrapper?.classList.remove('hidden');
      if (newMinQuantityInput) newMinQuantityInput.required = true;
    } else {
      newMinQuantityWrapper?.classList.add('hidden');
      if (newMinQuantityInput) {
        newMinQuantityInput.required = false;
        newMinQuantityInput.value = '';
      }
    }
  });
}

if (newIngredientForm) {
  newIngredientForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = newNameInput.value.trim();
    const unit = newUnitInput.value;
    const store = newStoreSelect.value;
    const location = newLocationSelect.value;
    const shoppingType = newShoppingTypeSelect?.value || '';

    if (!name || !unit || !store || !location || !shoppingType) return;

    ingredients.push({
      id: Date.now(),
      name,
      unit,
      store: store || null,
      location,
      pantry: newPantryToggle.checked,
      minQuantity: newPantryToggle.checked
        ? newMinQuantityInput.value.trim() || null
        : null,
      shoppingType: shoppingType || null,
      product: newProductInput?.value.trim() || null,
      productUnit: newProductUnitSelect?.value || null,
      formato: newFormatoInput?.value.trim() || null,
    });

    saveIngredients();
    renderIngredients();
    renderIngredientSelectors();
    renderRecipes();

    if (calendarList) renderCalendarEntries();
    if (shoppingList && lastShoppingList) renderStoresOverview();
    renderLocationsOverview();
    renderShoppingDateRange();

    newIngredientForm.reset();
    if (newPantryToggle) newPantryToggle.checked = false;
    if (newMinQuantityWrapper) newMinQuantityWrapper.classList.add('hidden');
    if (newMinQuantityInput) {
      newMinQuantityInput.required = false;
      newMinQuantityInput.value = '';
    }
    if (newFormatoUnit) newFormatoUnit.textContent = '';
    closeModal(newIngredientModal);
  });
}

if (closeIngredientModalBtn) {
  closeIngredientModalBtn.addEventListener('click', () => {
    closeIngredientPanel();
  });
}

document.getElementById('closeIngredientSheetBtn')?.addEventListener('click', () => {
  closeIngredientPanel();
});

if (unitInput && formatoUnit) {
  unitInput.addEventListener('change', () => {
    formatoUnit.textContent = unitInput.value;
  });
}

if (pantryToggle) {
  pantryToggle.addEventListener('change', () => {
    if (pantryToggle.checked) {
      minQuantityWrapper?.classList.remove('hidden');
      if (minQuantityInput) {
        minQuantityInput.required = true;
      }
    } else {
      minQuantityWrapper?.classList.add('hidden');
      if (minQuantityInput) {
        minQuantityInput.required = false;
        minQuantityInput.value = '';
      }
    }
  });
}


function applyIngredientFilters(arr) {
  return arr.filter(ing => {
    if (_ingredientSearch) {
      const q = _ingredientSearch.toLowerCase();
      if (!ing.name.toLowerCase().includes(q)) return false;
    }
    if (_ingredientFilters.stores.size > 0 && !_ingredientFilters.stores.has(ing.store ?? '')) return false;
    if (_ingredientFilters.locations.size > 0 && !_ingredientFilters.locations.has(ing.location ?? '')) return false;
    if (_ingredientFilters.pantry !== null && ing.pantry !== _ingredientFilters.pantry) return false;
    if (_ingredientFilters.shoppingType !== null && ing.shoppingType !== _ingredientFilters.shoppingType) return false;
    return true;
  });
}

function updateFilterBadge() {
  const btn = document.getElementById('openIngredientFilter');
  const badge = document.getElementById('ingredientFilterBadge');
  if (!btn || !badge) return;
  const count = _ingredientFilters.stores.size + _ingredientFilters.locations.size + (_ingredientFilters.pantry !== null ? 1 : 0) + (_ingredientFilters.shoppingType !== null ? 1 : 0);
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove('hidden');
    btn.classList.add('is-active');
  } else {
    badge.classList.add('hidden');
    btn.classList.remove('is-active');
  }
}

function renderFilterPanel() {
  const container = document.getElementById('ingredientFilterContent');
  if (!container) return;
  container.innerHTML = '';

  const storeSection = document.createElement('div');
  storeSection.className = 'filter-section';
  const storeTitle = document.createElement('div');
  storeTitle.className = 'filter-section-title';
  storeTitle.textContent = 'Comercio';
  storeSection.appendChild(storeTitle);
  Object.entries(STORE_LABELS).forEach(([key, label]) => {
    const opt = document.createElement('label');
    opt.className = 'filter-option';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = key;
    cb.checked = _ingredientFilters.stores.has(key);
    cb.addEventListener('change', () => {
      if (cb.checked) _ingredientFilters.stores.add(key);
      else _ingredientFilters.stores.delete(key);
      renderIngredients();
      updateFilterBadge();
    });
    opt.appendChild(cb);
    opt.appendChild(document.createTextNode(label));
    storeSection.appendChild(opt);
  });
  container.appendChild(storeSection);

  const locSection = document.createElement('div');
  locSection.className = 'filter-section';
  const locTitle = document.createElement('div');
  locTitle.className = 'filter-section-title';
  locTitle.textContent = 'Ubicación';
  locSection.appendChild(locTitle);
  Object.entries(LOCATION_LABELS).forEach(([key, label]) => {
    const opt = document.createElement('label');
    opt.className = 'filter-option';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = key;
    cb.checked = _ingredientFilters.locations.has(key);
    cb.addEventListener('change', () => {
      if (cb.checked) _ingredientFilters.locations.add(key);
      else _ingredientFilters.locations.delete(key);
      renderIngredients();
      updateFilterBadge();
    });
    opt.appendChild(cb);
    opt.appendChild(document.createTextNode(label));
    locSection.appendChild(opt);
  });
  container.appendChild(locSection);

  const pantrySection = document.createElement('div');
  pantrySection.className = 'filter-section';
  const pantryTitle = document.createElement('div');
  pantryTitle.className = 'filter-section-title';
  pantryTitle.textContent = 'Despensa';
  pantrySection.appendChild(pantryTitle);
  [
    { value: null,  label: 'Todos' },
    { value: true,  label: 'Sí' },
    { value: false, label: 'No' },
  ].forEach(({ value, label }) => {
    const opt = document.createElement('label');
    opt.className = 'filter-option';
    const rb = document.createElement('input');
    rb.type = 'radio';
    rb.name = 'ingredientPantryFilter';
    rb.checked = _ingredientFilters.pantry === value;
    rb.addEventListener('change', () => {
      _ingredientFilters.pantry = value;
      renderIngredients();
      updateFilterBadge();
    });
    opt.appendChild(rb);
    opt.appendChild(document.createTextNode(label));
    pantrySection.appendChild(opt);
  });
  container.appendChild(pantrySection);

  const typeSection = document.createElement('div');
  typeSection.className = 'filter-section';
  const typeTitle = document.createElement('div');
  typeTitle.className = 'filter-section-title';
  typeTitle.textContent = 'Tipo';
  typeSection.appendChild(typeTitle);
  [
    { value: null,       label: 'Todos' },
    { value: 'semanal',  label: 'Semanal' },
    { value: 'mensual',  label: 'Mensual' },
  ].forEach(({ value, label }) => {
    const opt = document.createElement('label');
    opt.className = 'filter-option';
    const rb = document.createElement('input');
    rb.type = 'radio';
    rb.name = 'ingredientShoppingTypeFilter';
    rb.checked = _ingredientFilters.shoppingType === value;
    rb.addEventListener('change', () => {
      _ingredientFilters.shoppingType = value;
      renderIngredients();
      updateFilterBadge();
    });
    opt.appendChild(rb);
    opt.appendChild(document.createTextNode(label));
    typeSection.appendChild(opt);
  });
  container.appendChild(typeSection);
}

function renderIngredients() {
  if (!ingredientList) return;

  ingredientList.innerHTML = '';

  const filtered = applyIngredientFilters(ingredients);

  if (window.innerWidth >= 768) {
    renderIngredientsTable(filtered);
  } else {
    const alphabetical = [...filtered].sort((a, b) =>
      a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
    );
    renderIngredientsList(alphabetical);
  }
}

function applyIngredientSort(arr, col, dir) {
  const storeOrder = Object.keys(STORE_LABELS);
  const locationOrder = Object.keys(LOCATION_LABELS);

  return [...arr].sort((a, b) => {
    let cmp = 0;
    if (col === 'name') {
      cmp = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
    } else if (col === 'store') {
      const ai = storeOrder.indexOf(a.store ?? '');
      const bi = storeOrder.indexOf(b.store ?? '');
      cmp = (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    } else if (col === 'location') {
      const ai = locationOrder.indexOf(a.location ?? '');
      const bi = locationOrder.indexOf(b.location ?? '');
      cmp = (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    }
    return dir === 'asc' ? cmp : -cmp;
  });
}

function renderIngredientsTable(raw) {
  const sorted = applyIngredientSort(raw, _ingredientSort.col, _ingredientSort.dir);

  const table = document.createElement('table');
  table.className = 'ingredient-table';

  // Cabeceras: Nombre, Comercio y Ubicación son ordenables
  const COLS = [
    { key: 'name',         label: 'Nombre',    sortable: true  },
    { key: 'unit',         label: 'Unidad',    sortable: false },
    { key: 'location',     label: 'Ubicación', sortable: true  },
    { key: 'pantry',       label: 'Despensa',  sortable: false },
    { key: 'shoppingType', label: 'Tipo',      sortable: true  },
    { key: 'store',        label: 'Comercio',  sortable: true  },
  ];

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  COLS.forEach(({ key, label, sortable }) => {
    const th = document.createElement('th');
    if (!sortable) {
      th.textContent = label;
    } else {
      const isActive = _ingredientSort.col === key;
      const arrow = isActive ? (_ingredientSort.dir === 'asc' ? '↑' : '↓') : '';
      th.className = 'ingredient-th-sortable' + (isActive ? ' is-active' : '');
      th.innerHTML = `${label}<span class="sort-arrow">${arrow}</span>`;
      th.addEventListener('click', () => {
        if (_ingredientSort.col === key) {
          _ingredientSort.dir = _ingredientSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          _ingredientSort = { col: key, dir: 'asc' };
        }
        renderIngredients();
      });
    }
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  function makeInlineSelect(options, currentValue, onChange) {
    const sel = document.createElement('select');
    sel.className = 'tipo-inline-select';
    options.forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (currentValue === value) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  const tbody = document.createElement('tbody');
  sorted.forEach((ingredient) => {
    const tr = document.createElement('tr');
    tr.dataset.id = ingredient.id;

    // Nombre
    const nameTd = document.createElement('td');
    nameTd.textContent = ingredient.name;
    tr.appendChild(nameTd);

    // Unidad
    const unitTd = document.createElement('td');
    unitTd.appendChild(makeInlineSelect(
      [{ value: 'g', label: 'g' }, { value: 'ml', label: 'ml' }, { value: 'ud', label: 'ud' }, { value: 'rodaja', label: 'rodaja' }],
      ingredient.unit,
      v => { ingredient.unit = v; saveIngredients(); }
    ));
    tr.appendChild(unitTd);

    // Ubicación
    const locTd = document.createElement('td');
    locTd.appendChild(makeInlineSelect(
      Object.entries(LOCATION_LABELS).map(([value, label]) => ({ value, label })),
      ingredient.location,
      v => { ingredient.location = v; saveIngredients(); }
    ));
    tr.appendChild(locTd);

    // Despensa
    const pantryTd = document.createElement('td');
    pantryTd.appendChild(makeInlineSelect(
      [{ value: 'true', label: 'Sí' }, { value: 'false', label: 'No' }],
      String(!!ingredient.pantry),
      v => { ingredient.pantry = v === 'true'; saveIngredients(); }
    ));
    tr.appendChild(pantryTd);

    // Tipo
    const tipoTd = document.createElement('td');
    tipoTd.appendChild(makeInlineSelect(
      [{ value: 'semanal', label: 'Semanal' }, { value: 'mensual', label: 'Mensual' }],
      ingredient.shoppingType,
      v => { ingredient.shoppingType = v; saveIngredients(); }
    ));
    tr.appendChild(tipoTd);

    // Comercio
    const storeTd = document.createElement('td');
    storeTd.appendChild(makeInlineSelect(
      Object.entries(STORE_LABELS).map(([value, label]) => ({ value, label })),
      ingredient.store,
      v => { ingredient.store = v; saveIngredients(); }
    ));
    tr.appendChild(storeTd);

    tr.style.cursor = 'pointer';
    tr.addEventListener('click', (e) => {
      if (e.target.closest('select')) return;
      document.querySelectorAll('.ingredient-table tr.is-selected')
        .forEach((r) => r.classList.remove('is-selected'));
      tr.classList.add('is-selected');
      startEditIngredient(ingredient.id);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  ingredientList.appendChild(table);
}

function renderIngredientsList(sortedIngredients) {
  const ul = document.createElement('ul');
  sortedIngredients.forEach((ingredient) => {
    const li = document.createElement('li');
    li.className = 'ingredient-row';
    li.dataset.id = ingredient.id;

    li.innerHTML = `
      <div class="ingredient-row-content">
        <div class="ingredient-row-left">
          <span class="ingredient-row-name">
            ${ingredient.name} <span class="ingredient-row-unit">(${ingredient.unit})</span>
          </span>
        </div>

        <span class="recipe-row-icon" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </div>
    `;

    li.addEventListener('click', () => {
      openIngredientDetailModal(ingredient.id);
    });

    ul.appendChild(li);
  });
  ingredientList.appendChild(ul);
}

function startEditIngredient(id) {
  const ingredient = ingredients.find((i) => i.id === id);
  if (!ingredient) return;

  editingIngredientId = id;

  // 👇 Cambiar título del modal
  if (ingredientModalTitle) {
    ingredientModalTitle.textContent = 'Editar ingrediente';
  }

  // 👇 LIMPIAR FORMULARIO PRIMERO
  ingredientForm.reset();

  // Rellenar formulario
  nameInput.value = ingredient.name;
  unitInput.value = ingredient.unit;
  storeSelect.value = ingredient.store || '';
  locationSelect.value = ingredient.location || '';
  if (shoppingTypeSelect) shoppingTypeSelect.value = ingredient.shoppingType || '';
  if (productInput) productInput.value = ingredient.product || '';
  if (productUnitSelect) productUnitSelect.value = ingredient.productUnit || '';
  if (formatoInput) formatoInput.value = ingredient.formato || '';
  if (formatoUnit) formatoUnit.textContent = ingredient.unit || '';
  pantryToggle.checked = !!ingredient.pantry;

  if (ingredient.pantry) {
    minQuantityWrapper.classList.remove('hidden');
    minQuantityInput.required = true;
    minQuantityInput.value = ingredient.minQuantity || '';
  } else {
    minQuantityWrapper.classList.add('hidden');
    minQuantityInput.required = false;
    minQuantityInput.value = '';
  }

  // 👇 Seguridad extra
  if (!unitInput.value) {
    unitInput.value = '';
  }

  // Comercio alternativo si usas storeId
  if (ingredient.storeId && storeSelect) {
    storeSelect.value = ingredient.storeId;
  }

  // 👇 Cambiar texto del botón
  ingredientForm.querySelector('button[type="submit"]').textContent =
    'Guardar cambios';

  if (deleteIngredientBtn) deleteIngredientBtn.classList.remove('hidden');

  // Recetas que usan este ingrediente
  const usedInRecipesEl = document.getElementById('ingredientUsedInRecipes');
  if (usedInRecipesEl) {
    const matchingRecipes = recipes.filter((r) =>
      r.ingredients?.some((ri) => ri.ingredientId === id)
    );
    const editIconSvg = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.333 2a1.885 1.885 0 0 1 2.667 2.667L4.889 13.778 2 14l.222-2.889L11.333 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    if (matchingRecipes.length === 0) {
      usedInRecipesEl.innerHTML = `
        <p class="field-label-small">Usado en</p>
        <p class="ingredient-recipe-empty">Este ingrediente no ha sido asociado a ninguna receta.</p>`;
    } else {
      usedInRecipesEl.innerHTML = `
        <p class="field-label-small">Usado en</p>
        <ul class="ingredient-recipe-list">
          ${matchingRecipes.map((r) => `
            <li class="ingredient-recipe-row" data-recipe-id="${r.id}">
              <span class="ingredient-recipe-name">${r.name}</span>
              <button type="button" class="ingredient-recipe-edit-btn" aria-label="Editar receta">${editIconSvg}</button>
            </li>`).join('')}
        </ul>`;

      usedInRecipesEl.querySelectorAll('.ingredient-recipe-edit-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const recipeId = Number(btn.closest('li').dataset.recipeId);
          const tabId = 'recipes';
          localStorage.setItem(ACTIVE_TAB_KEY, tabId);
          tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === tabId));
          tabContents.forEach((s) => s.classList.toggle('active', s.id === tabId));
          startEditRecipe(recipeId);
          openRecipePanel();
        });
      });
    }
  }

  ingredientEditPanel?.classList.add('is-editing');
  openIngredientPanel();
}


if (ingredientForm) {
  ingredientForm.addEventListener('submit', (e) => {
    e.preventDefault();

  // 👇 LOG DE SEGURIDAD (AQUÍ)
  console.log('SUBMIT INGREDIENTE → editingIngredientId:', editingIngredientId);
  
  const name = nameInput.value.trim();
  const unit = unitInput.value;
  const store = storeSelect.value;
  const location = locationSelect.value;
  const shoppingType = shoppingTypeSelect?.value || '';

  if (!name || !unit || !store || !location || !shoppingType) return;

  if (editingIngredientId) {
  // 📝 EDITAR
  const ingredient = ingredients.find((i) => i.id === editingIngredientId);
  if (!ingredient) return;

  ingredient.name = name;
  ingredient.unit = unit;
  ingredient.store = storeSelect.value || null;
  ingredient.location = location;

  ingredient.pantry = pantryToggle.checked;
  ingredient.minQuantity = pantryToggle.checked
    ? minQuantityInput.value.trim() || null
    : null;
  ingredient.shoppingType = shoppingTypeSelect?.value || null;
  ingredient.product = productInput?.value.trim() || null;
  ingredient.productUnit = productUnitSelect?.value || null;
  ingredient.formato = formatoInput?.value.trim() || null;

  } else {
    // ➕ CREAR
    ingredients.push({
      id: Date.now(),
      name,
      unit,
      store: storeSelect.value || null,
      location: location,
      pantry: pantryToggle.checked,
      minQuantity: pantryToggle.checked
        ? minQuantityInput.value.trim() || null
        : null,
      shoppingType: shoppingTypeSelect?.value || null,
      product: productInput?.value.trim() || null,
      productUnit: productUnitSelect?.value || null,
      formato: formatoInput?.value.trim() || null,
    });
  }

  saveIngredients();
  renderIngredients();
  renderIngredientSelectors();
  renderRecipes();

if (calendarList) {
  renderCalendarEntries();
}

if (shoppingList && lastShoppingList) {
  renderStoresOverview();
}

renderLocationsOverview();
renderShoppingDateRange();

  ingredientForm.reset();
  storeSelect.value = '';
  ingredientEditPanel?.classList.remove('is-editing');
  closeIngredientPanel();
  editingIngredientId = null;
  pantryToggle.checked = false;
  minQuantityWrapper.classList.add('hidden');
  minQuantityInput.required = false;
  minQuantityInput.value = '';
  locationSelect.value = '';

  if (deleteIngredientBtn) deleteIngredientBtn.classList.add('hidden');

  ingredientForm
    .querySelector('button[type="submit"]')
    .textContent = 'Guardar ingrediente';
});
}

function autoSaveIngredient() {
  if (!editingIngredientId) return;
  if (!window.matchMedia('(min-width: 768px)').matches) return;

  const ingredient = ingredients.find((i) => i.id === editingIngredientId);
  if (!ingredient) return;

  const name = nameInput.value.trim();
  const unit = unitInput.value;
  const store = storeSelect.value;
  const location = locationSelect.value;
  const shoppingType = shoppingTypeSelect?.value || '';
  if (!name || !unit || !store || !location || !shoppingType) return;

  ingredient.name = name;
  ingredient.unit = unit;
  ingredient.store = store || null;
  ingredient.location = location;
  ingredient.pantry = pantryToggle.checked;
  ingredient.minQuantity = pantryToggle.checked ? minQuantityInput.value.trim() || null : null;
  ingredient.shoppingType = shoppingType || null;
  ingredient.product = productInput?.value.trim() || null;
  ingredient.productUnit = productUnitSelect?.value || null;
  ingredient.formato = formatoInput?.value.trim() || null;

  saveIngredients();
  renderIngredients();
  renderIngredientSelectors();
  renderRecipes();
  if (calendarList) renderCalendarEntries();
  if (shoppingList && lastShoppingList) renderStoresOverview();
  renderLocationsOverview();
  renderShoppingDateRange();

  const savedId = editingIngredientId;
  document.querySelector(`.ingredient-table tr[data-id="${savedId}"]`)
    ?.classList.add('is-selected');
}

[
  nameInput, unitInput, storeSelect, locationSelect, shoppingTypeSelect,
  pantryToggle, minQuantityInput, productInput, productUnitSelect, formatoInput,
].forEach((el) => {
  if (el) el.addEventListener('change', autoSaveIngredient);
});

if (deleteIngredientBtn) {
  deleteIngredientBtn.addEventListener('click', () => {
    if (!editingIngredientId) return;
    const ingredient = ingredients.find(i => i.id === editingIngredientId);
    if (!ingredient) return;
    const ok = confirm(`¿Seguro que quieres eliminar "${ingredient.name}"?`);
    if (ok) {
      closeIngredientPanel();
      deleteIngredient(editingIngredientId);
      editingIngredientId = null;
    }
  });
}

renderIngredients();

let _ingredientsWasDesktop = window.innerWidth >= 768;
window.addEventListener('resize', () => {
  const isDesktop = window.innerWidth >= 768;
  if (isDesktop !== _ingredientsWasDesktop) {
    _ingredientsWasDesktop = isDesktop;
    renderIngredients();
  }
});

const filterBtn = document.getElementById('openIngredientFilter');
const filterDropdown = document.getElementById('ingredientFilterDropdown');
const clearFiltersBtn = document.getElementById('clearIngredientFilters');

if (filterBtn && filterDropdown) {
  filterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (filterDropdown.classList.contains('hidden')) {
      renderFilterPanel();
      filterDropdown.classList.remove('hidden');
    } else {
      filterDropdown.classList.add('hidden');
    }
  });

  document.addEventListener('click', (e) => {
    if (!filterDropdown.classList.contains('hidden') && !filterDropdown.contains(e.target)) {
      filterDropdown.classList.add('hidden');
    }
  });
}

if (clearFiltersBtn) {
  clearFiltersBtn.addEventListener('click', () => {
    _ingredientFilters = { stores: new Set(), locations: new Set(), pantry: null, shoppingType: null };
    renderIngredients();
    updateFilterBadge();
    renderFilterPanel();
  });
}

const searchWrapper = document.getElementById('ingredientSearchWrapper');
const searchBtn = document.getElementById('ingredientSearchBtn');
const searchInput = document.getElementById('ingredientSearchInput');
const searchCloseBtn = document.getElementById('ingredientSearchClose');

function closeIngredientSearch() {
  _ingredientSearch = '';
  if (searchInput) searchInput.value = '';
  if (searchWrapper) searchWrapper.classList.remove('is-open');
  renderIngredients();
}

if (searchBtn && searchWrapper && searchInput) {
  searchBtn.addEventListener('click', () => {
    searchWrapper.classList.add('is-open');
    searchInput.focus();
  });

  searchInput.addEventListener('input', () => {
    _ingredientSearch = searchInput.value;
    renderIngredients();
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeIngredientSearch();
  });
}

if (searchCloseBtn) {
  searchCloseBtn.addEventListener('click', closeIngredientSearch);
}

const recipeSearchWrapper = document.getElementById('recipeSearchWrapper');
const recipeSearchBtn = document.getElementById('recipeSearchBtn');
const recipeSearchInput = document.getElementById('recipeSearchInput');
const recipeSearchCloseBtn = document.getElementById('recipeSearchClose');

function closeRecipeSearch() {
  _recipeSearch = '';
  if (recipeSearchInput) recipeSearchInput.value = '';
  if (recipeSearchWrapper) recipeSearchWrapper.classList.remove('is-open');
  renderRecipes();
}

if (recipeSearchBtn && recipeSearchWrapper && recipeSearchInput) {
  recipeSearchBtn.addEventListener('click', () => {
    recipeSearchWrapper.classList.add('is-open');
    recipeSearchInput.focus();
  });

  recipeSearchInput.addEventListener('input', () => {
    _recipeSearch = recipeSearchInput.value;
    renderRecipes();
  });

  recipeSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeRecipeSearch();
  });
}

if (recipeSearchCloseBtn) {
  recipeSearchCloseBtn.addEventListener('click', closeRecipeSearch);
}

// -----------------------
// COCINADOS
// -----------------------
const recipeForm = document.getElementById('recipeForm');
const recipeNameInput = document.getElementById('recipeNameInput');
const recipeList = document.getElementById('recipeList');
const ingredientSelectors = document.getElementById('ingredientSelectors');
const addIngredientBtn = document.getElementById('addIngredientToRecipe');
const saveRecipeBtn = document.getElementById('saveRecipeBtn');
const deleteRecipeBtn = document.getElementById('deleteRecipeBtn');

const calendarForm = document.getElementById('calendarForm');
const calendarDateInput = document.getElementById('calendarDate');
const calendarDateWrapper = calendarDateInput ? calendarDateInput.closest('.date-picker') : null;
const calendarRecipeSelect = document.getElementById('calendarRecipe');
const calendarRepeatSelect = document.getElementById('calendarRepeat');
const calendarMealSelect = document.getElementById('calendarMeal');
const calendarList = document.getElementById('calendarList');

function setCalendarDate(value) {
  if (!calendarDateInput) return;
  calendarDateInput.value = value;
  if (calendarDateWrapper) {
    if (value) calendarDateWrapper.setAttribute('data-has-value', '');
    else calendarDateWrapper.removeAttribute('data-has-value');
  }
}

if (calendarDateInput) {
  calendarDateInput.addEventListener('change', () => {
    if (calendarDateWrapper) {
      if (calendarDateInput.value) calendarDateWrapper.setAttribute('data-has-value', '');
      else calendarDateWrapper.removeAttribute('data-has-value');
    }
  });
}

const weekdayPicker = document.getElementById('weekdayPicker');

function getSelectedWeekdays() {
  if (!weekdayPicker) return [];
  return [...weekdayPicker.querySelectorAll('.weekday-btn.active')]
    .map(btn => Number(btn.dataset.day));
}

function setSelectedWeekdays(days) {
  if (!weekdayPicker) return;
  weekdayPicker.querySelectorAll('.weekday-btn').forEach(btn => {
    btn.classList.toggle('active', days.includes(Number(btn.dataset.day)));
  });
}

function syncWeekdayPicker(days) {
  if (!weekdayPicker || !calendarRepeatSelect) return;
  const isWeekly = calendarRepeatSelect.value === 'weekly';
  weekdayPicker.classList.toggle('hidden', !isWeekly);
  if (isWeekly && days !== undefined) setSelectedWeekdays(days);
}

if (weekdayPicker) {
  weekdayPicker.querySelectorAll('.weekday-btn').forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('active'));
  });
}

if (calendarRepeatSelect) {
  calendarRepeatSelect.addEventListener('change', () => {
    const isWeekly = calendarRepeatSelect.value === 'weekly';
    weekdayPicker?.classList.toggle('hidden', !isWeekly);
    if (isWeekly && calendarDateInput?.value) {
      const dow = new Date(calendarDateInput.value + 'T12:00:00').getDay();
      setSelectedWeekdays([dow]);
    }
  });
}

let calendarWeekView = 'current'; // 'current' | 'next'

const weekTabButtons = document.querySelectorAll('.calendar-week-tab');

weekTabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    calendarWeekView = btn.dataset.week;

    weekTabButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    renderCalendarEntries();
  });
});

function updateCalendarMonthLabel() {
  const label = document.getElementById('calendarMonthLabel');
  if (!label) return;
  const now = new Date();
  const base = calendarWeekView === 'next' ? addDays(now, 7) : now;
  const weekStart = startOfWeekMonday(base);
  const raw = weekStart.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  label.textContent = raw.replace(' de ', ' ').replace(/^\w/, c => c.toUpperCase());
}


// -----------------------
// MODAL Creación cocinado
// -----------------------

const openRecipeModalBtn = document.getElementById('openRecipeModal');
const recipeModal = document.getElementById('recipeModal');
const closeRecipeModalBtn = document.getElementById('closeRecipeModal');
const closeRecipeSheetBtn = document.getElementById('closeRecipeSheetBtn');

function isDesktop() {
  return window.matchMedia('(min-width: 768px)').matches;
}

function openRecipePanel() {
  recipeModal?.classList.add('is-open');
}

function closeRecipePanel() {
  if (!recipeModal) return;
  autoSaveRecipe();
  recipeModal.classList.remove('is-open');
  document.querySelectorAll('.recipe-table tr.is-selected')
    .forEach(r => r.classList.remove('is-selected'));
  renderRecipes();
  setTimeout(resetRecipeForm, 260);
}

if (openRecipeModalBtn && recipeModal) {
  openRecipeModalBtn.addEventListener('click', () => {
    resetRecipeForm();
    const title = document.getElementById('recipeModalTitle');
    if (title) title.textContent = 'Nueva receta';
    openRecipePanel();
  });
}

if (closeRecipeModalBtn && recipeModal) {
  closeRecipeModalBtn.addEventListener('click', () => {
    closeRecipePanel();
  });
}

closeRecipeSheetBtn?.addEventListener('click', () => {
  closeRecipePanel();
});



// -----------------------
// MODAL CALENDARIO
// -----------------------
const openCalendarModalBtn = document.getElementById('openCalendarModal');
const calendarModal = document.getElementById('calendarModal');
const closeCalendarModalBtn = document.getElementById('closeCalendarModal');

function openModal(modalEl) {
  if (!modalEl) return;

  modalEl.classList.remove('hidden');
  void modalEl.offsetWidth; // fuerza reflow
  modalEl.classList.add('is-open');
}

function closeModal(modalEl) {
  if (!modalEl) return;

  const content = modalEl.querySelector('.modal-content');

  modalEl.classList.remove('is-open');

  // fallback por si no dispara transitionend
  const fallback = setTimeout(() => {
    modalEl.classList.add('hidden');
  }, 350);

  const onEnd = (e) => {
    // solo cuando termina la transición del panel blanco
    if (content && e.target !== content) return;

    clearTimeout(fallback);
    modalEl.classList.add('hidden');
    if (content) content.removeEventListener('transitionend', onEnd);
  };

  if (content) {
    content.addEventListener('transitionend', onEnd);
  } else {
    clearTimeout(fallback);
    modalEl.classList.add('hidden');
  }
}

const calendarModalTitle = document.getElementById('calendarModalTitle');
const calendarSubmitBtn = document.getElementById('calendarSubmitBtn');
const deleteCalendarEntryBtn = document.getElementById('deleteCalendarEntryBtn');
const deleteCalendarConfirmModal = document.getElementById('deleteCalendarConfirmModal');
const confirmDeleteOccurrenceBtn = document.getElementById('confirmDeleteOccurrenceBtn');
const confirmDeleteAllBtn = document.getElementById('confirmDeleteAllBtn');
const confirmDeleteCancelBtn = document.getElementById('confirmDeleteCancelBtn');
let _calendarEditingEntry = null;

function setCalendarModalMode(mode) {
  const isEdit = mode === 'edit';
  if (calendarModalTitle) calendarModalTitle.textContent = isEdit ? 'Editar cocinado' : 'Añadir cocinado';
  if (calendarSubmitBtn) calendarSubmitBtn.textContent = isEdit ? 'Guardar cambios' : 'Añadir';
  if (deleteCalendarEntryBtn) deleteCalendarEntryBtn.classList.toggle('hidden', !isEdit);
}

function applyDeleteCalendarEntry() {
  if (!_calendarEditingEntry) return;
  const orig = _calendarEditingEntry;

  if (orig.repeat && orig.repeat !== 'never') {
    const rule = calendarEntries.find(e =>
      e.startDate === orig.startDate && e.recipeId === orig.recipeId && e.meal === orig.meal && e.repeat === orig.repeat
    );
    if (rule) {
      if (orig.date === rule.startDate) {
        calendarEntries = calendarEntries.filter(e => e !== rule);
      } else {
        rule.until = orig.date;
      }
    }
  } else {
    calendarEntries = calendarEntries.filter(e =>
      !(e.date === orig.date && e.recipeId === orig.recipeId && e.meal === orig.meal)
    );
  }

  _calendarEditingEntry = null;
  saveCalendarEntries();
  renderCalendarEntries();
  if (shoppingList && lastShoppingList) renderStoresOverview();
}

function applyDeleteCalendarOccurrence() {
  if (!_calendarEditingEntry) return;
  const orig = _calendarEditingEntry;
  const rule = calendarEntries.find(e =>
    e.startDate === orig.startDate && e.recipeId === orig.recipeId && e.meal === orig.meal && e.repeat === orig.repeat
  );
  if (rule) {
    if (!Array.isArray(rule.excludedDates)) rule.excludedDates = [];
    if (!rule.excludedDates.includes(orig.date)) rule.excludedDates.push(orig.date);
  }
  _calendarEditingEntry = null;
  saveCalendarEntries();
  renderCalendarEntries();
  if (shoppingList && lastShoppingList) renderStoresOverview();
}

if (deleteCalendarEntryBtn) {
  deleteCalendarEntryBtn.addEventListener('click', () => {
    if (!_calendarEditingEntry) return;
    const isRecurring = _calendarEditingEntry.repeat && _calendarEditingEntry.repeat !== 'never';
    if (isRecurring) {
      if (deleteCalendarConfirmModal) deleteCalendarConfirmModal.classList.remove('hidden');
    } else {
      applyDeleteCalendarEntry();
      if (calendarModal) closeModal(calendarModal);
    }
  });
}

if (confirmDeleteOccurrenceBtn) {
  confirmDeleteOccurrenceBtn.addEventListener('click', () => {
    applyDeleteCalendarOccurrence();
    if (deleteCalendarConfirmModal) deleteCalendarConfirmModal.classList.add('hidden');
    if (calendarModal) closeModal(calendarModal);
  });
}

if (confirmDeleteAllBtn) {
  confirmDeleteAllBtn.addEventListener('click', () => {
    applyDeleteCalendarEntry();
    if (deleteCalendarConfirmModal) deleteCalendarConfirmModal.classList.add('hidden');
    if (calendarModal) closeModal(calendarModal);
  });
}

if (confirmDeleteCancelBtn) {
  confirmDeleteCancelBtn.addEventListener('click', () => {
    if (deleteCalendarConfirmModal) deleteCalendarConfirmModal.classList.add('hidden');
  });
}

function openCalendarModalPreset(date, meal, mode = 'create', recipeId = null, repeat = null, entry = null) {
  setCalendarDate(date);
  if (calendarMealSelect) calendarMealSelect.value = meal;
  if (mode === 'create') {
    if (calendarRecipeSelect) calendarRecipeSelect.value = '';
    if (calendarRepeatSelect) calendarRepeatSelect.value = 'never';
    syncWeekdayPicker();
  } else {
    if (recipeId !== null && calendarRecipeSelect) calendarRecipeSelect.value = recipeId;
    if (repeat !== null && calendarRepeatSelect) calendarRepeatSelect.value = repeat;
    const days = entry?.days?.length
      ? entry.days
      : (date ? [new Date(date + 'T12:00:00').getDay()] : []);
    syncWeekdayPicker(days);
  }
  _calendarEditingEntry = mode === 'edit' ? entry : null;
  setCalendarModalMode(mode);
  openModal(calendarModal);
}

if (openCalendarModalBtn && calendarModal && closeCalendarModalBtn) {
  openCalendarModalBtn.addEventListener('click', () => {
    _calendarEditingEntry = null;
    if (calendarRecipeSelect) calendarRecipeSelect.value = '';
    if (calendarMealSelect) calendarMealSelect.value = '';
    setCalendarDate('');
    if (calendarRepeatSelect) calendarRepeatSelect.value = 'never';
    syncWeekdayPicker();
    setCalendarModalMode('create');
    openModal(calendarModal);
  });

  closeCalendarModalBtn.addEventListener('click', () => {
    closeModal(calendarModal);
  });

  // Cerrar al hacer click fuera del contenido
  calendarModal.addEventListener('click', (e) => {
    if (e.target === calendarModal) {
      closeModal(calendarModal);
    }
  });
}



// 🛒 LISTA DE LA COMPRA
const shoppingForm = document.getElementById('shoppingForm');
const shoppingStartInput = document.getElementById('shoppingStart');
const shoppingEndInput = document.getElementById('shoppingEnd');

function syncShoppingDateWrapper(input) {
  const wrapper = input?.closest('.date-picker');
  if (!wrapper) return;
  if (input.value) wrapper.setAttribute('data-has-value', '');
  else wrapper.removeAttribute('data-has-value');
}

[shoppingStartInput, shoppingEndInput].forEach(input => {
  if (input) input.addEventListener('change', () => syncShoppingDateWrapper(input));
});
const shoppingList = document.getElementById('shoppingList');
const shoppingDateRange = document.getElementById('shoppingDateRange');

const shoppingTabButtons = document.querySelectorAll('.shopping-tab-btn');
const shoppingTabByStore = document.getElementById('shoppingTabByStore');
const shoppingTabByLocation = document.getElementById('shoppingTabByLocation');

function setShoppingTab(tabKey) {
  shoppingTabButtons.forEach((b) => b.classList.toggle('active', b.dataset.shoppingTab === tabKey));

  if (shoppingTabByStore) shoppingTabByStore.classList.toggle('active', tabKey === 'by-store');
  if (shoppingTabByLocation) shoppingTabByLocation.classList.toggle('active', tabKey === 'by-location');
}

shoppingTabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    setShoppingTab(btn.dataset.shoppingTab);
  });
});

// ✅ Tab por defecto
setShoppingTab('by-store');

// -----------------------
// MODAL GENERAR LISTA
// -----------------------
const openShoppingModalBtn = document.getElementById('openShoppingModal');
const shoppingModal = document.getElementById('shoppingModal');
const closeShoppingModalBtn = document.getElementById('closeShoppingModal');

if (openShoppingModalBtn && shoppingModal) {
  openShoppingModalBtn.addEventListener('click', () => {
    openModal(shoppingModal);
  });
}

if (closeShoppingModalBtn && shoppingModal) {
  closeShoppingModalBtn.addEventListener('click', () => {
    closeModal(shoppingModal);
  });
}

if (shoppingModal) {
  shoppingModal.addEventListener('click', (e) => {
    if (e.target === shoppingModal) closeModal(shoppingModal);
  });
}

// -----------------------
// MODAL "PANTALLA" LISTA POR COMERCIO
// -----------------------
const storeShoppingModal = document.getElementById('storeShoppingModal');
const closeStoreShoppingModalBtn = document.getElementById('closeStoreShoppingModal');
const storeShoppingModalTitle = document.getElementById('storeShoppingModalTitle');
const storeShoppingModalList = document.getElementById('storeShoppingModalList');
const storeShoppingModalMeta = document.getElementById('storeShoppingModalMeta');

let selectedStoreKey = null;

if (closeStoreShoppingModalBtn) {
  closeStoreShoppingModalBtn.addEventListener('click', () => {
    closeModal(storeShoppingModal);
    selectedStoreKey = null;
  });
}

if (storeShoppingModal) {
  storeShoppingModal.addEventListener('click', (e) => {
    if (e.target === storeShoppingModal) {
      closeModal(storeShoppingModal);
      selectedStoreKey = null;
    }
  });
}

if (shoppingForm) {
  shoppingForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const startDate = shoppingStartInput.value;
    const endDate = shoppingEndInput.value;

    if (!startDate || !endDate) return;

    generateShoppingList(startDate, endDate);

    // Cerrar modal
    if (shoppingModal) closeModal(shoppingModal);
  });
}

if (calendarForm) {
  calendarForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const date = calendarDateInput.value;                 // "YYYY-MM-DD"
    const recipeId = Number(calendarRecipeSelect.value);
    const repeat = calendarRepeatSelect?.value || 'never';

    // Si tienes el campo "Ingesta", léelo aquí (ajusta el id si es distinto)
    const mealSelect = document.getElementById('calendarMeal'); // <- si tu select se llama distinto, cámbialo
    const meal = mealSelect ? mealSelect.value : null;

    if (!date || !recipeId || !meal) return;

    if (_calendarEditingEntry) {
      const orig = _calendarEditingEntry;
      calendarEntries = calendarEntries.filter(e => {
        if (orig.repeat && orig.repeat !== 'never') {
          return !(e.startDate === orig.startDate && e.recipeId === orig.recipeId && e.meal === orig.meal && e.repeat === orig.repeat);
        }
        return !(e.date === orig.date && e.recipeId === orig.recipeId && e.meal === orig.meal);
      });
      _calendarEditingEntry = null;
    }

    if (repeat === 'never') {
      addCalendarEntry({ date, recipeId, meal });
    }

    if (repeat === 'daily') {
      addCalendarEntry({
        startDate: date,     // 👈 importante: startDate (no date)
        recipeId,
        meal,
        repeat: 'daily',
      });
    }

    if (repeat === 'weekly') {
      const days = getSelectedWeekdays();
      addCalendarEntry({
        startDate: date,
        recipeId,
        meal,
        repeat: 'weekly',
        days: days.length > 0 ? days : [new Date(date + 'T12:00:00').getDay()],
      });
    }

    saveCalendarEntries();
    renderCalendarEntries();

    // Si tienes lista de compra ya generada, repíntala (sin recargar)
    if (shoppingList && lastShoppingList) renderStoresOverview();

    calendarForm.reset();
    if (calendarModal) closeModal(calendarModal);
  });
}


function renderIngredientSelectors() {
  if (!ingredientSelectors) return;

  const selects = ingredientSelectors.querySelectorAll('select');
  selects.forEach((select) => {
    const selectedValue = select.value;
    select.innerHTML = '';

    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = 'Selecciona un ingrediente';
    ph.disabled = true;
    select.appendChild(ph);

    const sorted = [...ingredients].sort((a, b) => a.name.localeCompare(b.name, 'es'));
    sorted.forEach((ingredient) => {
      const option = document.createElement('option');
      option.value = ingredient.id;
      option.textContent = ingredient.name;
      select.appendChild(option);
    });

    if ([...select.options].some(o => o.value === selectedValue)) {
      select.value = selectedValue;
    } else {
      ph.selected = true;
    }
  });
}

function makeRemoveIngredientRowBtn(row, savedIngredientId) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'recipe-ingredient-remove-btn';
  btn.setAttribute('aria-label', 'Eliminar ingrediente de la receta');
  btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;

  btn.addEventListener('click', () => {
    row.remove();

    if (!editingRecipeId || savedIngredientId == null) return;

    const recipe = recipes.find(r => r.id === editingRecipeId);
    if (!recipe) return;

    const item = recipe.ingredients.find(i => i.ingredientId === Number(savedIngredientId));
    if (!item) return;

    const removedQty = Number(item.quantity);
    recipe.ingredients = recipe.ingredients.filter(i => i.ingredientId !== Number(savedIngredientId));
    saveRecipes();

    if (lastShoppingList?.items?.length && lastShoppingList.startDate && lastShoppingList.endDate) {
      const entries = getExpandedCalendarEntriesInRange(lastShoppingList.startDate, lastShoppingList.endDate);
      const recipeCount = entries.filter(e => e.recipeId === editingRecipeId).length;

      if (recipeCount > 0) {
        const contribution = removedQty * recipeCount;
        const idx = lastShoppingList.items.findIndex(i => i.ingredientId === Number(savedIngredientId));
        if (idx !== -1) {
          lastShoppingList.items[idx].plannedQuantity -= contribution;
          if (lastShoppingList.items[idx].plannedQuantity <= 0) {
            lastShoppingList.items.splice(idx, 1);
          }
          saveLastShoppingList();
          renderLocationsOverview();
          if (shoppingList) renderStoresOverview();
        }
      }
    }
  });

  return btn;
}

function addIngredientRow() {
  if (!ingredientSelectors) return;

  if (ingredients.length === 0) {
    alert('Añade primero algún ingrediente');
    return;
  }

  const div = document.createElement('div');
  div.className = 'recipe-ingredient-row';

  const select = document.createElement('select');
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Selecciona un ingrediente';
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);

  const sortedIngredients = [...ingredients].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  sortedIngredients.forEach((ingredient) => {
    const option = document.createElement('option');
    option.value = ingredient.id;
    option.textContent = ingredient.name;
    select.appendChild(option);
  });

  const qtyWrapper = document.createElement('div');
  qtyWrapper.className = 'recipe-qty-wrapper';

  const input = document.createElement('input');
  input.type = 'number';
  input.placeholder = 'Cantidad';
  input.min = '1';

  const unitSpan = document.createElement('span');
  unitSpan.className = 'recipe-ingredient-unit';
  const firstIngredient = sortedIngredients.find(i => i.id === Number(select.value));
  unitSpan.textContent = firstIngredient?.unit ?? '';

  select.addEventListener('change', () => {
    const ing = ingredients.find(i => i.id === Number(select.value));
    unitSpan.textContent = ing?.unit ?? '';
  });

  qtyWrapper.appendChild(input);
  qtyWrapper.appendChild(unitSpan);
  div.appendChild(select);
  div.appendChild(qtyWrapper);
  div.appendChild(makeRemoveIngredientRowBtn(div, null));

  ingredientSelectors.appendChild(div);
}

if (addIngredientBtn) {
  addIngredientBtn.addEventListener('click', addIngredientRow);
}

function autoSaveRecipe() {
  if (!editingRecipeId) return;
  if (!window.matchMedia('(min-width: 768px)').matches) return;

  const name = recipeNameInput?.value.trim();
  if (!name) return;

  const recipe = recipes.find(r => r.id === editingRecipeId);
  if (!recipe) return;

  const recipeIngredients = [];
  ingredientSelectors?.querySelectorAll('.recipe-ingredient-row').forEach(row => {
    const select = row.querySelector('select');
    const input = row.querySelector('input');
    if (!select || !input) return;
    const ingredientId = select.value;
    const quantity = input.value;
    if (ingredientId && quantity) {
      recipeIngredients.push({
        ingredientId: Number(ingredientId),
        quantity: Number(quantity),
      });
    }
  });

  recipe.name = name;
  recipe.ingredients = recipeIngredients;
  saveRecipes();
  renderRecipes();
  if (calendarList) renderCalendarEntries();

  const savedId = editingRecipeId;
  document.querySelector(`.recipe-table tr[data-id="${savedId}"]`)
    ?.classList.add('is-selected');
}

recipeNameInput?.addEventListener('change', () => autoSaveRecipe());
ingredientSelectors?.addEventListener('change', () => autoSaveRecipe());

if (recipeForm) {
  recipeForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const ingredientRows = ingredientSelectors.querySelectorAll('.recipe-ingredient-row');

    const recipeIngredients = [];

    ingredientRows.forEach((row) => {
      const select = row.querySelector('select');
      const input = row.querySelector('input');
      if (!select || !input) return;

      const ingredientId = select.value;
      const quantity = input.value;

      // 👇 Solo añadimos si ambos tienen valor
      if (ingredientId && quantity) {
        recipeIngredients.push({
          ingredientId: Number(ingredientId),
          quantity: Number(quantity),
        });
      }
    });

    // ✅ SOLO validamos el título
    if (!recipeNameInput.value.trim()) {
      alert('Rellena el nombre de la receta');
      return;
    }

    if (editingRecipeId) {
      const recipe = recipes.find((r) => r.id === editingRecipeId);
      recipe.name = recipeNameInput.value.trim();
      recipe.ingredients = recipeIngredients;
    } else {
      recipes.push({
        id: Date.now(),
        name: recipeNameInput.value.trim(),
        ingredients: recipeIngredients, // puede ser []
      });
    }

    saveRecipes();
    renderRecipes();
    closeRecipePanel();
  });
}

function deleteRecipe(id) {
  const recipe = recipes.find(r => r.id === id);
  if (!recipe) return;
  const ok = confirm(`¿Seguro que quieres eliminar "${recipe.name}"?`);
  if (!ok) return;
  recipes = recipes.filter(r => r.id !== id);
  calendarEntries = calendarEntries.filter(e => e.recipeId !== id);
  saveRecipes();
  saveCalendarEntries();
  if (editingRecipeId === id) {
    closeRecipePanel();
  }
  renderRecipes();
}

function renderRecipesTable(data) {
  const sorted = [...data].sort((a, b) => {
    const cmp = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
    return _recipeSort.dir === 'asc' ? cmp : -cmp;
  });

  const table = document.createElement('table');
  table.className = 'ingredient-table recipe-table';

  const arrow = _recipeSort.dir === 'asc' ? '↑' : '↓';
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  const thName = document.createElement('th');
  thName.className = 'ingredient-th-sortable is-active';
  thName.innerHTML = `Nombre<span class="sort-arrow">${arrow}</span>`;
  thName.addEventListener('click', () => {
    _recipeSort.dir = _recipeSort.dir === 'asc' ? 'desc' : 'asc';
    renderRecipes();
  });

  const thCount = document.createElement('th');
  thCount.textContent = 'Ingredientes';

  headerRow.appendChild(thName);
  headerRow.appendChild(thCount);
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  sorted.forEach(recipe => {
    const tr = document.createElement('tr');
    tr.dataset.id = recipe.id;
    tr.style.cursor = 'pointer';
    const count = Array.isArray(recipe.ingredients) ? recipe.ingredients.length : 0;
    tr.innerHTML = `
      <td>${recipe.name}</td>
      <td class="recipe-table-count"></td>
    `;

    const countCell = tr.querySelector('.recipe-table-count');
    countCell.textContent = count;

    tr.addEventListener('click', () => {
      document.querySelectorAll('.recipe-table tr.is-selected')
        .forEach(r => r.classList.remove('is-selected'));
      tr.classList.add('is-selected');
      startEditRecipe(recipe.id);
      openRecipePanel();
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  recipeList.appendChild(table);
}

function renderRecipes() {
  if (!recipeList) return;

  recipeList.innerHTML = '';

  const filteredRecipes = _recipeSearch
    ? recipes.filter(r => r.name.toLowerCase().includes(_recipeSearch.toLowerCase()))
    : recipes;

  if (window.innerWidth >= 768) {
    renderRecipesTable(filteredRecipes);
  } else {
    const ul = document.createElement('ul');
    filteredRecipes.forEach((recipe) => {
      const li = document.createElement('li');
      li.className = 'recipe-row';
      li.dataset.id = recipe.id;

      li.innerHTML = `
        <div class="recipe-row-content">
          <span class="recipe-row-name">${recipe.name}</span>
          <span class="recipe-row-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
        </div>
      `;
      li.addEventListener('click', () => {
        openRecipeDetailModal(recipe.id);
      });
      ul.appendChild(li);
    });
    recipeList.appendChild(ul);
  }

  renderCalendarRecipeSelect();
}

function startEditRecipe(recipeId) {
  const recipe = recipes.find((r) => r.id === recipeId);
  if (!recipe) return;

  editingRecipeId = recipeId;

  const title = document.getElementById('recipeModalTitle');
  if (title) title.textContent = 'Editar receta';

  // Rellenar nombre
  recipeNameInput.value = recipe.name;

  // Limpiar ingredientes actuales
  ingredientSelectors.innerHTML = '';

  // Rellenar ingredientes del cocinado
  recipe.ingredients.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'recipe-ingredient-row';

    const select = document.createElement('select');
    const sortedForEdit = [...ingredients].sort((a, b) => a.name.localeCompare(b.name, 'es'));
    sortedForEdit.forEach((ingredient) => {
      const option = document.createElement('option');
      option.value = ingredient.id;
      option.textContent = ingredient.name;
      if (ingredient.id === item.ingredientId) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    const qtyWrapper = document.createElement('div');
    qtyWrapper.className = 'recipe-qty-wrapper';

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.placeholder = 'Cantidad';
    input.value = item.quantity;

    const unitSpan = document.createElement('span');
    unitSpan.className = 'recipe-ingredient-unit';
    const selectedIng = ingredients.find(i => i.id === item.ingredientId);
    unitSpan.textContent = selectedIng?.unit ?? '';

    select.addEventListener('change', () => {
      const ing = ingredients.find(i => i.id === Number(select.value));
      unitSpan.textContent = ing?.unit ?? '';
    });

    qtyWrapper.appendChild(input);
    qtyWrapper.appendChild(unitSpan);
    row.appendChild(select);
    row.appendChild(qtyWrapper);
    row.appendChild(makeRemoveIngredientRowBtn(row, item.ingredientId));
    ingredientSelectors.appendChild(row);
  });

  if (saveRecipeBtn) saveRecipeBtn.classList.add('hidden');

  if (deleteRecipeBtn) deleteRecipeBtn.classList.remove('hidden');

}

function resetRecipeForm() {
  editingRecipeId = null;
  if (recipeForm) recipeForm.reset();
  if (ingredientSelectors) ingredientSelectors.innerHTML = '';
  if (saveRecipeBtn) { saveRecipeBtn.textContent = 'Crear'; saveRecipeBtn.classList.remove('hidden'); }
  if (deleteRecipeBtn) deleteRecipeBtn.classList.add('hidden');
}

if (deleteRecipeBtn) {
  deleteRecipeBtn.addEventListener('click', () => {
    if (!editingRecipeId) return;

    const ok = confirm('¿Seguro que quieres eliminar esta receta?');
    if (!ok) return;

    recipes = recipes.filter((r) => r.id !== editingRecipeId);
    saveRecipes();
    renderRecipes();

    // Opcional: limpiar calendario de esa receta (recomendado)
    calendarEntries = calendarEntries.filter((e) => e.recipeId !== editingRecipeId);
    saveCalendarEntries();
    if (calendarList) renderCalendarEntries();
    if (shoppingList && lastShoppingList) renderStoresOverview();

    closeRecipePanel();
  });
}




// -----------------------
// MODAL: eliminar receta de planificación
// -----------------------
const calendarRecipeModal = document.getElementById('calendarRecipeModal');
const closeCalendarRecipeModalBtn = document.getElementById('closeCalendarRecipeModal');
const calendarRecipeModalTitle = document.getElementById('calendarRecipeModalTitle');
const calendarRecipeModalDate = document.getElementById('calendarRecipeModalDate');
const calendarRecipeModalMeal = document.getElementById('calendarRecipeModalMeal');
const calendarRecipeModalRepeat = document.getElementById('calendarRecipeModalRepeat');
const confirmRemoveCalendarRecipeBtn = document.getElementById('confirmRemoveCalendarRecipe');

let selectedCalendarDate = null;       // para "never" (día concreto)
let selectedCalendarRecipeId = null;
let selectedCalendarMeal = null;

let selectedCalendarRepeat = 'never';  // 'never' | 'daily' | 'weekly'
let selectedCalendarStartDate = null;  // para patrones (daily/weekly)

function openCalendarRecipeModal(entry) {
  const recipe = recipes.find((r) => r.id === entry.recipeId);
  if (!recipe) return;

  selectedCalendarDate = entry.date;                 // día mostrado
  selectedCalendarRecipeId = entry.recipeId;
  selectedCalendarMeal = entry.meal;

  selectedCalendarRepeat = entry.repeat || 'never';
  selectedCalendarStartDate = entry.startDate || null;

  if (calendarRecipeModalTitle) calendarRecipeModalTitle.textContent = recipe.name;
  if (calendarRecipeModalDate) calendarRecipeModalDate.textContent = formatDateReadableLongMonth(entry.date);
  if (calendarRecipeModalMeal) calendarRecipeModalMeal.textContent = MEAL_LABELS[entry.meal] || entry.meal;
  if (calendarRecipeModalRepeat) {

    if (entry.repeat === 'daily') {
      calendarRecipeModalRepeat.textContent = 'Se repite diariamente';
      calendarRecipeModalRepeat.classList.remove('hidden');
    }

    else if (entry.repeat === 'weekly') {
      const text = Array.isArray(entry.days) && entry.days.length > 0
        ? buildWeeklyRepeatText(entry.days)
        : (() => { const w = getWeekdayName(entry.startDate); return `Todos los ${WEEKDAY_PLURAL[w] || w}`; })();
      calendarRecipeModalRepeat.textContent = `Se repite: ${text}.`;
      calendarRecipeModalRepeat.classList.remove('hidden');
    }

    else {
      calendarRecipeModalRepeat.textContent = '';
      calendarRecipeModalRepeat.classList.add('hidden');
    }
  }

  openModal(calendarRecipeModal);
}

function closeCalendarRecipeModal() {
  closeModal(calendarRecipeModal);

  selectedCalendarDate = null;
  selectedCalendarRecipeId = null;
  selectedCalendarMeal = null;

  selectedCalendarRepeat = 'never';
  selectedCalendarStartDate = null;
}

if (closeCalendarRecipeModalBtn) {
  closeCalendarRecipeModalBtn.addEventListener('click', closeCalendarRecipeModal);
}

if (calendarRecipeModal) {
  calendarRecipeModal.addEventListener('click', (e) => {
    if (e.target === calendarRecipeModal) closeCalendarRecipeModal();
  });
}

if (confirmRemoveCalendarRecipeBtn) {
  confirmRemoveCalendarRecipeBtn.addEventListener('click', () => {
    const ok = window.confirm('¿Seguro que quieres eliminar este cocinado del calendario?');
    if (!ok) return;

    removeCalendarEntrySelected();
    closeCalendarRecipeModal();

    if (shoppingList && lastShoppingList) renderStoresOverview();
  });
}


function renderCalendarEntries() {
  if (!calendarList) return;

  calendarList.innerHTML = '';

  const today = new Date().toISOString().split('T')[0];

  const now = new Date();
  const base = calendarWeekView === 'next' ? addDays(now, 7) : now;

  const weekStart = startOfWeekMonday(base);
  const weekEnd = endOfWeekSunday(base);

  const weekStartISO = toISODateString(weekStart);
  const weekEndISO = toISODateString(weekEnd);

  // 🔁 Expandir repeticiones diarias dinámicamente
const end = addDays(new Date(), 21);

const expandedEntries = [];

calendarEntries.forEach((entry) => {
  // Si NO es repetición, se pinta tal cual
  if (entry.repeat !== 'daily' && entry.repeat !== 'weekly') {
    expandedEntries.push(entry);
    return;
  }

  const start = new Date(entry.startDate);
  if (Number.isNaN(start.getTime())) return; // seguridad

  const realEnd = start > end ? start : end;
  const excluded = Array.isArray(entry.excludedDates) ? entry.excludedDates : [];

  if (entry.repeat === 'weekly' && Array.isArray(entry.days) && entry.days.length > 0) {
    entry.days.forEach(dow => {
      const diff = (dow - start.getDay() + 7) % 7;
      const firstOcc = addDays(start, diff);
      for (let d = new Date(firstOcc); d <= realEnd; d = addDays(d, 7)) {
        const iso = toISODateString(d);
        if (entry.until && iso >= entry.until) break;
        if (excluded.includes(iso)) continue;
        expandedEntries.push({ date: iso, recipeId: entry.recipeId, meal: entry.meal, repeat: entry.repeat, startDate: entry.startDate, days: entry.days });
      }
    });
  } else {
    const step = entry.repeat === 'weekly' ? 7 : 1;
    for (let d = new Date(start); d <= realEnd; d = addDays(d, step)) {
      const iso = toISODateString(d);
      if (entry.until && iso >= entry.until) break;
      if (excluded.includes(iso)) continue;
      expandedEntries.push({ date: iso, recipeId: entry.recipeId, meal: entry.meal, repeat: entry.repeat, startDate: entry.startDate });
    }
  }
});

// 1️⃣ Agrupar por fecha
const entriesByDate = {};
expandedEntries.forEach((entry) => {
    if (!entriesByDate[entry.date]) entriesByDate[entry.date] = [];
    entriesByDate[entry.date].push(entry);
  });

// 2️⃣ Generar SIEMPRE los 7 días de la semana (aunque estén vacíos)
const weekDates = [];
for (let i = 0; i < 7; i++) {
  weekDates.push(toISODateString(addDays(weekStart, i)));
}

// 3️⃣ Renderizar SIEMPRE todos los días
weekDates.forEach((date) => {
  const li = document.createElement('li');

  if (date === today) li.classList.add('today');

  const readableDate = window.innerWidth >= 768
    ? (() => {
        const d = parseISODate(date);
        const weekday = d.toLocaleDateString('es-ES', { weekday: 'long' });
        return weekday.charAt(0).toUpperCase() + weekday.slice(1) + ' ' + d.getDate();
      })()
    : formatDateReadable(date);

  const title = document.createElement('strong');
  title.textContent = readableDate;
  li.appendChild(title);

  const dayEntries = entriesByDate[date] || [];

  const MEAL_KEYS = ['desayuno', 'media-manana', 'almuerzo', 'merienda', 'cena'];
  const REPEAT_SVG = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><g style="mix-blend-mode:plus-darker"><path d="M6.89258 1.75391C6.89258 1.64453 6.92253 1.5612 6.98242 1.50391C7.04492 1.44401 7.13216 1.41406 7.24414 1.41406C7.29622 1.41406 7.3444 1.42188 7.38867 1.4375C7.43294 1.45312 7.47591 1.47786 7.51758 1.51172L9.4668 3.11328C9.55794 3.1862 9.60221 3.27474 9.59961 3.37891C9.59701 3.48307 9.55273 3.57161 9.4668 3.64453L7.51758 5.24609C7.47591 5.27734 7.43294 5.30208 7.38867 5.32031C7.3444 5.33594 7.29622 5.34375 7.24414 5.34375C7.13216 5.34375 7.04492 5.3138 6.98242 5.25391C6.92253 5.19401 6.89258 5.10938 6.89258 5V1.75391ZM1.06445 6.20312C0.934245 6.20312 0.82487 6.15885 0.736328 6.07031C0.647786 5.97917 0.603516 5.86979 0.603516 5.74219V5.21094C0.603516 4.73958 0.705078 4.33333 0.908203 3.99219C1.11393 3.64844 1.4056 3.38542 1.7832 3.20312C2.16341 3.01823 2.61654 2.92578 3.14258 2.92578H7.63867C7.76367 2.92578 7.87044 2.97005 7.95898 3.05859C8.04753 3.14453 8.0918 3.2513 8.0918 3.37891C8.0918 3.5013 8.04753 3.60807 7.95898 3.69922C7.87044 3.78776 7.76367 3.83203 7.63867 3.83203H3.08008C2.60091 3.83203 2.2207 3.96354 1.93945 4.22656C1.66081 4.48698 1.52148 4.84245 1.52148 5.29297V5.74219C1.52148 5.86979 1.47721 5.97917 1.38867 6.07031C1.30273 6.15885 1.19466 6.20312 1.06445 6.20312ZM5.10742 10.2383C5.10742 10.3503 5.07617 10.4362 5.01367 10.4961C4.95117 10.556 4.86523 10.5859 4.75586 10.5859C4.70638 10.5859 4.6582 10.5768 4.61133 10.5586C4.56445 10.543 4.52148 10.5195 4.48242 10.4883L2.53711 8.88281C2.44336 8.8099 2.39779 8.72135 2.40039 8.61719C2.40299 8.51302 2.44857 8.42448 2.53711 8.35156L4.48242 6.74609C4.52148 6.71484 4.56445 6.69141 4.61133 6.67578C4.6582 6.65755 4.70638 6.64844 4.75586 6.64844C4.86523 6.64844 4.95117 6.67969 5.01367 6.74219C5.07617 6.80208 5.10742 6.88672 5.10742 6.99609V10.2383ZM10.9355 5.79297C11.0658 5.79297 11.1751 5.83724 11.2637 5.92578C11.3522 6.01432 11.3965 6.1237 11.3965 6.25391V6.78516C11.3965 7.25911 11.2936 7.66797 11.0879 8.01172C10.8848 8.35286 10.5931 8.61589 10.2129 8.80078C9.83268 8.98307 9.38086 9.07422 8.85742 9.07422H4.36133C4.23633 9.07422 4.12956 9.02995 4.04102 8.94141C3.95247 8.85286 3.9082 8.74609 3.9082 8.62109C3.9082 8.49349 3.95247 8.38672 4.04102 8.30078C4.12956 8.21224 4.23633 8.16797 4.36133 8.16797H8.91992C9.39909 8.16797 9.77799 8.03646 10.0566 7.77344C10.3353 7.51042 10.4746 7.15365 10.4746 6.70312V6.25391C10.4746 6.1237 10.5189 6.01432 10.6074 5.92578C10.696 5.83724 10.8053 5.79297 10.9355 5.79297Z" fill="currentcolor"/></g></svg>`;

  if (window.innerWidth >= 768) {
    // Desktop: agrupar por ingesta, mostrar todas aunque estén vacías
    const byMeal = {};
    MEAL_KEYS.forEach(k => { byMeal[k] = []; });
    dayEntries.forEach(entry => {
      if (byMeal[entry.meal]) byMeal[entry.meal].push(entry);
    });

    MEAL_KEYS.forEach(mealKey => {
      const group = document.createElement('div');
      group.className = 'calendar-meal-group';

      const groupHeader = document.createElement('div');
      groupHeader.className = 'calendar-meal-group-header';

      const groupLabel = document.createElement('div');
      groupLabel.className = 'calendar-meal-group-label';
      groupLabel.textContent = MEAL_LABELS[mealKey];

      const addBtn = document.createElement('button');
      addBtn.className = 'calendar-meal-add-btn';
      addBtn.type = 'button';
      addBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openCalendarModalPreset(date, mealKey);
      });

      groupHeader.appendChild(groupLabel);
      groupHeader.appendChild(addBtn);
      group.appendChild(groupHeader);

      const mealEntries = byMeal[mealKey];
      if (mealEntries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'calendar-meal-group-empty';
        group.appendChild(empty);
      } else {
        mealEntries.forEach(entry => {
          const recipe = recipes.find(r => r.id === entry.recipeId);
          if (!recipe) return;

          const row = document.createElement('div');
          row.className = 'calendar-recipe-row';
          if (!recipe.ingredients || recipe.ingredients.length === 0) {
            row.classList.add('is-no-ingredients');
          }

          const recipeNameEl = document.createElement('div');
          recipeNameEl.className = 'calendar-recipe-name';
          recipeNameEl.textContent = recipe.name;
          row.appendChild(recipeNameEl);

          if (entry.repeat === 'daily' || entry.repeat === 'weekly') {
            const repeatRow = document.createElement('div');
            repeatRow.className = 'calendar-repeat-row';

            const repeatIcon = document.createElement('span');
            repeatIcon.className = 'calendar-repeat-icon';
            repeatIcon.innerHTML = REPEAT_SVG;

            const repeatText = document.createElement('span');
            repeatText.className = 'calendar-repeat-text';
            if (entry.repeat === 'daily') {
              repeatText.textContent = 'Todos los días';
            } else if (Array.isArray(entry.days) && entry.days.length > 0) {
              repeatText.textContent = buildWeeklyRepeatText(entry.days);
            } else {
              const weekday = getWeekdayName(entry.startDate);
              const plural = WEEKDAY_PLURAL[weekday] || weekday;
              repeatText.textContent = `Todos los ${plural}`;
            }

            repeatRow.appendChild(repeatIcon);
            repeatRow.appendChild(repeatText);
            row.appendChild(repeatRow);
          }

          if (window.innerWidth >= 768) {
            row.addEventListener('click', () => openCalendarModalPreset(date, entry.meal, 'edit', entry.recipeId, entry.repeat ?? 'never', entry));
          } else {
            row.addEventListener('click', () => openCalendarRecipeModal(entry));
          }
          group.appendChild(row);
        });
      }

      li.appendChild(group);
    });

  } else {
    // Mobile: comportamiento original
    const ul = document.createElement('ul');

    if (dayEntries.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'calendar-empty';
      emptyLi.textContent = 'Sin cocinados';
      ul.appendChild(emptyLi);
      li.appendChild(ul);
      calendarList.appendChild(li);
      return;
    }

    const MEAL_ORDER = { 'desayuno': 1, 'media-manana': 2, 'almuerzo': 3, 'merienda': 4, 'cena': 5 };
    dayEntries.sort((a, b) => (MEAL_ORDER[a.meal] ?? 999) - (MEAL_ORDER[b.meal] ?? 999));

    dayEntries.forEach((entry) => {
      const recipe = recipes.find((r) => r.id === entry.recipeId);
      if (!recipe) return;

      const recipeLi = document.createElement('li');
      recipeLi.classList.add('calendar-recipe-row');
      if (!recipe.ingredients || recipe.ingredients.length === 0) {
        recipeLi.classList.add('is-no-ingredients');
      }

      const mealEl = document.createElement('div');
      mealEl.className = 'calendar-meal';
      const mealRow = document.createElement('div');
      mealRow.className = 'calendar-meal-row';
      const mealText = document.createElement('span');
      mealText.className = 'calendar-meal-text';
      mealText.textContent = MEAL_LABELS[entry.meal] || entry.meal;
      mealRow.appendChild(mealText);

      if (entry.repeat === 'daily' || entry.repeat === 'weekly') {
        const repeatIcon = document.createElement('span');
        repeatIcon.className = 'calendar-repeat-icon';
        repeatIcon.innerHTML = REPEAT_SVG;
        mealRow.appendChild(repeatIcon);
      }

      mealEl.appendChild(mealRow);

      const recipeNameEl = document.createElement('div');
      recipeNameEl.className = 'calendar-recipe-name';
      recipeNameEl.textContent = recipe.name;

      recipeLi.appendChild(mealEl);
      recipeLi.appendChild(recipeNameEl);
      recipeLi.addEventListener('click', () => openCalendarRecipeModal(entry));
      ul.appendChild(recipeLi);
    });

    li.appendChild(ul);
  }

  calendarList.appendChild(li);
});

updateCalendarMonthLabel();
}

function removeRecipeFromCalendar(date, recipeId) {
  calendarEntries = calendarEntries.filter(
    (entry) =>
      !(entry.date === date && entry.recipeId === recipeId)
  );

  saveCalendarEntries();
  renderCalendarEntries();
}

function removeCalendarEntrySelected() {
  if (!selectedCalendarRecipeId || !selectedCalendarMeal) return;

  // Caso 1: entrada normal (never) -> borrar solo ese día
  if (selectedCalendarRepeat === 'never') {
    calendarEntries = calendarEntries.filter((e) => {
      const eRepeat = e.repeat || 'never';
      return !(
        eRepeat === 'never' &&
        e.date === selectedCalendarDate &&
        e.recipeId === selectedCalendarRecipeId &&
        e.meal === selectedCalendarMeal
      );
    });
  }

    // Caso 2: patrón (daily/weekly) -> borrar SOLO esa ocurrencia (añadiendo excepción)
  if (selectedCalendarRepeat === 'daily' || selectedCalendarRepeat === 'weekly') {
    const rule = calendarEntries.find((e) => {
      const eRepeat = e.repeat || 'never';
      const eStart = e.startDate || e.date; // la "fecha base" de la regla
      return (
        eRepeat === selectedCalendarRepeat &&
        eStart === selectedCalendarStartDate &&
        e.recipeId === selectedCalendarRecipeId &&
        e.meal === selectedCalendarMeal
      );
    });

    if (!rule) return;

    // Guardar fecha excluida (la fecha exacta que estás viendo/borrando)
    const dateToExclude = selectedCalendarDate; // la fecha expandida (YYYY-MM-DD)
    if (!dateToExclude) return;

    if (!Array.isArray(rule.excludedDates)) rule.excludedDates = [];
    if (!rule.excludedDates.includes(dateToExclude)) {
      rule.excludedDates.push(dateToExclude);
    }
  }

  saveCalendarEntries();
  renderCalendarEntries();
}


function generateShoppingList(startDate, endDate) {
  shoppingList.innerHTML = '';

  const entriesInRange = getExpandedCalendarEntriesInRange(startDate, endDate);

  const ingredientMap = {};

  entriesInRange.forEach((entry) => {
    const recipe = recipes.find(
      (r) => r.id === entry.recipeId
    );
    if (!recipe) return;

    recipe.ingredients.forEach((item) => {
      if (!ingredientMap[item.ingredientId]) {
        ingredientMap[item.ingredientId] = 0;
      }
      ingredientMap[item.ingredientId] += item.quantity;
    });
  });

  const sortedIngredients = Object.entries(ingredientMap)
  .map(([ingredientId, totalQuantity]) => {
    const ingredient = ingredients.find(
      (i) => i.id === Number(ingredientId)
    );
    if (!ingredient) return null;
    if (ingredient.shoppingType === 'mensual') return null;

    return {
      ingredientId: ingredient.id,
      name: ingredient.name,
      unit: ingredient.unit,
      quantity: totalQuantity,
    };
  })
  .filter(Boolean)
  .sort((a, b) =>
    a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
  );

  lastShoppingList = {
  startDate,
  endDate,
  items: sortedIngredients.map((item) => ({
    ingredientId: item.ingredientId,
    plannedQuantity: item.quantity,
    realQuantity: null, // 👈 editable por el usuario
  })),
};


  saveLastShoppingList();
  renderStoresOverview();
  renderLocationsOverview();
  renderShoppingDateRange();

}

function getExpandedCalendarEntriesInRange(startDate, endDate) {
  const endLimit = new Date(endDate);
  const expanded = [];

  calendarEntries.forEach((entry) => {
    const repeat = entry.repeat || 'never';

    // never -> usa date
    if (repeat === 'never') {
      if (entry.date && entry.date >= startDate && entry.date <= endDate) {
        expanded.push(entry);
      }
      return;
    }

    // daily/weekly -> expandir desde startDate de la regla
    const start = new Date(entry.startDate);
    if (Number.isNaN(start.getTime())) return;

    const excluded = Array.isArray(entry.excludedDates) ? entry.excludedDates : [];

    if (repeat === 'weekly' && Array.isArray(entry.days) && entry.days.length > 0) {
      entry.days.forEach(dow => {
        const diff = (dow - start.getDay() + 7) % 7;
        const firstOcc = addDays(start, diff);
        for (let d = new Date(firstOcc); d <= endLimit; d = addDays(d, 7)) {
          const iso = toISODateString(d);
          if (entry.until && iso >= entry.until) break;
          if (iso < startDate) continue;
          if (excluded.includes(iso)) continue;
          expanded.push({ date: iso, recipeId: entry.recipeId, meal: entry.meal, repeat, startDate: entry.startDate, days: entry.days });
        }
      });
    } else {
      const step = repeat === 'weekly' ? 7 : 1;
      for (let d = new Date(start); d <= endLimit; d = addDays(d, step)) {
        const iso = toISODateString(d);
        if (entry.until && iso >= entry.until) break;
        if (iso < startDate) continue;
        if (excluded.includes(iso)) continue;
        expanded.push({ date: iso, recipeId: entry.recipeId, meal: entry.meal, repeat, startDate: entry.startDate });
      }
    }
  });

  return expanded;
}


function ensureShoppingListItem(ingredientId) {
  if (!lastShoppingList?.items) return null;

  let item = lastShoppingList.items.find((x) => x.ingredientId === ingredientId);

  if (!item) {
    item = {
      ingredientId,
      plannedQuantity: null,
      realQuantity: null,
    };
    lastShoppingList.items.push(item);
    saveLastShoppingList();
  }

  return item;
}

function buildItemsByStoreFromState() {
  const itemsByStore = {};

  // Si no hay lista generada, no hay nada que mostrar por comercio
  if (!lastShoppingList?.items?.length) return itemsByStore;

  // Helper: solo se muestra en "por comercio" si el usuario puso algo en "Comprar"
  function shouldShowInStore(item) {
    return item && item.realQuantity != null; // null/undefined => no mostrar (0 sí se muestra)
  }

  // 1) Ingredientes pantry (pero SOLO si tienen "Comprar" informado)
  ingredients.forEach((ingredient) => {
    if (!ingredient.pantry) return;
    if (ingredient.shoppingType === 'mensual') return;

    const item = ensureShoppingListItem(ingredient.id);
    if (!shouldShowInStore(item)) return;

    const store = ingredient.store;
    if (!itemsByStore[store]) itemsByStore[store] = [];
    itemsByStore[store].push({ ingredient, item });
  });

  // 2) Ingredientes planificados (pero SOLO si tienen "Comprar" informado)
  lastShoppingList.items.forEach((item) => {
    if (!shouldShowInStore(item)) return;

    const ingredient = ingredients.find((i) => i.id === item.ingredientId);
    if (!ingredient) return;

    const store = ingredient.store;
    if (!itemsByStore[store]) itemsByStore[store] = [];

    // evitar duplicados (por si también es pantry)
    const alreadyExists = itemsByStore[store].some(
      (entry) => entry.ingredient.id === ingredient.id
    );
    if (!alreadyExists) {
      itemsByStore[store].push({ ingredient, item });
    }
  });

  return itemsByStore;
}

function buildItemsByLocationFromState() {
  const itemsByLocation = {};

  // helper para añadir una entrada a la ubicación
  function addToLocation(locationKey, ingredient, item) {
    const key = locationKey || 'sin-ubicacion';
    if (!itemsByLocation[key]) itemsByLocation[key] = [];

    // Evitar duplicados (pantry + planificado)
    const alreadyExists = itemsByLocation[key].some(
      (entry) => entry.ingredient.id === ingredient.id
    );

    if (!alreadyExists) {
      itemsByLocation[key].push({ ingredient, item });
    }
  }

  // 1) Pantry (siempre)
  ingredients.forEach((ingredient) => {
  if (!ingredient.pantry) return;
  if (ingredient.shoppingType === 'mensual') return;

  const item = ensureShoppingListItem(ingredient.id);
  if (!item) return;

  addToLocation(ingredient.location, ingredient, item);
});

  // 2) Planificados (lastShoppingList)
  if (lastShoppingList?.items?.length) {
    lastShoppingList.items.forEach((item) => {
      const ingredient = ingredients.find((i) => i.id === item.ingredientId);
      if (!ingredient) return;

      addToLocation(ingredient.location, ingredient, item);
    });
  }

  return itemsByLocation;
}

function renderShoppingListFromState() {
  if (!lastShoppingList) return;

  shoppingList.innerHTML = '';

  const itemsByStore = {};

  // 1️⃣ Añadir ingredientes básicos de despensa
  ingredients.forEach((ingredient) => {
    if (!ingredient.pantry) return;
    if (ingredient.shoppingType === 'mensual') return;

    const store = ingredient.store;

    if (!itemsByStore[store]) {
      itemsByStore[store] = [];
    }

    itemsByStore[store].push({
      ingredient,
      item: {
        ingredientId: ingredient.id,
        plannedQuantity: null,
        realQuantity: null,
        isPantry: true,
      },
    });
  });





  lastShoppingList.items.forEach((item) => {
  const ingredient = ingredients.find(
    (i) => i.id === item.ingredientId
  );
  if (!ingredient) return;

  const store = ingredient.store;

  if (!itemsByStore[store]) {
    itemsByStore[store] = [];
  }

  // 🔁 Evitar duplicados (pantry + planificado)
  const alreadyExists = itemsByStore[store].some(
    (entry) => entry.ingredient.id === ingredient.id
  );

  if (!alreadyExists) {
    itemsByStore[store].push({
      ingredient,
      item,
    });
  }
});


  Object.entries(itemsByStore).forEach(([store, entries]) => {
    // 🏷️ Título del comercio
    const storeTitle = document.createElement('h3');
    storeTitle.textContent = STORE_LABELS[store] || store;
    shoppingList.appendChild(storeTitle);

    const ul = document.createElement('ul');

    entries.forEach(({ ingredient, item }) => {
      const li = document.createElement('li');

      // Checkbox comprado
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!purchasedItems[item.ingredientId];

      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          purchasedItems[item.ingredientId] = true;
        } else {
          delete purchasedItems[item.ingredientId];
        }
        savePurchasedItems();
      });

      // Texto planificado
     

      const textWrapper = document.createElement('div');
      textWrapper.className = 'shopping-text';

      const nameEl = document.createElement('div');
      nameEl.className = 'shopping-name';
      nameEl.textContent = ingredient.name;

      const plannedEl = document.createElement('div');
      plannedEl.className = 'shopping-planned';

      let labelText = '';

      if (item.isPantry) {
        labelText = `Mínimo: ${formatMinQty(ingredient)}`;
      } else {
        const planned = item.plannedQuantity ?? item.quantity;
        labelText = `Planificado: ${planned} ${ingredient.unit}`;
      }

      plannedEl.textContent = labelText;


      textWrapper.appendChild(nameEl);
      textWrapper.appendChild(plannedEl);

      // Input cantidad real
      const realInput = document.createElement('input');
      realInput.type = 'number';
      realInput.min = 0;
      realInput.placeholder = 'Comprar...';
      if (item.realQuantity != null) {
        realInput.value = item.realQuantity;
      } else if (ingredient.pantry) {
        realInput.value = ingredient.minQuantity ?? '';
      } else {
        const planned = item.plannedQuantity ?? item.quantity ?? '';
        realInput.value = planned;
      }

      realInput.addEventListener('input', () => {
        item.realQuantity = realInput.value
          ? Number(realInput.value)
          : null;
        saveLastShoppingList();
      });

      const cbLabel = document.createElement('label');
      cbLabel.className = 'cb';

      checkbox.classList.add('cb-input'); // 👈 importante

      const cbBox = document.createElement('span');
      cbBox.className = 'cb-box';
      cbBox.setAttribute('aria-hidden', 'true');

      cbLabel.appendChild(checkbox);
      cbLabel.appendChild(cbBox);

      li.appendChild(cbLabel);
      li.appendChild(textWrapper);
      li.appendChild(realInput);

      ul.appendChild(li);
    });

    shoppingList.appendChild(ul);
  });
}

function renderStoresOverview() {
  if (!shoppingList) return;

  shoppingList.innerHTML = '';

  if (!lastShoppingList) {
  const p = document.createElement('p');
  p.textContent = 'Genera una lista de la compra para ver los comercios.';
  shoppingList.appendChild(p);
  return;
  } 

  const itemsByStore = buildItemsByStoreFromState();
  const stores = Object.keys(itemsByStore);

  if (stores.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'No hay productos en la lista de la compra.';
    shoppingList.appendChild(p);
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'store-list';

  stores.forEach((storeKey) => {
    const entries = itemsByStore[storeKey] || [];
    const total = entries.length;

    const purchasedCount = entries.reduce((acc, { item }) => {
      return acc + (purchasedItems[item.ingredientId] ? 1 : 0);
    }, 0);

    const row = document.createElement('div');
    row.className = 'store-row';

    row.innerHTML = `
      <div class="store-row-left">
        <div class="store-row-name">${STORE_LABELS[storeKey] || storeKey}</div>
        <div class="store-row-meta">${purchasedCount} / ${total}</div>
      </div>

      <span class="recipe-row-icon" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    `;

    row.addEventListener('click', () => openStoreShoppingModal(storeKey));
    wrapper.appendChild(row);
  });

  shoppingList.appendChild(wrapper);
}

function renderLocationsOverview() {
  if (!shoppingTabByLocation) return;

  shoppingTabByLocation.innerHTML = '';

  if (!lastShoppingList) {
    const p = document.createElement('p');
    p.textContent = 'Genera una lista de la compra para ver los productos por ubicación.';
    shoppingTabByLocation.appendChild(p);
    return;
  }

  const itemsByLocation = buildItemsByLocationFromState();
  const locationKeys = Object.keys(itemsByLocation);

  if (locationKeys.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'No hay productos en la lista de la compra.';
    shoppingTabByLocation.appendChild(p);
    return;
  }

  // Orden deseado
  const ORDER = ['decorativo', 'despensabalda', 'despensacajon01', 'despensacajon02', 'despensacajon03', 'despensacajon04', 'nevera', 'congelador', 'despensamueblealto', 'despensamueblebajo', 'sin-ubicacion'];
  locationKeys.sort((a, b) => (ORDER.indexOf(a) === -1 ? 999 : ORDER.indexOf(a)) - (ORDER.indexOf(b) === -1 ? 999 : ORDER.indexOf(b)));

  locationKeys.forEach((locationKey) => {
    const sectionTitle = document.createElement('h3');
    sectionTitle.textContent = LOCATION_LABELS[locationKey] || 'Sin ubicación';
    shoppingTabByLocation.appendChild(sectionTitle);

    const ul = document.createElement('ul');

    const entries = itemsByLocation[locationKey] || [];

    // (opcional) orden alfabético
    entries.sort((a, b) =>
      a.ingredient.name.localeCompare(b.ingredient.name, 'es', { sensitivity: 'base' })
    );

    entries.forEach(({ ingredient, item }) => {
      const li = document.createElement('li');

      // Checkbox comprado
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!purchasedItems[item.ingredientId];

      checkbox.addEventListener('change', () => {
        if (checkbox.checked) purchasedItems[item.ingredientId] = true;
        else delete purchasedItems[item.ingredientId];

        savePurchasedItems();

        // refrescar ambos renders para mantener contadores y checks consistentes
        renderStoresOverview();
        renderLocationsOverview();
      });

      // Texto
      const textWrapper = document.createElement('div');
      textWrapper.className = 'shopping-text';

      const nameEl = document.createElement('div');
      nameEl.className = 'shopping-name';
      nameEl.textContent = ingredient.name;

      const plannedEl = document.createElement('div');
      plannedEl.className = 'shopping-planned';

      if (ingredient.pantry) {
        plannedEl.textContent = `Mínimo: ${formatMinQty(ingredient)}`;
      } else {
        const planned = item.plannedQuantity ?? item.quantity;
        if (ingredient.formato && Number(ingredient.formato) > 0) {
          const units = Math.ceil(planned / Number(ingredient.formato));
          plannedEl.textContent = `Planificado: ${units} unidades`;
        } else {
          plannedEl.textContent = `Planificado: ${planned} ${ingredient.unit}`;
        }
      }

      textWrapper.appendChild(nameEl);
      textWrapper.appendChild(plannedEl);

      // Input cantidad real (✅ vacío por defecto)
      const realInput = document.createElement('input');
      realInput.type = 'number';
      realInput.min = 0;
      realInput.placeholder = 'Comprar...';

      // ✅ Solo rellena si el usuario ya había escrito algo antes.
      // Si no hay realQuantity guardado -> vacío.
      realInput.value = (item.realQuantity != null) ? item.realQuantity : '';

      realInput.addEventListener('input', () => {
        item.realQuantity = realInput.value ? Number(realInput.value) : null;
        saveLastShoppingList();

        // refrescar lista por comercio si el modal está abierto
        if (selectedStoreKey && storeShoppingModal && storeShoppingModal.classList.contains('is-open')) {
          renderStoreShoppingList(selectedStoreKey);
        }

        // refrescar contadores overview
        renderStoresOverview();
      });

      const cbLabel = document.createElement('label');
      cbLabel.className = 'cb';

      checkbox.classList.add('cb-input'); // 👈 importante

      const cbBox = document.createElement('span');
      cbBox.className = 'cb-box';
      cbBox.setAttribute('aria-hidden', 'true');

      cbLabel.appendChild(checkbox);
      cbLabel.appendChild(cbBox);

      li.appendChild(cbLabel);
      li.appendChild(textWrapper);
      li.appendChild(realInput);

      ul.appendChild(li);
    });

    shoppingTabByLocation.appendChild(ul);
  });
}

function openStoreShoppingModal(storeKey) {
  selectedStoreKey = storeKey;

  if (storeShoppingModalTitle) {
    storeShoppingModalTitle.textContent = STORE_LABELS[storeKey] || storeKey;
  }

  renderStoreShoppingProgress(storeKey);
  renderStoreShoppingList(storeKey);
  openModal(storeShoppingModal);
}

function renderStoreShoppingProgress(storeKey) {
  if (!storeShoppingModalMeta) return;

  const itemsByStore = buildItemsByStoreFromState();
  const entries = itemsByStore[storeKey] || [];

  const total = entries.length;
  const purchasedCount = entries.reduce((acc, { item }) => {
    return acc + (purchasedItems[item.ingredientId] ? 1 : 0);
  }, 0);

  storeShoppingModalMeta.textContent = `${purchasedCount} / ${total}`;
}


function renderStoreShoppingList(storeKey) {
  if (!storeShoppingModalList) return;

  storeShoppingModalList.innerHTML = '';

  const itemsByStore = buildItemsByStoreFromState();
  const entries = itemsByStore[storeKey] || [];

  // ✅ No marcados arriba, marcados abajo (y dentro de cada grupo, alfabético)
  entries.sort((a, b) => {
    const aDone = !!purchasedItems[a.item.ingredientId];
    const bDone = !!purchasedItems[b.item.ingredientId];

    if (aDone !== bDone) return aDone ? 1 : -1;

    return a.ingredient.name.localeCompare(b.ingredient.name, 'es', { sensitivity: 'base' });
  });

  if (entries.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'No hay productos para este comercio.';
    storeShoppingModalList.appendChild(p);
    return;
  }

  const ul = document.createElement('ul');

  function sortStoreList() {
    [...ul.children].sort((a, b) => {
      const aDone = a.classList.contains('is-complete') ? 1 : 0;
      const bDone = b.classList.contains('is-complete') ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return a.dataset.name.localeCompare(b.dataset.name, 'es', { sensitivity: 'base' });
    }).forEach(li => ul.appendChild(li));
  }

  entries.forEach(({ ingredient, item }) => {
    const li = document.createElement('li');
    li.dataset.name = ingredient.name;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!purchasedItems[item.ingredientId];

    if (checkbox.checked) {
      li.classList.add('is-complete');
    }

    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        purchasedItems[item.ingredientId] = true;
        li.classList.add('is-complete');
      } else {
        delete purchasedItems[item.ingredientId];
        li.classList.remove('is-complete');
      }

      sortStoreList();
      savePurchasedItems();
      renderStoresOverview();
      renderStoreShoppingProgress(storeKey);
    });

    const textWrapper = document.createElement('div');
    textWrapper.className = 'shopping-text';

    const nameEl = document.createElement('div');
    nameEl.className = 'shopping-name';
    nameEl.textContent = ingredient.name;

    const plannedEl = document.createElement('div');
    plannedEl.className = 'shopping-planned';

    if (ingredient.pantry) {
      plannedEl.textContent = `Mínimo: ${ingredient.minQuantity} ${ingredient.unit}`;
    } else {
      const planned = item.plannedQuantity ?? item.quantity;
      plannedEl.textContent = `Planificado: ${planned} ${ingredient.unit}`;
    }

    const nameGroup = document.createElement('div');
    nameGroup.className = 'shopping-name-group';
    nameGroup.appendChild(nameEl);
    if (ingredient.product) {
      const productEl = document.createElement('div');
      productEl.className = 'shopping-product';
      productEl.textContent = ingredient.product;
      nameGroup.appendChild(productEl);
    }
    textWrapper.appendChild(nameGroup);
    textWrapper.appendChild(plannedEl);

    const buyEl = document.createElement('div');
    buyEl.className = 'shopping-buy';

    // valor "Comprar" SIEMPRE (realQuantity si existe, si no el default)
    const defaultBuy = ingredient.pantry
      ? (ingredient.minQuantity ?? null)
      : (item.plannedQuantity ?? item.quantity ?? null);

    const buyQty = (item.realQuantity != null) ? item.realQuantity : defaultBuy;

    buyEl.textContent = `${buyQty ?? ''} ${ingredient.unit}`;

    textWrapper.appendChild(buyEl);

    const realInput = document.createElement('input');
    realInput.type = 'number';
    realInput.min = 0;
    realInput.placeholder = 'Comprar...';
    if (item.realQuantity != null) {
      realInput.value = item.realQuantity;
    } else if (ingredient.pantry) {
      realInput.value = ingredient.minQuantity ?? '';
    } else {
      const planned = item.plannedQuantity ?? item.quantity ?? '';
      realInput.value = planned;
    }

    realInput.addEventListener('input', () => {
      item.realQuantity = realInput.value ? Number(realInput.value) : null;
      saveLastShoppingList();
    });

    const cbLabel = document.createElement('label');
    cbLabel.className = 'cb';

    checkbox.classList.add('cb-input'); // 👈 importante

    const cbBox = document.createElement('span');
    cbBox.className = 'cb-box';
    cbBox.setAttribute('aria-hidden', 'true');

    cbLabel.appendChild(checkbox);
    cbLabel.appendChild(cbBox);

    li.appendChild(cbLabel);
    li.appendChild(textWrapper);
    li.appendChild(realInput);

    ul.appendChild(li);
  });

  storeShoppingModalList.appendChild(ul);
}


// Inicializar render
renderRecipes();

let _recipesWasDesktop = window.innerWidth >= 768;
let _calendarWasDesktop = window.innerWidth >= 768;

window.addEventListener('resize', () => {
  const isDesktop = window.innerWidth >= 768;
  if (isDesktop !== _recipesWasDesktop) {
    _recipesWasDesktop = isDesktop;
    renderRecipes();
  }
  if (isDesktop !== _calendarWasDesktop) {
    _calendarWasDesktop = isDesktop;
    if (calendarList) renderCalendarEntries();
  }
});

if (calendarList) {
  renderCalendarEntries();
}

if (shoppingList && lastShoppingList) {
  renderStoresOverview();
}

renderLocationsOverview();
renderShoppingDateRange();


// Rellenar fechas del formulario con la última lista generada



// -----------------------
// PLANIFICACIÓN (CALENDARIO)
// -----------------------

function renderCalendarRecipeSelect() {
  
  calendarRecipeSelect.innerHTML = '<option value="">Selecciona un cocinado</option>';

  [...recipes].sort((a, b) => a.name.localeCompare(b.name, 'es')).forEach((recipe) => {
    const option = document.createElement('option');
    option.value = recipe.id;
    option.textContent = recipe.name;
    calendarRecipeSelect.appendChild(option);
  });
}





// -----------------------
// MODAL DETALLE COCINADO
// -----------------------
const recipeDetailModal = document.getElementById('recipeDetailModal');
const closeRecipeDetailModalBtn = document.getElementById('closeRecipeDetailModal');
const recipeDetailTitle = document.getElementById('recipeDetailTitle');
const recipeDetailIngredients = document.getElementById('recipeDetailIngredients');
const recipeDetailEditBtn = document.getElementById('recipeDetailEditBtn');
const recipeDetailDeleteBtn = document.getElementById('recipeDetailDeleteBtn');

let selectedRecipeIdForDetail = null;

function openRecipeDetailModal(recipeId) {
  const recipe = recipes.find((r) => r.id === recipeId);
  if (!recipe) return;

  selectedRecipeIdForDetail = recipeId;

  if (recipeDetailTitle) recipeDetailTitle.textContent = recipe.name;

  if (recipeDetailIngredients) {
    recipeDetailIngredients.innerHTML = '';

    recipe.ingredients.forEach((item) => {
      const ingredient = ingredients.find((i) => i.id === item.ingredientId);
      if (!ingredient) return;

      const li = document.createElement('li');
      li.className = 'recipe-ingredient-row';

      const nameEl = document.createElement('span');
      nameEl.className = 'recipe-ingredient-name';
      nameEl.textContent = ingredient.name;

      const qtyEl = document.createElement('span');
      qtyEl.className = 'recipe-ingredient-qty';
      qtyEl.textContent = `${item.quantity} ${ingredient.unit}`;

      li.appendChild(nameEl);
      li.appendChild(qtyEl);
      recipeDetailIngredients.appendChild(li);
    });

    if (recipe.ingredients.length === 0) {
      const li = document.createElement('li');
      li.textContent = '(Sin ingredientes)';
      recipeDetailIngredients.appendChild(li);
    }
  }

  openModal(recipeDetailModal);
}

function closeRecipeDetailModal() {
  closeModal(recipeDetailModal);
  selectedRecipeIdForDetail = null;
}

// Cerrar con X
if (closeRecipeDetailModalBtn) {
  closeRecipeDetailModalBtn.addEventListener('click', closeRecipeDetailModal);
}

// Cerrar clic fuera
if (recipeDetailModal) {
  recipeDetailModal.addEventListener('click', (e) => {
    if (e.target === recipeDetailModal) closeRecipeDetailModal();
  });
}

// Editar desde detalle
if (recipeDetailEditBtn) {
  recipeDetailEditBtn.addEventListener('click', () => {
    if (!selectedRecipeIdForDetail) return;

    // Prepara el formulario de recetas con los datos
    startEditRecipe(selectedRecipeIdForDetail);

    // Cierra detalle y abre el panel/modal del formulario de receta
    closeRecipeDetailModal();
    if (isDesktop()) {
      const tabId = 'recipes';
      localStorage.setItem(ACTIVE_TAB_KEY, tabId);
      tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === tabId));
      tabContents.forEach((s) => s.classList.toggle('active', s.id === tabId));
    }
    openRecipePanel();
  });
}

// Eliminar desde detalle
if (recipeDetailDeleteBtn) {
  recipeDetailDeleteBtn.addEventListener('click', () => {
    if (!selectedRecipeIdForDetail) return;

    recipes = recipes.filter((r) => r.id !== selectedRecipeIdForDetail);
    saveRecipes();
    renderRecipes();

    // Si hay calendario que usa esa receta, opcionalmente podrías limpiarlo aquí (si quieres)
    // calendarEntries = calendarEntries.filter(e => e.recipeId !== selectedRecipeIdForDetail);
    // saveCalendarEntries();
    // renderCalendarEntries();

    closeRecipeDetailModal();
  });
}

// -----------------------
// MODAL DETALLE INGREDIENTE
// -----------------------
const ingredientDetailModal = document.getElementById('ingredientDetailModal');
const closeIngredientDetailModalBtn = document.getElementById('closeIngredientDetailModal');
const ingredientDetailTitle = document.getElementById('ingredientDetailTitle');
const ingredientDetailMeta = document.getElementById('ingredientDetailMeta');
const ingredientDetailEditBtn = document.getElementById('ingredientDetailEditBtn');
const ingredientDetailDeleteBtn = document.getElementById('ingredientDetailDeleteBtn');

let selectedIngredientIdForDetail = null;

function openIngredientDetailModal(ingredientId) {
  const ingredient = ingredients.find((i) => i.id === ingredientId);
  if (!ingredient) return;

  selectedIngredientIdForDetail = ingredientId;

  if (ingredientDetailTitle) {
    ingredientDetailTitle.textContent = ingredient.name;
  }

  // Opcional: mostrar info extra
  if (ingredientDetailMeta) {
    const storeLabel = (STORE_LABELS && ingredient.store) ? (STORE_LABELS[ingredient.store] || ingredient.store) : (ingredient.store || '');
    const locationLabel = (LOCATION_LABELS && ingredient.location) ? (LOCATION_LABELS[ingredient.location] || ingredient.location) : (ingredient.location || '');

    const parts = [];
    if (ingredient.unit) parts.push(`Unidad: ${ingredient.unit}`);
    if (storeLabel) parts.push(`Comercio: ${storeLabel}`);
    if (locationLabel) parts.push(`Ubicación: ${locationLabel}`);
    if (ingredient.pantry) parts.push(`Despensa: Sí`);
    if (ingredient.pantry && ingredient.minQuantity != null) parts.push(`Mínimo: ${ingredient.minQuantity}`);

    ingredientDetailMeta.textContent = parts.join(' · ');
  }

  openModal(ingredientDetailModal);
}

function closeIngredientDetailModal() {
  closeModal(ingredientDetailModal);
  selectedIngredientIdForDetail = null;
}

if (closeIngredientDetailModalBtn) {
  closeIngredientDetailModalBtn.addEventListener('click', closeIngredientDetailModal);
}

if (ingredientDetailModal) {
  ingredientDetailModal.addEventListener('click', (e) => {
    if (e.target === ingredientDetailModal) closeIngredientDetailModal();
  });
}

// Editar desde detalle
if (ingredientDetailEditBtn) {
  ingredientDetailEditBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const id = selectedIngredientIdForDetail; // guardamos el id antes de cerrar
    if (!id) return;

    closeIngredientDetailModal();

    setTimeout(() => {
      startEditIngredient(id);
    }, 380);
  });
}

function deleteIngredient(id) {
  ingredients = ingredients.filter((i) => i.id !== id);
  saveIngredients();

  recipes = recipes.map((recipe) => ({
    ...recipe,
    ingredients: recipe.ingredients.filter((item) => item.ingredientId !== id),
  }));
  saveRecipes();

  renderIngredients();
  renderRecipes();
  renderIngredientSelectors();

  if (calendarList) renderCalendarEntries();
  if (shoppingList && lastShoppingList) renderStoresOverview();
  renderLocationsOverview();
}

if (ingredientDetailDeleteBtn) {
  ingredientDetailDeleteBtn.addEventListener('click', () => {
    if (!selectedIngredientIdForDetail) return;
    const ok = confirm('¿Seguro que quieres eliminar este ingrediente?');
    if (!ok) return;
    const id = selectedIngredientIdForDetail;
    closeIngredientDetailModal();
    deleteIngredient(id);
  });
}




// ----------------------
// TABS
// ----------------------
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const tabsNav = document.querySelector('.tabs');
const isMobile = () => window.matchMedia('(max-width: 767px)').matches;

function hideNavOnMobile() {
  if (isMobile()) {
    tabsNav.classList.add('nav-hidden');
  }
}

function showNav() {
  tabsNav.classList.remove('nav-hidden');
}

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const tabId = btn.dataset.tab;

    // ✅ Guardar tab activa
    localStorage.setItem(ACTIVE_TAB_KEY, tabId);

    // Activar botón
    tabButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    // Mostrar sección
    tabContents.forEach((section) => {
      section.classList.toggle('active', section.id === tabId);
    });

    if (tabId === 'shopping-list-2') hideLista2Detail();

    // En móvil, ocultar nav y mostrar contenido
    hideNavOnMobile();
  });
});

document.querySelectorAll('.mobile-menu-btn').forEach((btn) => {
  btn.addEventListener('click', showNav);
});

(function restoreActiveTab() {
  let savedTabId = localStorage.getItem(ACTIVE_TAB_KEY);

  if (!savedTabId) return;

  // Migrar tab antigua 'shopping-list' a 'shopping-list-2'
  if (savedTabId === 'shopping-list') savedTabId = 'shopping-list-2';

  const btnToActivate = document.querySelector(`.tab-btn[data-tab="${savedTabId}"]`);
  const sectionToActivate = document.getElementById(savedTabId);

  if (!btnToActivate || !sectionToActivate) return;

  // Activar botón correcto
  tabButtons.forEach((b) => b.classList.remove('active'));
  btnToActivate.classList.add('active');

  // Activar sección correcta
  tabContents.forEach((section) => {
    section.classList.toggle('active', section.id === savedTabId);
  });

  // En móvil, si hay tab guardada ir directamente al contenido
  hideNavOnMobile();
})();

// ----------------------
// LISTAS 2
// ----------------------

const lista2Modal = document.getElementById('lista2Modal');
const lista2Form = document.getElementById('lista2Form');
const lista2Start = document.getElementById('lista2Start');
const lista2End = document.getElementById('lista2End');
const lista2StoreSelect = document.getElementById('lista2StoreSelect');
const lista2ListView = document.getElementById('lista2ListView');
const lista2DetailView = document.getElementById('lista2DetailView');
const lista2DetailTitle = document.getElementById('lista2DetailTitle');
const lista2DetailMeta = document.getElementById('lista2DetailMeta');
const lista2DetailProgress = document.getElementById('lista2DetailProgress');
const lista2DetailList = document.getElementById('lista2DetailList');
const lista2ItemsContainer = document.getElementById('lista2ItemsContainer');
const lista2ShopViewEl = document.getElementById('lista2ShopView');
const lista2ShopList = document.getElementById('lista2ShopList');
let currentLista2ItemId = null;

function showLista2Detail() {
  lista2DetailView?.classList.add('is-visible');
  lista2ListView?.classList.add('hidden');
}

function hideLista2Detail() {
  closeLista2Sheet();
  closeLista2ShopView();
  lista2DetailView?.classList.remove('is-visible');
  lista2ListView?.classList.remove('hidden');
}

function openLista2ShopView(item) {
  renderLista2ShopList(item);
  lista2ShopViewEl?.classList.add('is-visible');
}

function closeLista2ShopView() {
  lista2ShopViewEl?.classList.remove('is-visible');
  const item = lista2Items.find((i) => i.id === currentLista2ItemId);
  if (item) renderLista2DetailList(item);
}

function formatDateShort(iso) {
  if (!iso) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getTime() === today.getTime()) return 'Hoy';
  if (date.getTime() === yesterday.getTime()) return 'Ayer';
  if (date.getTime() === tomorrow.getTime()) return 'Mañana';
  const weekStart = startOfWeekMonday(today);
  const weekEnd = endOfWeekSunday(today);
  if (date >= weekStart && date <= weekEnd) {
    const dayName = date.toLocaleDateString('es-ES', { weekday: 'long' });
    return `Este ${dayName}`;
  }
  const nextWeekStart = addDays(weekEnd, 1); nextWeekStart.setHours(0, 0, 0, 0);
  const nextWeekEnd = endOfWeekSunday(nextWeekStart);
  if (date >= nextWeekStart && date <= nextWeekEnd) {
    const dayName = date.toLocaleDateString('es-ES', { weekday: 'long' });
    return `Próximo ${dayName}`;
  }
  const prevWeekEnd = addDays(weekStart, -1); prevWeekEnd.setHours(23, 59, 59, 999);
  const prevWeekStart = startOfWeekMonday(prevWeekEnd);
  if (date >= prevWeekStart && date <= prevWeekEnd) {
    const dayName = date.toLocaleDateString('es-ES', { weekday: 'long' });
    const dayNameCap = dayName.charAt(0).toUpperCase() + dayName.slice(1);
    return `${dayNameCap} pasado`;
  }
  const weekday = date.toLocaleDateString('es-ES', { weekday: 'short' });
  const month = date.toLocaleDateString('es-ES', { month: 'short' });
  const weekdayStr = weekday.charAt(0).toUpperCase() + weekday.slice(1, 3);
  const monthStr = month.slice(0, 3);
  return `${weekdayStr}, ${d} ${monthStr}`;
}

function syncLista2DateWrapper(input) {
  const wrapper = input?.closest('.date-picker');
  if (!wrapper) return;
  if (input.value) wrapper.setAttribute('data-has-value', '');
  else wrapper.removeAttribute('data-has-value');
}

if (lista2Start) lista2Start.addEventListener('change', () => syncLista2DateWrapper(lista2Start));
if (lista2End) lista2End.addEventListener('change', () => syncLista2DateWrapper(lista2End));

document.getElementById('openLista2Modal')?.addEventListener('click', () => {
  if (lista2StoreSelect) {
    lista2StoreSelect.innerHTML = '<option value="">Selecciona un comercio...</option>';
    Object.entries(STORE_LABELS).forEach(([key, label]) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = label;
      lista2StoreSelect.appendChild(opt);
    });
  }
  openModal(lista2Modal);
});

document.getElementById('closeLista2Modal')?.addEventListener('click', () => {
  closeModal(lista2Modal);
});

document.getElementById('backToLista2')?.addEventListener('click', hideLista2Detail);

lista2Form?.addEventListener('submit', (e) => {
  e.preventDefault();

  const start = lista2Start?.value;
  const end = lista2End?.value;
  const storeKey = lista2StoreSelect?.value;

  if (!start || !end || !storeKey) return;

  const entries = getExpandedCalendarEntriesInRange(start, end);

  const ingredientIdSet = new Set();
  entries.forEach((entry) => {
    const recipe = recipes.find((r) => r.id === entry.recipeId);
    if (!recipe) return;
    recipe.ingredients.forEach(({ ingredientId }) => ingredientIdSet.add(ingredientId));
  });

  // Añadir siempre los básicos de despensa del comercio seleccionado
  ingredients.forEach((ing) => {
    if (ing.pantry && ing.store === storeKey) ingredientIdSet.add(ing.id);
  });

  const ingredientNames = [...ingredientIdSet]
    .map((id) => ingredients.find((i) => i.id === id))
    .filter((ing) => ing && ing.store === storeKey && ing.shoppingType === 'semanal')
    .map((ing) => ing.name)
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

  lista2Items.push({
    id: Date.now(),
    storeKey,
    startDate: start,
    endDate: end,
    ingredientNames,
  });

  saveLista2Items();
  closeModal(lista2Modal);
  lista2Form.reset();
  [lista2Start, lista2End].forEach(input => syncLista2DateWrapper(input));
  renderLista2();
});

const lista2IngredientSheet = document.getElementById('lista2IngredientSheet');
const lista2SheetTitle = document.getElementById('lista2SheetTitle');
const lista2SheetProduct = document.getElementById('lista2SheetProduct');

function openLista2Sheet(ingredientName) {
  const ingredient = ingredients.find((i) => i.name === ingredientName);
  if (!ingredient) return;

  document.querySelectorAll('#lista2DetailList li.is-selected')
    .forEach(r => r.classList.remove('is-selected'));
  const activeLi = document.querySelector(`#lista2DetailList li[data-name="${CSS.escape(ingredientName)}"]`);
  if (activeLi) activeLi.classList.add('is-selected');

  if (lista2SheetTitle) lista2SheetTitle.textContent = ingredient.name;
  if (lista2SheetProduct) lista2SheetProduct.textContent = ingredient.product || '—';

  const editBtn = document.getElementById('lista2SheetEditBtn');
  if (editBtn) {
    editBtn.onclick = () => {
      if (lista2SheetDropdown) lista2SheetDropdown.hidden = true;
      const tabId = 'ingredients';
      localStorage.setItem(ACTIVE_TAB_KEY, tabId);
      tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === tabId));
      tabContents.forEach((s) => s.classList.toggle('active', s.id === tabId));
      startEditIngredient(ingredient.id);
    };
  }

  const conversionEl = document.getElementById('lista2SheetConversion');
  if (conversionEl) {
    if (ingredient.productUnit && ingredient.formato != null && ingredient.formato !== '') {
      conversionEl.textContent = `1 ${ingredient.productUnit} = ${ingredient.formato} ${ingredient.unit}`;
      conversionEl.classList.remove('lista2-sheet-pantry-empty');
    } else {
      conversionEl.textContent = 'Información no disponible.';
      conversionEl.classList.add('lista2-sheet-pantry-empty');
    }
  }

  const pantryEl = document.getElementById('lista2SheetPantry');
  if (pantryEl) {
    if (ingredient.pantry && ingredient.minQuantity != null && ingredient.minQuantity !== '') {
      pantryEl.textContent = `Cantidad mínima: ${formatMinQty(ingredient)}`;
      pantryEl.classList.remove('lista2-sheet-pantry-empty');
    } else {
      pantryEl.textContent = 'Este ingrediente no es un básico de despensa.';
      pantryEl.classList.add('lista2-sheet-pantry-empty');
    }
  }

  const recipesList = document.getElementById('lista2SheetRecipes');
  if (recipesList) {
    recipesList.innerHTML = '';

    const item = lista2Items.find((i) => i.id === currentLista2ItemId);
    if (item) {
      const entries = getExpandedCalendarEntriesInRange(item.startDate, item.endDate);

      const recipeMap = new Map();
      entries.forEach((entry) => {
        const recipe = recipes.find((r) => r.id === entry.recipeId);
        if (!recipe) return;
        const ri = recipe.ingredients.find((x) => x.ingredientId === ingredient.id);
        if (!ri) return;
        if (!recipeMap.has(recipe.id)) {
          recipeMap.set(recipe.id, { name: recipe.name, qty: ri.quantity, count: 0 });
        }
        recipeMap.get(recipe.id).count++;
      });

      if (recipeMap.size === 0) {
        const li = document.createElement('li');
        li.className = 'lista2-sheet-recipe-empty';
        li.textContent = 'Este ingrediente no está incluido en las recetas planificadas.';
        recipesList.appendChild(li);
      } else {
        let grandTotal = 0;
        recipeMap.forEach(({ name, qty, count }) => {
          const li = document.createElement('li');
          li.className = 'lista2-sheet-recipe-item';
          const totalQty = qty * count;
          grandTotal += totalQty;
          li.innerHTML = `<span class="lista2-sheet-recipe-name">${name}</span><span class="lista2-sheet-recipe-qty">${totalQty} ${ingredient.unit}</span>`;
          recipesList.appendChild(li);
        });
        const totalLi = document.createElement('li');
        totalLi.className = 'lista2-sheet-recipe-total';
        totalLi.innerHTML = `<span class="lista2-sheet-recipe-name">Total</span><span class="lista2-sheet-recipe-qty">${grandTotal} ${ingredient.unit}</span>`;
        recipesList.appendChild(totalLi);
      }
    }
  }

  // Sección "Lista de la compra"
  const shoppingLabelEl = document.getElementById('lista2SheetShoppingLabel');
  const shoppingInputRow = document.getElementById('lista2SheetShoppingInputRow');
  const realQtyInput = document.getElementById('lista2SheetRealQty');

  if (shoppingLabelEl && shoppingInputRow && realQtyInput) {
    const lista2Item = lista2Items.find((i) => i.id === currentLista2ItemId);

    if (!lista2Item) {
      shoppingLabelEl.textContent = '';
      shoppingInputRow.classList.add('hidden');
    } else {
      // Calcular cantidad planificada sumando desde el calendario
      const entries = getExpandedCalendarEntriesInRange(lista2Item.startDate, lista2Item.endDate);
      let total = 0;
      entries.forEach((entry) => {
        const recipe = recipes.find((r) => r.id === entry.recipeId);
        if (!recipe) return;
        const ri = recipe.ingredients.find((x) => x.ingredientId === ingredient.id);
        if (!ri) return;
        total += ri.quantity;
      });
      const calculatedPlanned = total > 0 ? total : null;

      const isPantry = ingredient.pantry && ingredient.minQuantity != null && ingredient.minQuantity !== '';
      if (isPantry) {
        shoppingLabelEl.textContent = `Mínimo: ${formatMinQty(ingredient)}`;
        shoppingLabelEl.classList.remove('lista2-sheet-pantry-empty');
      } else if (calculatedPlanned != null) {
        shoppingLabelEl.textContent = `Planificado: ${formatIngredientQty(ingredient, calculatedPlanned)}`;
        shoppingLabelEl.classList.remove('lista2-sheet-pantry-empty');
      } else {
        shoppingLabelEl.textContent = 'No planificado en el periodo actual.';
        shoppingLabelEl.classList.add('lista2-sheet-pantry-empty');
      }

      // Valor del input: mismo origen que lista2-shop-input (lista2ShopQty)
      const shopQty = lista2ShopQty[lista2Item.id] || {};
      realQtyInput.value = shopQty[ingredientName] != null ? shopQty[ingredientName] : '';

      realQtyInput.oninput = () => {
        const val = parseFloat(realQtyInput.value);
        const prevShopQty = (lista2ShopQty[lista2Item.id] || {})[ingredientName];
        if (!lista2ShopQty[lista2Item.id]) lista2ShopQty[lista2Item.id] = {};
        if (!isNaN(val) && val >= 0) {
          lista2ShopQty[lista2Item.id][ingredientName] = val;
        } else {
          delete lista2ShopQty[lista2Item.id][ingredientName];
        }
        saveLista2ShopQty();
        if (val === 0) {
          if (!lista2Checked[lista2Item.id]) lista2Checked[lista2Item.id] = {};
          lista2Checked[lista2Item.id][ingredientName] = true;
          saveLista2Checked();
          updateLista2Progress(lista2Item);
          renderLista2DetailList(lista2Item);
        } else if (prevShopQty === 0) {
          if (lista2Checked[lista2Item.id]) delete lista2Checked[lista2Item.id][ingredientName];
          saveLista2Checked();
          updateLista2Progress(lista2Item);
          renderLista2DetailList(lista2Item);
        }
        const listInput = document.querySelector(`#lista2DetailList li[data-name="${CSS.escape(ingredientName)}"] input`);
        if (listInput) listInput.value = realQtyInput.value;
        updateLista2QtyDisplay(lista2Item, ingredientName);
      };

      shoppingInputRow.classList.remove('hidden');
    }
  }

  if (lista2IngredientSheet) lista2IngredientSheet.classList.add('is-open');
  document.getElementById('lista2DetailView')?.classList.add('sheet-open');
}

function closeLista2Sheet() {
  if (lista2IngredientSheet) lista2IngredientSheet.classList.remove('is-open');
  document.getElementById('lista2DetailView')?.classList.remove('sheet-open');
  document.querySelectorAll('#lista2DetailList li.is-selected')
    .forEach(r => r.classList.remove('is-selected'));
}

document.getElementById('closeLista2Sheet')?.addEventListener('click', closeLista2Sheet);

const lista2SheetDropdown = document.getElementById('lista2SheetDropdown');

document.getElementById('lista2SheetMenuBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  lista2SheetDropdown.hidden = !lista2SheetDropdown.hidden;
});

document.addEventListener('click', () => {
  if (lista2SheetDropdown && !lista2SheetDropdown.hidden) {
    lista2SheetDropdown.hidden = true;
  }
});

const lista2ActionsDropdown = document.getElementById('lista2ActionsDropdown');

document.getElementById('lista2ActionsMenuBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  lista2ActionsDropdown.hidden = !lista2ActionsDropdown.hidden;
});

document.addEventListener('click', () => {
  if (lista2ActionsDropdown && !lista2ActionsDropdown.hidden) {
    lista2ActionsDropdown.hidden = true;
  }
});

document.getElementById('deleteLista2ItemBtn')?.addEventListener('click', () => {
  lista2ActionsDropdown.hidden = true;
  if (currentLista2ItemId === null) return;
  const ok = confirm('¿Seguro que quieres eliminar esta lista?');
  if (!ok) return;
  lista2Items = lista2Items.filter((i) => i.id !== currentLista2ItemId);
  delete lista2Checked[currentLista2ItemId];
  saveLista2Items();
  saveLista2Checked();
  hideLista2Detail();
  currentLista2ItemId = null;
  renderLista2();
});

document.getElementById('lista2ShopModeBtn')?.addEventListener('click', () => {
  lista2ActionsDropdown.hidden = true;
  const item = lista2Items.find((i) => i.id === currentLista2ItemId);
  if (!item) return;
  openLista2ShopView(item);
});

document.getElementById('closeLista2ShopView')?.addEventListener('click', closeLista2ShopView);

const LISTA2_LOCATION_ORDER = [
  ...Object.keys(LOCATION_LABELS),
  'sin-ubicacion',
];

function formatIngredientQty(ingredient, rawQty) {
  if (rawQty == null || isNaN(rawQty)) return null;
  const formato = parseFloat(ingredient.formato);
  if (ingredient.productUnit && ingredient.formato != null && ingredient.formato !== '' && formato > 0) {
    const converted = rawQty / formato;
    const display = parseFloat(converted.toFixed(2));
    const labels = PRODUCT_UNIT_LABELS[ingredient.productUnit];
    const unitLabel = labels ? (display === 1 ? labels.singular : labels.plural) : ingredient.productUnit;
    return `${display} ${unitLabel}`;
  }
  return `${rawQty} ${ingredient.unit}`;
}

function formatMinQty(ingredient) {
  const val = parseFloat(ingredient.minQuantity);
  if (isNaN(val)) return `${ingredient.minQuantity} ${ingredient.unit}`;
  if (ingredient.productUnit) {
    const labels = PRODUCT_UNIT_LABELS[ingredient.productUnit];
    const unitLabel = labels ? (val === 1 ? labels.singular : labels.plural) : ingredient.productUnit;
    return `${val} ${unitLabel}`;
  }
  return `${val} ${ingredient.unit}`;
}

function buildTotalQtyMap(item) {
  const map = new Map();
  const entries = getExpandedCalendarEntriesInRange(item.startDate, item.endDate);
  entries.forEach((entry) => {
    const recipe = recipes.find((r) => r.id === entry.recipeId);
    if (!recipe) return;
    recipe.ingredients.forEach(({ ingredientId, quantity }) => {
      const ing = ingredients.find((i) => i.id === ingredientId);
      if (!ing || ing.store !== item.storeKey) return;
      map.set(ing.name, (map.get(ing.name) || 0) + quantity);
    });
  });
  return map;
}

function updateLista2QtyDisplay(lista2Item, ingredientName) {
  const li = document.querySelector(`#lista2DetailList li[data-name="${CSS.escape(ingredientName)}"]`);
  if (!li || li.classList.contains('lista2-shop-item')) return;

  const nameGroup = li.querySelector('.lista2-name-group');
  if (!nameGroup) return;

  const oldQty = li.querySelector('.lista2-ingredient-qty');
  if (oldQty) oldQty.remove();

  const ingredient = ingredients.find((i) => i.name === ingredientName);
  if (!ingredient) return;

  const shopOverride = (lista2ShopQty[lista2Item.id] || {})[ingredientName];
  const isOverridden = shopOverride != null;
  let qtyText;

  if (isOverridden) {
    const formato = parseFloat(ingredient.formato);
    const hasConversion = ingredient.productUnit && ingredient.formato != null && ingredient.formato !== '' && formato > 0;
    if (hasConversion) {
      const labels = PRODUCT_UNIT_LABELS[ingredient.productUnit];
      const unitLabel = labels ? (shopOverride === 1 ? labels.singular : labels.plural) : ingredient.productUnit;
      qtyText = `${shopOverride} ${unitLabel}`;
    } else {
      qtyText = `${shopOverride} ${ingredient.unit}`;
    }
  } else {
    const totalQty = buildTotalQtyMap(lista2Item).get(ingredientName);
    const isPantryWithMin = ingredient.pantry && ingredient.minQuantity != null && ingredient.minQuantity !== '';
    qtyText = isPantryWithMin ? formatMinQty(ingredient) : formatIngredientQty(ingredient, totalQty);
  }

  if (qtyText) {
    const qtyEl = document.createElement('span');
    qtyEl.className = 'lista2-ingredient-qty';
    qtyEl.textContent = qtyText;
    if (isOverridden) {
      const dot = document.createElement('span');
      dot.className = 'lista2-qty-override-dot';
      dot.setAttribute('aria-label', 'Cantidad editada manualmente');
      qtyEl.prepend(dot);
    }
    li.appendChild(qtyEl);
  }
}

function renderLista2DetailList(item) {
  if (!lista2DetailList) return;
  lista2DetailList.innerHTML = '';
  closeLista2Sheet();

  if (item.ingredientNames.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'No hay ingredientes planificados en este periodo.';
    lista2DetailList.appendChild(p);
    return;
  }

  const totalQtyByIngredient = buildTotalQtyMap(item);

  if (lista2ShopMode) {
    const shopQty = lista2ShopQty[item.id] || {};

    const sorted = [...item.ingredientNames].sort((a, b) => {
      const ingA = ingredients.find((i) => i.name === a);
      const ingB = ingredients.find((i) => i.name === b);
      const iA = LISTA2_LOCATION_ORDER.indexOf(ingA?.location || '');
      const iB = LISTA2_LOCATION_ORDER.indexOf(ingB?.location || '');
      const oA = iA === -1 ? 999 : iA;
      const oB = iB === -1 ? 999 : iB;
      if (oA !== oB) return oA - oB;
      return a.localeCompare(b, 'es', { sensitivity: 'base' });
    });

    let currentLocationKey = null;
    sorted.forEach((name) => {
      const ingredient = ingredients.find((i) => i.name === name);
      const locationKey = ingredient?.location || 'sin-ubicacion';

      if (locationKey !== currentLocationKey) {
        currentLocationKey = locationKey;
        const locationHeader = document.createElement('li');
        locationHeader.className = 'lista2-shop-location-header';
        locationHeader.textContent = LOCATION_LABELS[locationKey] || 'Sin ubicación';
        lista2DetailList.appendChild(locationHeader);
      }

      const li = document.createElement('li');
      li.dataset.name = name;
      li.className = 'lista2-shop-item';

      const nameGroup = document.createElement('div');
      nameGroup.className = 'lista2-name-group';
      nameGroup.addEventListener('click', () => openLista2Sheet(name));

      const nameEl = document.createElement('span');
      nameEl.className = 'shopping-name';
      nameEl.textContent = name;
      nameGroup.appendChild(nameEl);

      if (ingredient) {
        const totalQty = totalQtyByIngredient.get(name);
        const isPantry = ingredient.pantry && ingredient.minQuantity != null && ingredient.minQuantity !== '';
        const prefix = isPantry ? 'Mínima' : 'Planificada';
        const qtyText = isPantry ? formatMinQty(ingredient) : formatIngredientQty(ingredient, totalQty);

        const byline = document.createElement('span');
        byline.className = 'lista2-ingredient-qty';
        if (qtyText) byline.textContent = `${prefix}: ${qtyText}`;
        nameGroup.appendChild(byline);
      }

      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = 'any';
      input.className = 'lista2-shop-input';
      input.placeholder = 'Comprar...';
      if (shopQty[name] != null) input.value = shopQty[name];
      input.addEventListener('change', () => {
        const val = parseFloat(input.value);
        const prevShopQty = (lista2ShopQty[item.id] || {})[name];
        if (!lista2ShopQty[item.id]) lista2ShopQty[item.id] = {};
        if (!isNaN(val) && val >= 0) {
          lista2ShopQty[item.id][name] = val;
        } else {
          delete lista2ShopQty[item.id][name];
          input.value = '';
        }
        saveLista2ShopQty();
        if (val === 0) {
          if (!lista2Checked[item.id]) lista2Checked[item.id] = {};
          lista2Checked[item.id][name] = true;
          saveLista2Checked();
          updateLista2Progress(item);
        } else if (prevShopQty === 0) {
          if (lista2Checked[item.id]) delete lista2Checked[item.id][name];
          saveLista2Checked();
          updateLista2Progress(item);
        }
        const sheetInput = document.getElementById('lista2SheetRealQty');
        const sheetTitle = document.getElementById('lista2SheetTitle');
        if (lista2IngredientSheet?.classList.contains('is-open') && sheetTitle?.textContent === name && sheetInput) {
          sheetInput.value = input.value;
        }
      });

      li.appendChild(nameGroup);
      li.appendChild(input);
      lista2DetailList.appendChild(li);
    });

  } else {
    const checked = lista2Checked[item.id] || {};

    const allSorted = [...item.ingredientNames].sort((a, b) =>
      a.localeCompare(b, 'es', { sensitivity: 'base' })
    );
    const shopQty = lista2ShopQty[item.id] || {};
    const uncheckedNames      = allSorted.filter(name => !checked[name]);
    const checkedZeroNames    = allSorted.filter(name => !!checked[name] && shopQty[name] === 0);
    const checkedNonZeroNames = allSorted.filter(name => !!checked[name] && shopQty[name] !== 0);

    const createNormalItemLi = (name, isPantry = false) => {
      const ingredient = ingredients.find((i) => i.name === name);
      const li = document.createElement('li');
      li.dataset.name = name;
      li.className = 'lista2-ingredient-item';
      if (checked[name]) li.classList.add('is-complete');
      if (isPantry) li.classList.add('lista2-pantry-item');

      const cbLabel = document.createElement('label');
      cbLabel.className = 'cb';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'cb-input';
      checkbox.checked = !!checked[name];
      if (isPantry) checkbox.disabled = true;
      const cbBox = document.createElement('span');
      cbBox.className = 'cb-box';
      cbBox.setAttribute('aria-hidden', 'true');
      cbLabel.appendChild(checkbox);
      cbLabel.appendChild(cbBox);

      checkbox.addEventListener('change', () => {
        if (!lista2Checked[item.id]) lista2Checked[item.id] = {};
        if (checkbox.checked) {
          lista2Checked[item.id][name] = true;
        } else {
          delete lista2Checked[item.id][name];
        }
        saveLista2Checked();
        updateLista2Progress(item);
        renderLista2DetailList(item);
      });

      const nameGroup = document.createElement('div');
      nameGroup.className = 'lista2-name-group';
      nameGroup.addEventListener('click', () => openLista2Sheet(name));

      const nameEl = document.createElement('span');
      nameEl.className = 'shopping-name';
      nameEl.textContent = name;
      nameGroup.appendChild(nameEl);

      if (ingredient && ingredient.product) {
        const productEl = document.createElement('span');
        productEl.className = 'lista2-ingredient-product';
        productEl.textContent = ingredient.product;
        nameGroup.appendChild(productEl);
      }

      if (ingredient) {
        const totalQty = totalQtyByIngredient.get(name);
        const shopOverride = (lista2ShopQty[item.id] || {})[name];
        const isOverridden = shopOverride != null;
        let qtyText;
        if (isOverridden) {
          const formato = parseFloat(ingredient.formato);
          const hasConversion = ingredient.productUnit && ingredient.formato != null && ingredient.formato !== '' && formato > 0;
          if (hasConversion) {
            const labels = PRODUCT_UNIT_LABELS[ingredient.productUnit];
            const unitLabel = labels ? (shopOverride === 1 ? labels.singular : labels.plural) : ingredient.productUnit;
            qtyText = `${shopOverride} ${unitLabel}`;
          } else {
            qtyText = `${shopOverride} ${ingredient.unit}`;
          }
        } else {
          const isPantryWithMin = ingredient.pantry && ingredient.minQuantity != null && ingredient.minQuantity !== '';
          qtyText = isPantryWithMin ? formatMinQty(ingredient) : formatIngredientQty(ingredient, totalQty);
        }
        if (qtyText) {
          const qtyEl = document.createElement('span');
          qtyEl.className = 'lista2-ingredient-qty';
          qtyEl.textContent = qtyText;
          if (isOverridden) {
            const dot = document.createElement('span');
            dot.className = 'lista2-qty-override-dot';
            dot.setAttribute('aria-label', 'Cantidad editada manualmente');
            qtyEl.prepend(dot);
          }
          li.appendChild(cbLabel);
          li.appendChild(nameGroup);
          li.appendChild(qtyEl);
          return li;
        }
      }

      li.appendChild(cbLabel);
      li.appendChild(nameGroup);
      return li;
    };

    uncheckedNames.forEach(name => lista2DetailList.appendChild(createNormalItemLi(name)));
    checkedNonZeroNames.forEach(name => lista2DetailList.appendChild(createNormalItemLi(name)));

    if (checkedZeroNames.length > 0) {
      const collapsibleLi = document.createElement('li');
      collapsibleLi.className = 'lista2-shop-pantry-section';

      const pantryCount = checkedZeroNames.length;

      const innerUl = document.createElement('ul');
      innerUl.className = 'lista2-shop-pantry-list';
      innerUl.hidden = true;
      checkedZeroNames.forEach(name => innerUl.appendChild(createNormalItemLi(name, true)));

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'lista2-shop-pantry-summary';
      toggleBtn.textContent = `Mostrar ingredientes disponibles (${pantryCount})`;
      toggleBtn.addEventListener('click', () => {
        innerUl.hidden = !innerUl.hidden;
        toggleBtn.textContent = innerUl.hidden
          ? `Mostrar ingredientes disponibles (${pantryCount})`
          : `Ocultar ingredientes disponibles (${pantryCount})`;
      });

      collapsibleLi.appendChild(innerUl);
      collapsibleLi.appendChild(toggleBtn);
      lista2DetailList.appendChild(collapsibleLi);
    }
  }
}

function renderLista2ShopList(item) {
  if (!lista2ShopList) return;
  lista2ShopList.innerHTML = '';

  if (item.ingredientNames.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'No hay ingredientes planificados en este periodo.';
    lista2ShopList.appendChild(p);
    return;
  }

  const totalQtyByIngredient = buildTotalQtyMap(item);
  const shopQty = lista2ShopQty[item.id] || {};

  const sorted = [...item.ingredientNames].sort((a, b) => {
    const ingA = ingredients.find((i) => i.name === a);
    const ingB = ingredients.find((i) => i.name === b);
    const iA = LISTA2_LOCATION_ORDER.indexOf(ingA?.location || '');
    const iB = LISTA2_LOCATION_ORDER.indexOf(ingB?.location || '');
    const oA = iA === -1 ? 999 : iA;
    const oB = iB === -1 ? 999 : iB;
    if (oA !== oB) return oA - oB;
    return a.localeCompare(b, 'es', { sensitivity: 'base' });
  });

  let currentLocationKey = null;
  sorted.forEach((name) => {
    const ingredient = ingredients.find((i) => i.name === name);
    const locationKey = ingredient?.location || 'sin-ubicacion';

    if (locationKey !== currentLocationKey) {
      currentLocationKey = locationKey;
      const locationHeader = document.createElement('li');
      locationHeader.className = 'lista2-shop-location-header';
      locationHeader.textContent = LOCATION_LABELS[locationKey] || 'Sin ubicación';
      lista2ShopList.appendChild(locationHeader);
    }

    const li = document.createElement('li');
    li.dataset.name = name;
    li.className = 'lista2-shop-item';

    const nameGroup = document.createElement('div');
    nameGroup.className = 'lista2-name-group';
    nameGroup.addEventListener('click', () => openLista2Sheet(name));

    const nameEl = document.createElement('span');
    nameEl.className = 'shopping-name';
    nameEl.textContent = name;
    nameGroup.appendChild(nameEl);

    if (ingredient) {
      const totalQty = totalQtyByIngredient.get(name);
      const isPantry = ingredient.pantry && ingredient.minQuantity != null && ingredient.minQuantity !== '';
      const prefix = isPantry ? 'Mínima' : 'Planificada';
      const qtyText = isPantry ? formatMinQty(ingredient) : formatIngredientQty(ingredient, totalQty);
      const byline = document.createElement('span');
      byline.className = 'lista2-ingredient-qty';
      if (qtyText) byline.textContent = `${prefix}: ${qtyText}`;
      nameGroup.appendChild(byline);
    }

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = 'any';
    input.className = 'lista2-shop-input';
    input.placeholder = 'Comprar...';
    if (shopQty[name] != null) input.value = shopQty[name];
    input.addEventListener('change', () => {
      const val = parseFloat(input.value);
      const prevShopQty = (lista2ShopQty[item.id] || {})[name];
      if (!lista2ShopQty[item.id]) lista2ShopQty[item.id] = {};
      if (!isNaN(val) && val >= 0) {
        lista2ShopQty[item.id][name] = val;
      } else {
        delete lista2ShopQty[item.id][name];
        input.value = '';
      }
      saveLista2ShopQty();
      if (val === 0) {
        if (!lista2Checked[item.id]) lista2Checked[item.id] = {};
        lista2Checked[item.id][name] = true;
        saveLista2Checked();
        updateLista2Progress(item);
      } else if (prevShopQty === 0) {
        if (lista2Checked[item.id]) delete lista2Checked[item.id][name];
        saveLista2Checked();
        updateLista2Progress(item);
      }
      const sheetInput = document.getElementById('lista2SheetRealQty');
      const sheetTitle = document.getElementById('lista2SheetTitle');
      if (lista2IngredientSheet?.classList.contains('is-open') && sheetTitle?.textContent === name && sheetInput) {
        sheetInput.value = input.value;
      }
    });

    li.appendChild(nameGroup);
    li.appendChild(input);
    lista2ShopList.appendChild(li);
  });
}

function updateLista2Progress(item) {
  if (!lista2DetailProgress) return;
  const shopQty = lista2ShopQty[item.id] || {};
  const nonPantry = item.ingredientNames.filter(name => shopQty[name] !== 0);
  const checkedMap = lista2Checked[item.id] || {};
  const checked = nonPantry.filter(name => checkedMap[name]).length;
  lista2DetailProgress.textContent = `${checked}/${nonPantry.length}`;
}

function openLista2Detail(item) {
  currentLista2ItemId = item.id;
  lista2ShopMode = false;
  const shopBtn = document.getElementById('lista2ShopModeBtn');
  if (shopBtn) shopBtn.classList.remove('is-active');

  closeLista2Sheet();

  if (lista2DetailTitle) lista2DetailTitle.textContent = STORE_LABELS[item.storeKey] || item.storeKey;
  if (lista2DetailMeta) lista2DetailMeta.textContent = `${formatDateShort(item.startDate)} – ${formatDateShort(item.endDate)}`;
  updateLista2Progress(item);

  renderLista2DetailList(item);
  showLista2Detail();
}

function renderLista2() {
  if (!lista2ItemsContainer) return;
  lista2ItemsContainer.innerHTML = '';

  if (lista2Items.length === 0) {
    const p = document.createElement('p');
    p.className = 'lista2-empty';
    p.textContent = 'Crea una nueva lista para empezar.';
    lista2ItemsContainer.appendChild(p);
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'store-list';

  [...lista2Items].sort((a, b) => b.id - a.id).forEach((item) => {
    const row = document.createElement('div');
    row.className = 'store-row';

    const storeName = STORE_LABELS[item.storeKey] || item.storeKey;
    const dateRange = `${formatDateShort(item.startDate)} – ${formatDateShort(item.endDate)}`;
    const shopQtyRow = lista2ShopQty[item.id] || {};
    const nonPantryNames = item.ingredientNames.filter(name => shopQtyRow[name] !== 0);
    const totalIngredients = nonPantryNames.length;
    const checkedIngredients = nonPantryNames.filter(name => (lista2Checked[item.id] || {})[name]).length;

    row.innerHTML = `
      <div class="store-row-left">
        <div class="store-row-name">${storeName}</div>
        <div class="store-row-meta">${dateRange}</div>
      </div>
      <span class="lista2-progress">${checkedIngredients}/${totalIngredients}</span>
      <span class="recipe-row-icon" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    `;

    row.addEventListener('click', () => openLista2Detail(item));
    wrapper.appendChild(row);
  });

  lista2ItemsContainer.appendChild(wrapper);
}

renderLista2();

// ─── Firebase Auth & Real-time Sync ────────────────────────────────────────
let _listenersStarted = false;

function startFirebaseListeners() {
  if (_listenersStarted) return;
  _listenersStarted = true;

  const paths = [
    { key: 'ingredients',      ref: 'compra/ingredients',      set: v => { ingredients      = v; }, render: () => renderIngredients() },
    { key: 'recipes',          ref: 'compra/recipes',          set: v => { recipes          = v; }, render: () => { renderRecipes(); renderCalendarEntries(); } },
    { key: 'calendarEntries',  ref: 'compra/calendarEntries',  set: v => { calendarEntries  = v; }, render: () => renderCalendarEntries() },
    { key: 'lista2Items',      ref: 'compra/lista2Items',      set: v => { lista2Items      = v; }, render: () => renderLista2() },
    { key: 'lista2Checked',    ref: 'compra/lista2Checked',    set: v => { lista2Checked    = v; }, render: () => renderLista2() },
    { key: 'lista2ShopQty',    ref: 'compra/lista2ShopQty',    set: v => { lista2ShopQty    = v; }, render: () => renderLista2() },
    { key: 'purchasedItems',   ref: 'compra/purchasedItems',   set: v => { purchasedItems   = v; }, render: () => { if (typeof renderShoppingListFromState === 'function') renderShoppingListFromState(); } },
    { key: 'lastShoppingList', ref: 'compra/lastShoppingList', set: v => { lastShoppingList = v; }, render: () => { if (typeof renderShoppingListFromState === 'function') renderShoppingListFromState(); } },
  ];

  // Initial one-time load from Firebase; migrate from localStorage if Firebase is empty
  Promise.all(paths.map(p => db.ref(p.ref).once('value')))
    .then(snaps => {
      snaps.forEach((snap, i) => {
        const val = snap.val();
        if (val !== null && val !== undefined) {
          paths[i].set(val);
        } else {
          // Firebase empty for this key — migrate from localStorage
          const local = localStorage.getItem(paths[i].key);
          if (local) {
            try {
              const parsed = JSON.parse(local);
              db.ref(paths[i].ref).set(parsed);
            } catch (e) {}
          }
        }
      });

      // Full re-render after initial load
      renderIngredients();
      renderRecipes();
      renderCalendarEntries();
      renderLista2();
      if (typeof renderShoppingListFromState === 'function') renderShoppingListFromState();

      // Set up persistent real-time listeners for cross-device sync
      paths.forEach(p => {
        db.ref(p.ref).on('value', snap => {
          const val = snap.val();
          if (val === null || val === undefined) return;
          p.set(val);
          try { p.render(); } catch (e) {}
        });
      });
    })
    .catch(err => console.error('Firebase initial load error:', err));
}

auth.onAuthStateChanged(user => {
  const loading      = document.getElementById('auth-loading');
  const loginOverlay = document.getElementById('login-overlay');
  const appLayout    = document.getElementById('app-layout');

  if (loading) loading.style.display = 'none';

  if (user) {
    if (loginOverlay) loginOverlay.style.display = 'none';
    if (appLayout)    appLayout.style.display    = 'block';
    startFirebaseListeners();
  } else {
    if (loginOverlay) loginOverlay.style.display = 'flex';
    if (appLayout)    appLayout.style.display    = 'none';
  }
});

const _loginForm = document.getElementById('login-form');
if (_loginForm) {
  _loginForm.addEventListener('submit', e => {
    e.preventDefault();
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl    = document.getElementById('login-error');
    if (errEl) errEl.textContent = '';
    auth.signInWithEmailAndPassword(email, password)
      .catch(() => {
        if (errEl) errEl.textContent = 'Email o contraseña incorrectos';
      });
  });
}

const _logoutBtn = document.getElementById('logout-btn');
if (_logoutBtn) {
  _logoutBtn.addEventListener('click', () => {
    auth.signOut().then(() => location.reload());
  });
}