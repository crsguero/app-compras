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
let consumables = safeLoad('consumables', []);
// Utensilios de Limpieza: { id, name } y nada más.
let utensils = safeLoad('utensils', []);
// Filas del Reparto (las tareas). Las carga su propio nodo de Firebase, en la
// sección REPARTO, pero se declara aquí porque las tablas de Consumibles y
// Utensilios cuentan menciones en sus instrucciones ya al pintarse por primera
// vez, que es antes de llegar a esa parte del archivo.
let repartoRows = [];
// Ajustes de ubicaciones/comercios, independientes por pestaña.
// null = todavía sin inicializar (se siembra en ensureSettingsSeed).
// Comercios y ubicaciones son listas únicas, compartidas por Ingredientes y
// Consumibles, y se editan desde el modal de Ajustes general.
let settingsSharedStores = safeLoad('settingsSharedStores', null);
let settingsSharedLocations = safeLoad('settingsSharedLocations', null);
// Estancias: lista suelta, solo se edita en Ajustes. Todavía no la usa ninguna
// pestaña, así que no tiene semilla ni recuento de uso.
let settingsSharedRooms = safeLoad('settingsSharedRooms', null);

// Las listas separadas anteriores. Ya no se editan: solo se leen para
// fusionarlas en las compartidas y no perder lo que hubiera configurado.
const _oldIngredientStores = safeLoad('settingsIngredientStores', null);
const _oldConsumableStores = safeLoad('settingsConsumableStores', null);
const _oldIngredientLocations = safeLoad('settingsIngredientLocations', null);
const _oldConsumableLocations = safeLoad('settingsConsumableLocations', null);

// Fusión conservadora: se respeta el orden de la primera lista y se añaden al
// final las entradas que solo existieran en las siguientes. Si una misma clave
// está en varias con nombres distintos, gana la primera; da igual cuál se
// elija porque los registros guardan la clave y no el nombre, así que ninguna
// asignación se rompe.
function mergeSettingsLists(...lists) {
  const merged = [];
  const seen = new Set();
  lists.forEach((list) => {
    if (!Array.isArray(list)) return;
    list.forEach((it) => {
      const value = it.value || slugifySettingValue(it.name || '');
      if (!value || seen.has(value)) return;
      seen.add(value);
      merged.push({ id: it.id ?? Date.now() + merged.length, value, name: it.name || '' });
    });
  });
  return merged;
}

// Claves de la versión anterior, cuando la lista era única y se editaba desde
// Consumibles. Se conservan para migrarlas a las listas de Consumibles.
const _legacySettingsLocations = safeLoad('settingsLocations', null);
const _legacySettingsStores    = safeLoad('settingsStores', null);
let recipes = safeLoad('recipes', []);
let editingRecipeId = null;
let calendarEntries = safeLoad('calendarEntries', []);
let calendarCooked   = safeLoad('calendarCooked',  {});
// Tabla semanal de Cocinados: { '<día>-<ingesta>': [idDeReceta, ...] }
let cocinados = safeLoad('cocinados', {});

// Columnas y filas de la tabla de Cocinados. Se declaran aquí, y no junto al
// resto del bloque, porque renderRecipes() repinta la tabla y se ejecuta antes.
// Los días usan el número de día de JavaScript (0 = domingo), igual que el
// selector de repetición de Planificación.
const COCINADOS_DAYS = [
  { id: 1, name: 'Lunes' },
  { id: 2, name: 'Martes' },
  { id: 3, name: 'Miércoles' },
  { id: 4, name: 'Jueves' },
  { id: 5, name: 'Viernes' },
  { id: 6, name: 'Sábado' },
  { id: 0, name: 'Domingo' },
];

// `recipes: true` marca las ingestas a las que se les pueden añadir recetas.
//
// `notes` marca las celdas que muestran un campo de texto de la receta. Es
// contenido calculado, no se guarda en la tabla:
//   field     — propiedad de la receta que se muestra.
//   dayOffset — dónde está la ración respecto a la celda: 0 el mismo día, 1 el
//               día siguiente.
//   ownMeal   — true mira solo las raciones de esa misma ingesta; false, las de
//               cualquier ingesta del día (se cocina para desayuno, almuerzo...).
//   firstOnly — true solo la primera ración, porque se cocina una vez; false
//               todas, porque cada ración se consume por separado.
const COCINADOS_MEALS = [
  { id: 'desayuno', name: 'Desayuno',          recipes: true,
    notes: { field: 'momentoIngesta', dayOffset: 0, ownMeal: true, firstOnly: false } },
  { id: 'manana',   name: 'Durante la mañana', recipes: false,
    notes: { field: 'mismaManana', dayOffset: 0, ownMeal: false, firstOnly: true } },
  { id: 'almuerzo', name: 'Almuerzo',          recipes: true,
    notes: { field: 'momentoIngesta', dayOffset: 0, ownMeal: true, firstOnly: false } },
  { id: 'cena',     name: 'Cena',              recipes: true,
    notes: { field: 'momentoIngesta', dayOffset: 0, ownMeal: true, firstOnly: false } },
  { id: 'noche',    name: 'Por la noche',      recipes: false,
    notes: { field: 'diaAnterior', dayOffset: 1, ownMeal: false, firstOnly: true } },
];

// Nombre de cada ración dentro de un reparto. Aquí arriba por lo mismo que las
// dos listas anteriores: las lee el pintado de la tabla, que corre antes.
const COCINADO_ORDINALS = [
  'Primera', 'Segunda', 'Tercera', 'Cuarta', 'Quinta',
  'Sexta', 'Séptima', 'Octava', 'Novena', 'Décima',
];

// Dónde está la vista de móvil de Cocinados, donde los siete días no caben en
// el ancho de la pantalla y la tabla se recorre en tres niveles: los días, las
// ingestas del día elegido y el contenido de la celda. Con los dos campos a
// null se está en el primero. Aquí arriba por lo mismo que la lista anterior:
// los lee el pintado de la tabla, que corre antes.
let cocinadoMobileDayId = null;
let cocinadoMobileMealId = null;
let purchasedItems = safeLoad('purchasedItems', {});
let lastShoppingList = safeLoad('lastShoppingList', null);
// Firebase guarda los arrays vacíos como null, así que una lista sin
// elementos puede volver sin `ingredientNames`. Se normaliza al cargar —igual
// que hace el listener— porque un fallo aquí tumbaría el arranque entero.
const _rawLista2Items = safeLoad('lista2Items', []);
let lista2Items = (Array.isArray(_rawLista2Items) ? _rawLista2Items : [])
  .map((item) => ({ ...item, ingredientNames: item.ingredientNames || [] }));
let lista2Checked = safeLoad('lista2Checked', {});
let lista2ShopQty = safeLoad('lista2ShopQty', {});
let lista2ShopMode = false;
let editingIngredientId = null;
let editingConsumableId = null;
let editingUtensilId = null;

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
  gramo:    { singular: 'gramo',    plural: 'gramos' },
};

const MEAL_LABELS = {
  'desayuno': 'Desayuno',
  'media-manana': 'Media mañana',
  'almuerzo': 'Almuerzo',
  'merienda': 'Merienda',
  'cena': 'Cena',
};

// Categorías de consumible. Lista fija y en este orden, que es el que usa la
// columna de la tabla al ordenar.
const CONSUMABLE_CATEGORIES = [
  { id: 'cocina',   name: 'Cocina' },
  { id: 'lavanderia', name: 'Lavandería' },
  { id: 'residuos', name: 'Gestión de residuos' },
  { id: 'limpieza', name: 'Limpieza' },
  { id: 'orden',    name: 'Orden' },
];

function consumableCategoryLabel(id) {
  return CONSUMABLE_CATEGORIES.find((category) => category.id === id)?.name || '';
}

// El campo es opcional, así que el selector siempre lleva la opción vacía.
// Igual que `populateSettingsSelect`: `undefined` conserva lo que hubiera
// elegido y '' lo limpia.
function populateCategorySelect(select, selected) {
  if (!select) return;

  const value = selected === undefined ? select.value : selected;
  select.innerHTML = '<option value="">Sin categoría</option>';
  CONSUMABLE_CATEGORIES.forEach((category) => {
    const option = document.createElement('option');
    option.value = category.id;
    option.textContent = category.name;
    if (category.id === value) option.selected = true;
    select.appendChild(option);
  });
}

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
const ACTIVE_RAIL_KEY = 'activeRail';

let _ingredientSort = { col: 'name', dir: 'asc' };
let _recipeSort = { dir: 'asc' };
let _ingredientFilters = { stores: new Set(), locations: new Set(), pantry: null, shoppingType: null };
let _ingredientSearch = '';
// Ordenación de las tablas Consumibles de las pestañas de las áreas, que se
// reordenan por varias columnas.
let _consumableSort = { col: 'name', dir: 'asc' };
// La vista por nombre solo se ordena por nombre: pulsando la cabecera se
// cambia el sentido y nada más.
let _consumableNameSort = { col: 'name', dir: 'asc' };
let _consumableSearch = '';
// Pestañas de Compras › Consumibles: 'name' (una sola tabla) o 'location'
// (una tabla por estancia).
let _consumableView = 'name';
// Las tablas por estancia van siempre en este orden, sin cabeceras que se
// puedan pulsar: por ubicación, en el orden definido en Ajustes.
const CONSUMABLE_ROOM_SORT = { col: 'location', dir: 'asc' };
// La tabla de utensilios solo tiene la columna del nombre: basta el sentido.
let _utensilSort = { dir: 'asc' };
// Las listas de tareas también tienen una sola columna: solo el sentido.
let _tareaSort = { dir: 'asc' };
let _recipeSearch = '';
let _recipeTooltip = null;


function isValidISODateString(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// -----------------------
// GUARDAR EN LOCALSTORAGE
// -----------------------

// Si el guardado en Firebase falla (p.ej. sesión caducada o regla de
// seguridad), avisar en vez de fallar en silencio — el cambio quedaría
// solo en este dispositivo y nunca llegaría a los demás.
function saveToFirebase(path, value) {
  db.ref(path).set(value).catch(err => {
    console.error(`Error al guardar en Firebase (${path}):`, err);
    alert(`No se ha podido sincronizar el cambio con los otros dispositivos.\n\nRuta: ${path}\nError: ${err.message}`);
  });
}

function saveIngredients() {
  localStorage.setItem('ingredients', JSON.stringify(ingredients));
  saveToFirebase('compra/ingredients', ingredients);
}

function saveConsumables() {
  localStorage.setItem('consumables', JSON.stringify(consumables));
  saveToFirebase('compra/consumables', consumables);
}

function saveUtensils() {
  localStorage.setItem('utensils', JSON.stringify(utensils));
  saveToFirebase('compra/utensils', utensils);
}

function saveSettingsList(listKey) {
  const cfg = SETTINGS_LISTS[listKey];
  if (!cfg) return;
  const items = cfg.getItems() || [];
  localStorage.setItem(cfg.storageKey, JSON.stringify(items));
  saveToFirebase(cfg.fbPath, items);
}

function saveRecipes() {
  localStorage.setItem('recipes', JSON.stringify(recipes));
  saveToFirebase('compra/recipes', recipes);
}

function saveCalendarEntries() {
  localStorage.setItem('calendarEntries', JSON.stringify(calendarEntries));
  saveToFirebase('compra/calendarEntries', calendarEntries);
}

function saveCalendarCooked() {
  localStorage.setItem('calendarCooked', JSON.stringify(calendarCooked));
  saveToFirebase('compra/calendarCooked', calendarCooked);
}

function saveCocinados() {
  localStorage.setItem('cocinados', JSON.stringify(cocinados));
  saveToFirebase('compra/cocinados', cocinados);
}

function saveLista2Items() {
  localStorage.setItem('lista2Items', JSON.stringify(lista2Items));
  saveToFirebase('compra/lista2Items', lista2Items);
}

function saveLista2Checked() {
  localStorage.setItem('lista2Checked', JSON.stringify(lista2Checked));
  saveToFirebase('compra/lista2Checked', lista2Checked);
}

function saveLista2ShopQty() {
  localStorage.setItem('lista2ShopQty', JSON.stringify(lista2ShopQty));
  saveToFirebase('compra/lista2ShopQty', lista2ShopQty);
}

function savePurchasedItems() {
  localStorage.setItem('purchasedItems', JSON.stringify(purchasedItems));
  saveToFirebase('compra/purchasedItems', purchasedItems);
}

function saveLastShoppingList() {
  localStorage.setItem('lastShoppingList', JSON.stringify(lastShoppingList));
  saveToFirebase('compra/lastShoppingList', lastShoppingList);
}


// -----------------------
// FUNCIONES UTILITARIAS
// -----------------------

// "YYYY-MM-DD" -> Date a medianoche LOCAL. Importante no usar
// `new Date('YYYY-MM-DD')`: eso la interpreta como medianoche UTC, la deja a
// las 01:00/02:00 locales y, al avanzar días con addDays (que conserva la hora
// local), un cambio de horario de verano desplaza el instante una hora.
function parseISODate(dateString) {
  if (!dateString) return new Date(NaN);
  const [y, m, d] = String(dateString).split('-').map(Number);
  if (!y || !m || !d) return new Date(NaN);
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

// Los nombres de los meses los da el navegador, como el resto de las fechas.
const MONTH_NAMES = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleDateString('es-ES', { month: 'long' })
);

// La caducidad es un mes y un año, sin día: se guarda como «2026-11».
function expiryValue(year, month) {
  if (!year || !month) return null;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function parseExpiry(value) {
  const [year, month] = String(value || '').split('-');
  const index = Number(month) - 1;
  if (!/^\d{4}$/.test(year || '') || !(index >= 0 && index < 12)) return null;
  return { year, month: String(index + 1).padStart(2, '0'), index };
}

// Caducidad para celdas de tabla: «Nov 2026».
function formatExpiry(value) {
  const parsed = parseExpiry(value);
  if (!parsed) return '';
  const month = new Date(2000, parsed.index, 1)
    .toLocaleDateString('es-ES', { month: 'short' })
    .replace('.', '');
  return `${month.charAt(0).toUpperCase() + month.slice(1)} ${parsed.year}`;
}

const EXPIRY_ALARM_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="12" cy="13" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M12 9.5V13L14 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 3L2.5 5.5M19 3L21.5 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// La caducidad se compara por meses, que es lo que se guarda: 'upcoming' si
// queda por delante, 'due' si es el mes en curso o uno ya pasado.
function expiryStatus(value) {
  const parsed = parseExpiry(value);
  if (!parsed) return null;
  const now = new Date();
  const currentMonths = now.getFullYear() * 12 + now.getMonth();
  const expiryMonths = Number(parsed.year) * 12 + parsed.index;
  return expiryMonths > currentMonths ? 'upcoming' : 'due';
}

// Celda de caducidad de las tablas: vacía si no hay fecha, en amarillo si aún
// queda por delante y en rojo con una alarma si ya se cumplió.
function renderExpiryCell(td, value) {
  const status = expiryStatus(value);
  if (!status) {
    td.textContent = '';
    return;
  }
  td.classList.add('expiry-cell', `is-${status}`);
  td.innerHTML = `<span class="expiry-cell-inner">${status === 'due' ? EXPIRY_ALARM_ICON : ''}${formatExpiry(value)}</span>`;
}

// Mes y año de caducidad: los 12 meses y el año actual más los 9 siguientes.
// Con el valor guardado ya seleccionado; si no hay, se queda el placeholder.
function populateExpirySelects(monthSelect, yearSelect, value) {
  const parsed = parseExpiry(value);

  if (monthSelect) {
    monthSelect.innerHTML = '<option value="">Mes</option>' +
      MONTH_NAMES.map((name, i) => {
        const month = String(i + 1).padStart(2, '0');
        const label = name.charAt(0).toUpperCase() + name.slice(1);
        return `<option value="${month}">${label}</option>`;
      }).join('');
    monthSelect.value = parsed?.month || '';
  }

  if (yearSelect) {
    const firstYear = new Date().getFullYear();
    const years = Array.from({ length: 10 }, (_, i) => firstYear + i);
    yearSelect.innerHTML = '<option value="">Año</option>' +
      years.map((y) => `<option value="${y}">${y}</option>`).join('');
    // Un año guardado que ya quedó atrás no está en la lista: se añade para
    // que no se pierda al editar, igual que las ubicaciones y los comercios.
    if (parsed && !years.includes(Number(parsed.year))) {
      yearSelect.insertAdjacentHTML('beforeend', `<option value="${parsed.year}">${parsed.year}</option>`);
    }
    yearSelect.value = parsed?.year || '';
  }
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
  const date = parseISODate(dateString);

  return date.toLocaleDateString('es-ES', {
    weekday: 'long',
  });
}


// -----------------------
// AJUSTES: UBICACIONES Y COMERCIOS
// -----------------------
// Cada pestaña tiene sus propias listas: las de Ingredientes solo afectan a
// Ingredientes y las de Consumibles solo a Consumibles.
//
// Los registros guardados (ingredient.store, ingredient.location,
// consumable.store) siguen almacenando su clave interna (`value`), nunca el
// nombre visible. Editar, reordenar o borrar una entrada de estas listas no
// modifica ningún registro: si una clave deja de estar en la lista, se sigue
// mostrando con su etiqueta original y se sigue ofreciendo en el desplegable
// del registro que la usa.

// Fila en edición: { listKey, id } o null.
let _settingsEditing = null;

const SETTINGS_LISTS = {
  'shared-location': {
    storageKey: 'settingsSharedLocations',
    fbPath: 'compra/settingsSharedLocations',
    getItems: () => settingsSharedLocations,
    setItems: (v) => { settingsSharedLocations = v; },
    sectionsElId: 'appSettingsLocationsSections',
    fallbackLabels: LOCATION_LABELS,
    legacy: () => mergeSettingsLists(_oldIngredientLocations, _oldConsumableLocations),
    noun: 'ubicación',
    plural: 'ubicaciones',
    placeholder: 'Nombre de la ubicación...',
    usageCount: (value) =>
      ingredients.filter((i) => (i.location || '') === value).length
      + consumables.filter((c) => (c.location || '') === value).length,
    usageNoun: 'elemento',
    usagePlural: 'elementos',
    showUsage: true,
    // Las ubicaciones van repartidas en secciones, una por estancia, y se
    // crean dentro de su sección. Solo afecta a este panel de Ajustes:
    // ninguna pestaña de la app lee todavía el campo `room`.
    sections: {
      listKey: 'shared-room',
      field: 'room',
      emptyTitle: 'Sin estancia',
    },
    onChange: () => {
      refreshIngredientSelects();
      refreshConsumableSelects();
      renderIngredients();
      renderConsumables();
      renderFilterPanel();
    },
  },
  // Estancias: solo nombre. Ninguna pestaña de la app las usa todavía, así que
  // no hay semilla ni contador en la fila; el recuento solo sirve para avisar
  // al borrar una que tenga ubicaciones asignadas.
  'shared-room': {
    storageKey: 'settingsSharedRooms',
    fbPath: 'compra/settingsSharedRooms',
    getItems: () => settingsSharedRooms,
    setItems: (v) => { settingsSharedRooms = v; },
    listElId: 'appSettingsRoomsList',
    fallbackLabels: {},
    legacy: () => [],
    noun: 'estancia',
    plural: 'estancias',
    placeholder: 'Nombre de la estancia...',
    usageCount: (value) =>
      getSettingsItems('shared-location').filter((it) => (it.room || '') === value).length,
    usageNoun: 'ubicación',
    usagePlural: 'ubicaciones',
    showUsage: false,
    deleteWarning: (used) =>
      `\n\nHay ${used} ${used === 1 ? 'ubicación' : 'ubicaciones'} en esta estancia.`
      + ' No se borrarán: pasarán a «Sin estancia».',
    // Sus ubicaciones se quedarían en una sección de una estancia que ya no
    // existe, así que se las deja sin estancia.
    onDelete: (value) => {
      const locations = getSettingsItems('shared-location');
      const affected = locations.filter((it) => (it.room || '') === value);
      if (!affected.length) return;
      affected.forEach((it) => { it.room = ''; });
      saveSettingsList('shared-location');
    },
    // Nada que repintar fuera de Ajustes: las secciones de Ubicaciones se
    // repintan con el resto de las listas.
    onChange: () => {},
  },
  'shared-store': {
    storageKey: 'settingsSharedStores',
    fbPath: 'compra/settingsSharedStores',
    getItems: () => settingsSharedStores,
    setItems: (v) => { settingsSharedStores = v; },
    listElId: 'appSettingsStoresList',
    fallbackLabels: STORE_LABELS,
    legacy: () => mergeSettingsLists(_oldIngredientStores, _oldConsumableStores),
    noun: 'comercio',
    plural: 'comercios',
    placeholder: 'Nombre del comercio...',
    usageCount: (value) =>
      ingredients.filter((i) => (i.store || '') === value).length
      + consumables.filter((c) => (c.store || '') === value).length,
    usageNoun: 'elemento',
    usagePlural: 'elementos',
    showUsage: true,
    onChange: () => {
      refreshIngredientSelects();
      refreshConsumableSelects();
      renderIngredients();
      renderConsumables();
      renderFilterPanel();
    },
  },
};

function slugifySettingValue(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function getSettingsItems(listKey) {
  const items = SETTINGS_LISTS[listKey]?.getItems();
  return Array.isArray(items) ? items : [];
}

// Etiqueta visible de una clave guardada. Si la clave ya no está en la lista
// configurada, se cae a la etiqueta original de la app y, en último término, a
// la propia clave: así ningún registro se queda sin texto.
function settingsLabel(listKey, value) {
  if (!value) return '';
  const item = getSettingsItems(listKey).find((it) => it.value === value);
  if (item) return item.name;
  return SETTINGS_LISTS[listKey]?.fallbackLabels[value] || value;
}

// Orden configurado, usado para ordenar las columnas de las tablas.
function settingsOrder(listKey) {
  const order = getSettingsItems(listKey)
    .map((it) => it.value)
    .filter(Boolean);
  return order.length ? order : Object.keys(SETTINGS_LISTS[listKey].fallbackLabels);
}

// Opciones para filtros: las configuradas más las claves que aún estén en uso
// en los datos aunque ya no figuren en la lista.
function settingsOptions(listKey, usedValues = []) {
  const opts = [];
  const seen = new Set();
  getSettingsItems(listKey).forEach((it) => {
    if (!it.value || seen.has(it.value)) return;
    seen.add(it.value);
    opts.push({ value: it.value, label: it.name });
  });
  usedValues.forEach((v) => {
    if (!v || seen.has(v)) return;
    seen.add(v);
    opts.push({ value: v, label: settingsLabel(listKey, v) });
  });
  return opts;
}

// Rellena un <select> con la lista configurada, conservando el valor actual
// aunque ya no esté en la lista (se añade como opción extra).
function populateSettingsSelect(selectEl, listKey, currentValue, placeholder) {
  if (!selectEl) return;
  const value = currentValue !== undefined && currentValue !== null
    ? currentValue
    : selectEl.value || '';

  selectEl.innerHTML = '';

  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = placeholder;
  selectEl.appendChild(ph);

  settingsOptions(listKey, value ? [value] : []).forEach(({ value: v, label }) => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = label;
    selectEl.appendChild(opt);
  });

  selectEl.value = value || '';
}

// Semilla inicial: primero las listas de la versión anterior (que solo existían
// para Consumibles) y, si no las hay, las listas fijas de la app. Sembrar con
// las mismas claves que ya usan los registros garantiza que todo siga
// resolviendo igual que antes.
// Solo escribe en localStorage: si Firebase ya tiene datos, mandan los de Firebase.
function ensureSettingsSeed() {
  Object.entries(SETTINGS_LISTS).forEach(([, cfg]) => {
    if (Array.isArray(cfg.getItems())) return;

    const legacy = cfg.legacy();
    const seeded = Array.isArray(legacy) && legacy.length
      ? legacy.map((it, i) => ({
          id: it.id ?? Date.now() + i,
          value: it.value || slugifySettingValue(it.name || '') || String(Date.now() + i),
          name: it.name || '',
        }))
      : Object.entries(cfg.fallbackLabels).map(([value, name], i) => ({
          id: Date.now() + i,
          value,
          name,
        }));

    cfg.setItems(seeded);
    localStorage.setItem(cfg.storageKey, JSON.stringify(seeded));
  });
}

ensureSettingsSeed();

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
const expiryMonthSelect = document.getElementById('expiryMonthSelect');
const expiryYearSelect = document.getElementById('expiryYearSelect');
const ingredientCommentInput = document.getElementById('ingredientCommentInput');
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
    populateSettingsSelect(newLocationSelect, 'shared-location', '', 'Selecciona una ubicación...');
    populateSettingsSelect(newStoreSelect, 'shared-store', '', 'Selecciona un comercio...');
    if (newPantryToggle) newPantryToggle.checked = false;
    if (newMinQuantityWrapper) newMinQuantityWrapper.classList.add('hidden');
    if (newMinQuantityInput) newMinQuantityInput.required = false;
    if (newFormatoUnit) newFormatoUnit.textContent = '-';
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
    newFormatoUnit.textContent = newUnitInput.value || '-';
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
    if (newFormatoUnit) newFormatoUnit.textContent = '-';
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
    formatoUnit.textContent = unitInput.value || '-';
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
  settingsOptions('shared-store', ingredients.map((i) => i.store)).forEach(({ value: key, label }) => {
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
  settingsOptions('shared-location', ingredients.map((i) => i.location)).forEach(({ value: key, label }) => {
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
  const storeOrder = settingsOrder('shared-store');
  const locationOrder = settingsOrder('shared-location');

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
    { key: 'name',         label: 'Nombre',     sortable: true  },
    { key: 'unit',         label: 'Unidad',     sortable: false },
    { key: 'location',     label: 'Ubicación',  sortable: true  },
    { key: 'pantry',       label: 'Despensa',   sortable: false },
    { key: 'expiryDate',   label: 'Caducidad',  sortable: false },
    { key: 'shoppingType', label: 'Tipo',       sortable: true  },
    { key: 'store',        label: 'Comercio',   sortable: true  },
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
    unitTd.textContent = ingredient.unit || '';
    tr.appendChild(unitTd);

    // Ubicación
    const locTd = document.createElement('td');
    locTd.textContent = settingsLabel('shared-location', ingredient.location);
    tr.appendChild(locTd);

    // Despensa
    const pantryTd = document.createElement('td');
    pantryTd.textContent = ingredient.pantry ? 'Sí' : 'No';
    tr.appendChild(pantryTd);

    // Caducidad: vacía si el ingrediente no tiene fecha
    const expiryTd = document.createElement('td');
    renderExpiryCell(expiryTd, ingredient.expiryDate);
    tr.appendChild(expiryTd);

    // Tipo
    const tipoTd = document.createElement('td');
    tipoTd.textContent = ingredient.shoppingType === 'semanal' ? 'Semanal' : ingredient.shoppingType === 'mensual' ? 'Mensual' : (ingredient.shoppingType || '');
    tr.appendChild(tipoTd);

    // Comercio
    const storeTd = document.createElement('td');
    storeTd.textContent = settingsLabel('shared-store', ingredient.store);
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
      startEditIngredient(ingredient.id);
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
  // Se repueblan con el valor guardado para que, si esa ubicación/comercio ya
  // no está en los ajustes, siga apareciendo y no se pierda al editar.
  populateSettingsSelect(storeSelect, 'shared-store', ingredient.store || '', 'Selecciona un comercio...');
  populateSettingsSelect(locationSelect, 'shared-location', ingredient.location || '', 'Selecciona una ubicación...');
  if (shoppingTypeSelect) shoppingTypeSelect.value = ingredient.shoppingType || '';
  if (productInput) productInput.value = ingredient.product || '';
  if (productUnitSelect) productUnitSelect.value = ingredient.productUnit || '';
  if (formatoInput) formatoInput.value = ingredient.formato || '';
  if (formatoUnit) formatoUnit.textContent = ingredient.unit || '-';
  populateExpirySelects(expiryMonthSelect, expiryYearSelect, ingredient.expiryDate);
  setRichTextValue(ingredientCommentInput, ingredient.comment);
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


  // Recetas que usan este ingrediente
  const usedInRecipesEl = document.getElementById('ingredientUsedInRecipes');
  if (usedInRecipesEl) {
    const matchingRecipes = recipes.filter((r) =>
      r.ingredients?.some((ri) => ri.ingredientId === id)
    );
    const editIconSvg = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.333 2a1.885 1.885 0 0 1 2.667 2.667L4.889 13.778 2 14l.222-2.889L11.333 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    if (matchingRecipes.length === 0) {
      usedInRecipesEl.innerHTML = '';
    } else {
      usedInRecipesEl.innerHTML = `
        <p class="field-label-small"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.83337 14.1666L14.1667 5.83325" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.83337 5.83325H14.1667V14.1666" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Usado en</p>
        <ul class="ingredient-recipe-list">
          ${matchingRecipes.map((r) => `
            <li class="ingredient-recipe-row" data-recipe-id="${r.id}">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="ingredient-recipe-icon">
                <path d="M11.6667 1.66675H5.00004C4.55801 1.66675 4.13409 1.84234 3.82153 2.1549C3.50897 2.46746 3.33337 2.89139 3.33337 3.33341V16.6667C3.33337 17.1088 3.50897 17.5327 3.82153 17.8453C4.13409 18.1578 4.55801 18.3334 5.00004 18.3334H15C15.4421 18.3334 15.866 18.1578 16.1786 17.8453C16.4911 17.5327 16.6667 17.1088 16.6667 16.6667V6.66675L11.6667 1.66675Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M11.6666 1.66675V6.66675H16.6666" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M13.3333 10.8333H6.66663" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M13.3333 14.1667H6.66663" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M8.33329 7.5H7.49996H6.66663" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span class="ingredient-recipe-name">${r.name}</span>
              <button type="button" class="ingredient-recipe-edit-btn" aria-label="Editar receta">${editIconSvg}</button>
            </li>`).join('')}
        </ul>`;

      usedInRecipesEl.querySelectorAll('.ingredient-recipe-edit-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const recipeId = Number(btn.closest('li').dataset.recipeId);
          activateTab('recipes', 'compras');
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
  ingredient.expiryDate = expiryValue(expiryYearSelect?.value, expiryMonthSelect?.value);
  ingredient.comment = getRichTextValue(ingredientCommentInput);

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
      expiryDate: expiryValue(expiryYearSelect?.value, expiryMonthSelect?.value),
      comment: getRichTextValue(ingredientCommentInput),
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
  populateExpirySelects(expiryMonthSelect, expiryYearSelect, null);
  // El comentario es un contenteditable: form.reset() no lo vacía.
  setRichTextValue(ingredientCommentInput, '');
  ingredientEditPanel?.classList.remove('is-editing');
  closeIngredientPanel();
  editingIngredientId = null;
  pantryToggle.checked = false;
  minQuantityWrapper.classList.add('hidden');
  minQuantityInput.required = false;
  minQuantityInput.value = '';
  locationSelect.value = '';


  ingredientForm
    .querySelector('button[type="submit"]')
    .textContent = 'Guardar ingrediente';
});
}

function autoSaveIngredient() {
  if (!editingIngredientId) return;

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
  ingredient.expiryDate = expiryValue(expiryYearSelect?.value, expiryMonthSelect?.value);
  ingredient.comment = getRichTextValue(ingredientCommentInput);

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
  expiryMonthSelect, expiryYearSelect,
].forEach((el) => {
  if (el) el.addEventListener('change', autoSaveIngredient);
});


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
// CONSUMIBLES
// -----------------------
const consumableForm = document.getElementById('consumableForm');
const consumableList = document.getElementById('consumableList');
const consumableRoomGroups = document.getElementById('consumableRoomGroups');
const consumableNameInput = document.getElementById('consumableNameInput');
const consumableMinQuantityInput = document.getElementById('consumableMinQuantityInput');
const consumableCategorySelect = document.getElementById('consumableCategorySelect');
const consumableLocationSelect = document.getElementById('consumableLocationSelect');
const consumableStoreSelect = document.getElementById('consumableStoreSelect');
const consumableProductInput = document.getElementById('consumableProductInput');
const consumableExpiryMonthSelect = document.getElementById('consumableExpiryMonthSelect');
const consumableExpiryYearSelect = document.getElementById('consumableExpiryYearSelect');
const consumableCommentInput = document.getElementById('consumableCommentInput');
const consumableModalTitle = document.getElementById('consumableModalTitle');

const openConsumableModalBtn = document.getElementById('openConsumableModal');
const consumableEditPanel = document.getElementById('consumableEditPanel');
const closeConsumableModalBtn = document.getElementById('closeConsumableModal');

// Modal: nuevo consumible
const newConsumableModal = document.getElementById('newConsumableModal');
const newConsumableForm = document.getElementById('newConsumableForm');
const newConsumableNameInput = document.getElementById('newConsumableNameInput');
const newConsumableMinQuantityInput = document.getElementById('newConsumableMinQuantityInput');
const newConsumableCategorySelect = document.getElementById('newConsumableCategorySelect');
const newConsumableLocationSelect = document.getElementById('newConsumableLocationSelect');
const newConsumableStoreSelect = document.getElementById('newConsumableStoreSelect');
const newConsumableProductInput = document.getElementById('newConsumableProductInput');

// Las pestañas «Consumibles» de las secciones del rail enseñan la misma tabla
// que Compras › Consumibles, con los de su categoría y nada más.
const CONSUMABLE_AREA_LISTS = {
  consumableListCocina:     'cocina',
  consumableListLimpieza:   'limpieza',
  consumableListLavanderia: 'lavanderia',
  consumableListResiduos:   'residuos',
};

function openConsumablePanel() {
  consumableEditPanel?.classList.add('is-open');
}

function closeConsumablePanel() {
  consumableEditPanel?.classList.remove('is-open');
  clearConsumableSelection();
}

function clearConsumableSelection() {
  document.querySelectorAll('.consumable-list .ingredient-table tr.is-selected')
    .forEach((r) => r.classList.remove('is-selected'));
}

// El panel de edición es único: se lleva a la pestaña desde la que se abre
// (la de Compras o la de una sección), igual que el panel de tarea.
function moveConsumablePanelTo(host) {
  const section = host?.closest('.tab-content');
  if (!section || !consumableEditPanel) return;
  if (consumableEditPanel.parentElement !== section) section.appendChild(consumableEditPanel);
}

// La categoría llega puesta cuando se crea desde la pestaña de un área; desde
// Compras se abre vacía. Se puede cambiar en el propio formulario.
function openNewConsumableModal(category = '') {
  if (newConsumableForm) newConsumableForm.reset();
  populateCategorySelect(newConsumableCategorySelect, category);
  populateSettingsSelect(newConsumableLocationSelect, 'shared-location', '', 'Selecciona una ubicación...');
  populateSettingsSelect(newConsumableStoreSelect, 'shared-store', '', 'Selecciona un comercio...');
  openModal(newConsumableModal);
}

if (openConsumableModalBtn) {
  openConsumableModalBtn.addEventListener('click', () => openNewConsumableModal());
}

// Botón de crear de las pestañas «Consumibles» de cada área.
document.querySelectorAll('.new-consumable-btn').forEach((btn) => {
  btn.addEventListener('click', () => openNewConsumableModal(btn.dataset.category || ''));
});

document.getElementById('closeNewConsumableModal')?.addEventListener('click', () => {
  closeModal(newConsumableModal);
});

newConsumableModal?.addEventListener('click', (e) => {
  if (e.target === newConsumableModal) closeModal(newConsumableModal);
});

if (newConsumableForm) {
  newConsumableForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = newConsumableNameInput.value.trim();
    const store = newConsumableStoreSelect.value;

    if (!name || !store) return;

    consumables.push({
      id: Date.now(),
      name,
      category: newConsumableCategorySelect?.value || null,
      minQuantity: newConsumableMinQuantityInput?.value.trim() || null,
      location: newConsumableLocationSelect?.value || null,
      store: store || null,
      product: newConsumableProductInput?.value.trim() || null,
      active: true,
    });

    saveConsumables();
    renderConsumables();

    newConsumableForm.reset();
    closeModal(newConsumableModal);
  });
}

if (closeConsumableModalBtn) {
  closeConsumableModalBtn.addEventListener('click', () => {
    closeConsumablePanel();
  });
}

document.getElementById('closeConsumableSheetBtn')?.addEventListener('click', () => {
  closeConsumablePanel();
});

function applyConsumableFilters(arr) {
  if (!_consumableSearch) return [...arr];
  const q = _consumableSearch.toLowerCase();
  return arr.filter((c) => c.name.toLowerCase().includes(q));
}

function renderConsumables() {
  syncConsumableViewTabs();

  // Las dos vistas de Compras salen de los mismos consumibles, así que se
  // repintan siempre las dos y solo se enseña la de la pestaña activa.
  const showingByLocation = _consumableView === 'location';
  if (consumableList) consumableList.hidden = showingByLocation;
  if (consumableRoomGroups) consumableRoomGroups.hidden = !showingByLocation;

  // La búsqueda es la de Compras: a las tablas de las secciones no las toca.
  renderConsumableHost(consumableList, applyConsumableFilters(consumables), {
    hiddenCols: ['usedIn'],
    sortState: _consumableNameSort,
    sortableCols: ['name'],
  });
  renderConsumableRoomGroups();

  // Las tablas de las áreas se quedan como estaban: con «Usado en», con su
  // ordenación por varias columnas y sin la estancia.
  Object.entries(CONSUMABLE_AREA_LISTS).forEach(([hostId, category]) => {
    renderConsumableHost(
      document.getElementById(hostId),
      consumables.filter((c) => c.category === category),
      { hiddenCols: ['room'] }
    );
  });

  // Repintar deshace la selección: se vuelve a marcar la fila abierta en el
  // panel, en las tablas de la pestaña desde la que se abrió (la de Compras o
  // la de un área). Se marcan todas sus filas: en Compras el consumible está
  // en las dos vistas y solo una se ve.
  if (editingConsumableId) {
    consumableEditPanel?.closest('.tab-content')
      ?.querySelectorAll(`.consumable-list .ingredient-table tr[data-id="${editingConsumableId}"]`)
      .forEach((tr) => tr.classList.add('is-selected'));
  }
}

function renderConsumableHost(host, rows, opts = {}) {
  if (!host) return;

  host.innerHTML = '';

  if (window.innerWidth >= 768) {
    renderConsumablesTable(host, rows, opts);
  } else {
    const alphabetical = [...rows].sort((a, b) =>
      a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
    );
    renderConsumablesList(host, alphabetical);
  }
}

// La pestaña marcada se deduce siempre de _consumableView, no del clic: así
// siempre hay exactamente una activa, se llegue por donde se llegue.
function syncConsumableViewTabs() {
  const tabs = document.querySelectorAll('#consumableViewTabs .shopping-tab-btn');
  if (!tabs.length) return;

  // Ante un valor inesperado se vuelve a la vista por nombre, para no dejar
  // ninguna pestaña marcada.
  const known = [...tabs].some((b) => b.dataset.consumableView === _consumableView);
  if (!known) _consumableView = 'name';

  tabs.forEach((b) => b.classList.toggle('active', b.dataset.consumableView === _consumableView));
}

document.querySelectorAll('#consumableViewTabs .shopping-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    _consumableView = btn.dataset.consumableView;
    renderConsumables();
  });
});

// Estancia de una ubicación, según lo asignado en Ajustes › Ubicaciones.
// Cadena vacía cuando la ubicación no tiene estancia o el consumible no tiene
// ubicación.
function locationRoomKey(locationValue) {
  if (!locationValue) return '';
  const item = getSettingsItems('shared-location').find((it) => it.value === locationValue);
  return item?.room || '';
}

// Vista «Por ubicación»: los mismos consumibles de la vista por nombre (con la
// búsqueda aplicada), repartidos en una tabla por estancia. Las estancias van
// en el orden configurado y la de «Sin estancia» al final; una estancia sin
// consumibles no sale.
function renderConsumableRoomGroups() {
  if (!consumableRoomGroups) return;

  consumableRoomGroups.innerHTML = '';

  const rows = applyConsumableFilters(consumables);

  const byRoom = new Map();
  rows.forEach((c) => {
    const key = locationRoomKey(c.location);
    if (!byRoom.has(key)) byRoom.set(key, []);
    byRoom.get(key).push(c);
  });

  const order = settingsOrder('shared-room');
  const rank = (key) => {
    if (!key) return 3000;
    const i = order.indexOf(key);
    return i === -1 ? 2000 : i;
  };

  const keys = [...byRoom.keys()].sort((a, b) => rank(a) - rank(b));

  if (keys.length === 0) {
    const p = document.createElement('p');
    p.className = 'consumable-room-empty';
    p.textContent = _consumableSearch
      ? 'No hay consumibles que coincidan con la búsqueda.'
      : 'Crea un consumible para empezar.';
    consumableRoomGroups.appendChild(p);
    return;
  }

  keys.forEach((key) => {
    const group = document.createElement('div');
    group.className = 'consumable-room-group';

    const title = document.createElement('h3');
    title.className = 'consumable-room-title';
    title.textContent = key ? settingsLabel('shared-room', key) : 'Sin estancia';
    group.appendChild(title);

    const host = document.createElement('div');
    host.className = 'consumable-list';
    group.appendChild(host);

    consumableRoomGroups.appendChild(group);

    // Con la columna Ubicación: dentro de una estancia cada consumible puede
    // estar en una ubicación distinta. El orden es fijo, por ubicación y con el
    // de Ajustes, que es lo que tiene sentido al recorrer una estancia.
    renderConsumableHost(host, byRoom.get(key), {
      showCategory: true,
      // La estancia es el título de la tabla: en la columna diría lo mismo en
      // todas las filas.
      hiddenCols: ['usedIn', 'room'],
      sortState: CONSUMABLE_ROOM_SORT,
      sortableCols: [],
      reorderable: true,
    });
  });
}

function applyConsumableSort(arr, col, dir, opts = {}) {
  const storeOrder = settingsOrder('shared-store');
  const locationOrder = settingsOrder('shared-location');

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
    } else if (col === 'category') {
      // Por el orden de CONSUMABLE_CATEGORIES; los sin categoría, al final.
      const ai = CONSUMABLE_CATEGORIES.findIndex((c) => c.id === a.category);
      const bi = CONSUMABLE_CATEGORIES.findIndex((c) => c.id === b.category);
      cmp = (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    }
    // Empate (misma ubicación, mismo comercio...): alfabético, para que el
    // orden no dependa de cómo estén guardados los consumibles. Salvo en las
    // tablas que se reordenan a mano, donde el empate lo resuelve justamente
    // ese orden guardado (sort es estable).
    if (cmp === 0 && col !== 'name' && opts.tieBreakByName !== false) {
      return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
    }
    return dir === 'asc' ? cmp : -cmp;
  });
}

function renderConsumablesTable(host, raw, opts = {}) {
  // Las tablas de las áreas ya están filtradas por su categoría: la columna
  // diría lo mismo en todas las filas, así que solo sale en Compras y en las
  // tablas por estancia, que la piden con showCategory.
  const showCategory = opts.showCategory ?? (host === consumableList);

  const hiddenCols = new Set(opts.hiddenCols || []);
  const isVisibleCol = (key) => {
    if (hiddenCols.has(key)) return false;
    return key === 'category' ? showCategory : true;
  };

  // Las tablas de la vista por nombre y las de las áreas comparten la
  // ordenación que se elige pulsando sus cabeceras. Las de la vista por
  // estancia traen un orden fijo y no se pueden reordenar. Si la ordenación es
  // por una columna que aquí no se ve, se ordena por nombre y no por algo
  // invisible.
  const sortState = opts.sortState || _consumableSort;
  // Qué cabeceras se pueden pulsar. Sin la opción, las que COLS marque como
  // ordenables; con ella, solo las que liste, y con [] ninguna.
  const sortableCols = opts.sortableCols ? new Set(opts.sortableCols) : null;
  const canSortCol = (key, declared) =>
    declared && (!sortableCols || sortableCols.has(key));
  // Filas arrastrables: solo se mueven entre las de su misma ubicación.
  const reorderable = opts.reorderable === true;
  const sortCol = isVisibleCol(sortState.col) ? sortState.col : 'name';
  const sorted = applyConsumableSort(raw, sortCol, sortState.dir, {
    tieBreakByName: !reorderable,
  });

  const table = document.createElement('table');
  table.className = 'ingredient-table';

  const COLS = [
    { key: 'active',      label: 'Activo',          sortable: false },
    { key: 'name',        label: 'Nombre',          sortable: true  },
    { key: 'category',    label: 'Categoría',       sortable: true  },
    { key: 'minQuantity', label: 'Cantidad mínima', sortable: false },
    // La estancia no es un campo del consumible: sale de la ubicación que
    // tenga, según lo asignado en Ajustes.
    { key: 'room',        label: 'Estancia',        sortable: false },
    { key: 'location',    label: 'Ubicación',       sortable: true  },
    { key: 'expiryDate',  label: 'Caducidad',       sortable: false },
    { key: 'store',       label: 'Comercio',        sortable: true  },
    { key: 'product',     label: 'Producto',        sortable: false },
    { key: 'usedIn',      label: 'Usado en',        sortable: false },
  ].filter(({ key }) => isVisibleCol(key));

  const counts = mentionTaskCounts();

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  COLS.forEach(({ key, label, sortable }) => {
    const th = document.createElement('th');
    if (!canSortCol(key, sortable)) {
      th.textContent = label;
    } else {
      const isActive = sortState.col === key;
      const arrow = isActive ? (sortState.dir === 'asc' ? '↑' : '↓') : '';
      th.className = 'ingredient-th-sortable' + (isActive ? ' is-active' : '');
      th.innerHTML = `${label}<span class="sort-arrow">${arrow}</span>`;
      th.addEventListener('click', () => {
        if (sortState.col === key) {
          sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
        } else {
          sortState.col = key;
          sortState.dir = 'asc';
        }
        renderConsumables();
      });
    }
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  sorted.forEach((consumable) => {
    const tr = document.createElement('tr');
    tr.dataset.id = consumable.id;
    // El bloque del que la fila no puede salir al arrastrarla.
    tr.dataset.location = consumable.location || '';

    // Los consumibles creados antes de existir este campo no tienen `active`:
    // se consideran activos, sin tocar el registro guardado.
    const isActive = consumable.active !== false;
    tr.classList.toggle('is-inactive', !isActive);

    const activeTd = document.createElement('td');

    // El asa va en la celda del toggle, no en una columna propia: así no se
    // desplazan las columnas ni los estilos que van por posición.
    if (reorderable) {
      const handle = document.createElement('span');
      handle.className = 'consumable-drag-handle';
      handle.setAttribute('aria-hidden', 'true');
      handle.innerHTML = CONSUMABLE_GRIP_ICON;
      activeTd.appendChild(handle);
    }

    const switchLabel = document.createElement('label');
    switchLabel.className = 'row-switch';
    switchLabel.setAttribute('aria-label', `Activar ${consumable.name}`);
    const switchInput = document.createElement('input');
    switchInput.type = 'checkbox';
    switchInput.checked = isActive;
    switchInput.addEventListener('change', () => {
      toggleConsumableActive(consumable.id, switchInput.checked);
    });
    const switchTrack = document.createElement('span');
    switchTrack.className = 'row-switch-track';
    switchLabel.appendChild(switchInput);
    switchLabel.appendChild(switchTrack);
    activeTd.appendChild(switchLabel);
    tr.appendChild(activeTd);

    const nameTd = document.createElement('td');
    nameTd.textContent = consumable.name;
    tr.appendChild(nameTd);

    if (showCategory) {
      const categoryTd = document.createElement('td');
      // Píldora, como la categoría de Planificadas en App tareas. Sin
      // categoría, la celda se queda vacía en lugar de con una píldora hueca.
      const categoryLabel = consumableCategoryLabel(consumable.category);
      if (categoryLabel) {
        const chip = document.createElement('span');
        chip.className = 'consumable-cat-chip';
        chip.textContent = categoryLabel;
        categoryTd.appendChild(chip);
      }
      tr.appendChild(categoryTd);
    }

    const minQtyTd = document.createElement('td');
    minQtyTd.textContent = consumable.minQuantity || '';
    tr.appendChild(minQtyTd);

    if (isVisibleCol('room')) {
      const roomTd = document.createElement('td');
      roomTd.textContent = settingsLabel('shared-room', locationRoomKey(consumable.location));
      tr.appendChild(roomTd);
    }

    const locTd = document.createElement('td');
    locTd.textContent = settingsLabel('shared-location', consumable.location);
    tr.appendChild(locTd);

    // Caducidad: vacía si el consumible no tiene fecha
    const expiryTd = document.createElement('td');
    renderExpiryCell(expiryTd, consumable.expiryDate);
    tr.appendChild(expiryTd);

    const storeTd = document.createElement('td');
    storeTd.textContent = settingsLabel('shared-store', consumable.store);
    tr.appendChild(storeTd);

    const productTd = document.createElement('td');
    productTd.textContent = consumable.product || '';
    tr.appendChild(productTd);

    // Tareas que lo mencionan. Mismo formato que el recuento de Recetas.
    if (isVisibleCol('usedIn')) {
      const usedTd = document.createElement('td');
      usedTd.className = 'recipe-table-count';
      const used = counts.get(mentionId('consumible', consumable.id)) || 0;
      usedTd.textContent = used === 0 ? '-' : used === 1 ? '1 tarea' : `${used} tareas`;
      tr.appendChild(usedTd);
    }

    tr.style.cursor = 'pointer';
    tr.addEventListener('click', (e) => {
      // Ni el toggle ni el asa de arrastrar abren el panel de edición.
      if (e.target.closest('.row-switch')) return;
      if (e.target.closest('.consumable-drag-handle')) return;
      clearConsumableSelection();
      tr.classList.add('is-selected');
      moveConsumablePanelTo(host);
      startEditConsumable(consumable.id);
    });

    tbody.appendChild(tr);
  });

  if (reorderable) enableConsumableRowDrag(tbody);

  table.appendChild(tbody);
  host.appendChild(table);
}

// Mismo icono que las listas de Ajustes. Aquí va suelto porque SETTINGS_ICONS
// se declara más abajo en el archivo y la primera tabla se pinta antes.
const CONSUMABLE_GRIP_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><circle cx="6" cy="4" r="1.3"/><circle cx="10" cy="4" r="1.3"/><circle cx="6" cy="8" r="1.3"/><circle cx="10" cy="8" r="1.3"/><circle cx="6" cy="12" r="1.3"/><circle cx="10" cy="12" r="1.3"/></svg>';

// Reordenar filas arrastrándolas, como en las listas de Ajustes: eventos de
// puntero en lugar de la API de drag&drop, que en Safari de iOS no funciona.
// Cada ubicación es un bloque y la fila no sale del suyo.
function enableConsumableRowDrag(tbody) {
  let dragging = null;

  tbody.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.consumable-drag-handle');
    if (!handle) return;
    const tr = handle.closest('tr');
    if (!tr) return;

    e.preventDefault();
    dragging = tr;
    tr.classList.add('is-dragging');
    handle.setPointerCapture(e.pointerId);
  });

  tbody.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    e.preventDefault();

    // Solo las filas de la misma ubicación cuentan como hueco donde soltar.
    const peers = [...tbody.children].filter(
      (r) => r !== dragging && r.dataset.location === dragging.dataset.location
    );
    const before = peers.find((r) => {
      const box = r.getBoundingClientRect();
      return e.clientY < box.top + box.height / 2;
    });

    if (before) tbody.insertBefore(dragging, before);
    // Más abajo que todas las suyas: justo detrás de la última, sin colarse en
    // el bloque de la ubicación siguiente.
    else if (peers.length) tbody.insertBefore(dragging, peers[peers.length - 1].nextSibling);
  });

  const finishDrag = () => {
    if (!dragging) return;
    const location = dragging.dataset.location;
    dragging.classList.remove('is-dragging');
    dragging = null;

    const order = [...tbody.children]
      .filter((r) => r.dataset.location === location)
      .map((r) => r.dataset.id);
    reorderConsumablesWithinLocation(order);
  };

  tbody.addEventListener('pointerup', finishDrag);
  tbody.addEventListener('pointercancel', finishDrag);
}

// Coloca esos consumibles en las posiciones que ya ocupaban ellos mismos en
// `consumables`, en el nuevo orden: así solo cambia su orden relativo y el
// resto se queda donde estaba. Con la búsqueda puesta se reordenan solo los
// que se ven, que son los únicos que llegan en orderedIds.
function reorderConsumablesWithinLocation(orderedIds) {
  const ids = new Set(orderedIds);
  const slots = [];
  consumables.forEach((c, i) => { if (ids.has(String(c.id))) slots.push(i); });

  const byId = new Map(slots.map((i) => [String(consumables[i].id), consumables[i]]));
  const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  if (reordered.length !== slots.length) return;

  const changed = reordered.some((c, i) => c.id !== consumables[slots[i]].id);
  if (!changed) return;

  slots.forEach((slot, i) => { consumables[slot] = reordered[i]; });
  saveConsumables();
  renderConsumables();
}

function renderConsumablesList(host, sortedConsumables) {
  const ul = document.createElement('ul');
  sortedConsumables.forEach((consumable) => {
    const li = document.createElement('li');
    li.className = 'ingredient-row';
    li.dataset.id = consumable.id;

    li.innerHTML = `
      <div class="ingredient-row-content">
        <div class="ingredient-row-left">
          <span class="ingredient-row-name">${consumable.name}</span>
        </div>

        <span class="recipe-row-icon" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </div>
    `;

    li.addEventListener('click', () => {
      moveConsumablePanelTo(host);
      startEditConsumable(consumable.id);
    });

    ul.appendChild(li);
  });
  host.appendChild(ul);
}

function startEditConsumable(id) {
  const consumable = consumables.find((c) => c.id === id);
  if (!consumable) return;

  editingConsumableId = id;

  if (consumableModalTitle) {
    consumableModalTitle.textContent = 'Editar consumible';
  }

  consumableForm.reset();

  consumableNameInput.value = consumable.name;
  populateCategorySelect(consumableCategorySelect, consumable.category || '');
  if (consumableMinQuantityInput) consumableMinQuantityInput.value = consumable.minQuantity || '';
  populateSettingsSelect(consumableLocationSelect, 'shared-location', consumable.location || '', 'Selecciona una ubicación...');
  populateSettingsSelect(consumableStoreSelect, 'shared-store', consumable.store || '', 'Selecciona un comercio...');
  if (consumableProductInput) consumableProductInput.value = consumable.product || '';
  populateExpirySelects(consumableExpiryMonthSelect, consumableExpiryYearSelect, consumable.expiryDate);
  setRichTextValue(consumableCommentInput, consumable.comment);
  renderUsedInTareas('consumableUsedInTareas', mentionId('consumible', id));

  consumableForm.querySelector('button[type="submit"]').textContent = 'Guardar cambios';

  consumableEditPanel?.classList.add('is-editing');
  openConsumablePanel();
}

if (consumableForm) {
  consumableForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = consumableNameInput.value.trim();
    const store = consumableStoreSelect.value;

    if (!name || !store) return;

    if (editingConsumableId) {
      const consumable = consumables.find((c) => c.id === editingConsumableId);
      if (!consumable) return;

      consumable.name = name;
      consumable.category = consumableCategorySelect?.value || null;
      consumable.minQuantity = consumableMinQuantityInput?.value.trim() || null;
      consumable.location = consumableLocationSelect?.value || null;
      consumable.store = store || null;
      consumable.product = consumableProductInput?.value.trim() || null;
      consumable.expiryDate = expiryValue(consumableExpiryYearSelect?.value, consumableExpiryMonthSelect?.value);
      consumable.comment = getRichTextValue(consumableCommentInput);
    } else {
      consumables.push({
        id: Date.now(),
        name,
        category: consumableCategorySelect?.value || null,
        minQuantity: consumableMinQuantityInput?.value.trim() || null,
        location: consumableLocationSelect?.value || null,
        store: store || null,
        product: consumableProductInput?.value.trim() || null,
        expiryDate: expiryValue(consumableExpiryYearSelect?.value, consumableExpiryMonthSelect?.value),
        comment: getRichTextValue(consumableCommentInput),
        active: true,
      });
    }

    saveConsumables();
    renderConsumables();

    consumableForm.reset();
    populateExpirySelects(consumableExpiryMonthSelect, consumableExpiryYearSelect, null);
    // El comentario es un contenteditable: form.reset() no lo vacía.
    setRichTextValue(consumableCommentInput, '');
    consumableEditPanel?.classList.remove('is-editing');
    closeConsumablePanel();
    editingConsumableId = null;

    consumableForm
      .querySelector('button[type="submit"]')
      .textContent = 'Guardar consumible';
  });
}

function autoSaveConsumable() {
  if (!editingConsumableId) return;

  const consumable = consumables.find((c) => c.id === editingConsumableId);
  if (!consumable) return;

  const name = consumableNameInput.value.trim();
  const store = consumableStoreSelect.value;
  if (!name || !store) return;

  consumable.name = name;
  consumable.category = consumableCategorySelect?.value || null;
  consumable.minQuantity = consumableMinQuantityInput?.value.trim() || null;
  consumable.location = consumableLocationSelect?.value || null;
  consumable.store = store || null;
  consumable.product = consumableProductInput?.value.trim() || null;
  consumable.expiryDate = expiryValue(consumableExpiryYearSelect?.value, consumableExpiryMonthSelect?.value);
  consumable.comment = getRichTextValue(consumableCommentInput);

  saveConsumables();
  renderConsumables();
}

[
  consumableNameInput, consumableCategorySelect, consumableMinQuantityInput,
  consumableLocationSelect, consumableStoreSelect, consumableProductInput,
  consumableExpiryMonthSelect, consumableExpiryYearSelect,
].forEach((el) => {
  if (el) el.addEventListener('change', autoSaveConsumable);
});

function toggleConsumableActive(id, active) {
  const consumable = consumables.find((c) => c.id === id);
  if (!consumable) return;
  consumable.active = active;
  saveConsumables();
  renderConsumables();
}

function deleteConsumable(id) {
  consumables = consumables.filter((c) => c.id !== id);
  saveConsumables();
  renderConsumables();
}

// La copia se queda justo detrás del original: en la vista por estancia el
// orden dentro de una ubicación lo da el de `consumables`, así que así aparece
// pegada a él. Se abre en el panel para cambiarle lo que haga falta.
function duplicateConsumable(id) {
  const i = consumables.findIndex((c) => c.id === id);
  if (i === -1) return;

  const copy = {
    ...consumables[i],
    id: Date.now(),
    // Con el mismo nombre serían indistinguibles en las tablas, y las listas
    // de Compras agrupan los elementos por nombre.
    name: `${consumables[i].name} (copia)`,
  };
  consumables.splice(i + 1, 0, copy);

  saveConsumables();
  // Primero el panel, para que al repintar quede marcada la fila de la copia
  // y no la del original.
  startEditConsumable(copy.id);
  renderConsumables();
}

renderConsumables();

let _consumablesWasDesktop = window.innerWidth >= 768;
window.addEventListener('resize', () => {
  const isDesktopNow = window.innerWidth >= 768;
  if (isDesktopNow !== _consumablesWasDesktop) {
    _consumablesWasDesktop = isDesktopNow;
    renderConsumables();
  }
});

const consumableSearchWrapper = document.getElementById('consumableSearchWrapper');
const consumableSearchBtn = document.getElementById('consumableSearchBtn');
const consumableSearchInput = document.getElementById('consumableSearchInput');
const consumableSearchCloseBtn = document.getElementById('consumableSearchClose');

function closeConsumableSearch() {
  _consumableSearch = '';
  if (consumableSearchInput) consumableSearchInput.value = '';
  if (consumableSearchWrapper) consumableSearchWrapper.classList.remove('is-open');
  renderConsumables();
}

if (consumableSearchBtn && consumableSearchWrapper && consumableSearchInput) {
  consumableSearchBtn.addEventListener('click', () => {
    consumableSearchWrapper.classList.add('is-open');
    consumableSearchInput.focus();
  });

  consumableSearchInput.addEventListener('input', () => {
    _consumableSearch = consumableSearchInput.value;
    renderConsumables();
  });

  consumableSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeConsumableSearch();
  });
}

if (consumableSearchCloseBtn) {
  consumableSearchCloseBtn.addEventListener('click', closeConsumableSearch);
}

// -----------------------
// UTENSILIOS (Limpieza)
// -----------------------
// Lista propia de la sección Limpieza. Un utensilio es solo un nombre, así que
// la tabla tiene una columna y el panel, un campo: se crean desde el modal y se
// renombran en el panel, que guarda al salir del campo.
const utensilList = document.getElementById('utensilList');
const utensilEditPanel = document.getElementById('utensilEditPanel');
const utensilForm = document.getElementById('utensilForm');
const utensilNameInput = document.getElementById('utensilNameInput');

const newUtensilModal = document.getElementById('newUtensilModal');
const newUtensilForm = document.getElementById('newUtensilForm');
const newUtensilNameInput = document.getElementById('newUtensilNameInput');

function clearUtensilSelection() {
  utensilList?.querySelectorAll('.ingredient-table tr.is-selected')
    .forEach((r) => r.classList.remove('is-selected'));
}

function closeUtensilPanel() {
  utensilEditPanel?.classList.remove('is-open');
  utensilEditPanel?.classList.remove('is-editing');
  editingUtensilId = null;
  clearUtensilSelection();
}

document.getElementById('openUtensilModal')?.addEventListener('click', () => {
  newUtensilForm?.reset();
  openModal(newUtensilModal);
  newUtensilNameInput?.focus();
});

document.getElementById('closeNewUtensilModal')?.addEventListener('click', () => {
  closeModal(newUtensilModal);
});

newUtensilModal?.addEventListener('click', (e) => {
  if (e.target === newUtensilModal) closeModal(newUtensilModal);
});

newUtensilForm?.addEventListener('submit', (e) => {
  e.preventDefault();

  const name = newUtensilNameInput.value.trim();
  if (!name) return;

  utensils.push({ id: Date.now(), name });
  saveUtensils();
  renderUtensils();

  newUtensilForm.reset();
  closeModal(newUtensilModal);
});

document.getElementById('closeUtensilSheetBtn')?.addEventListener('click', closeUtensilPanel);

function renderUtensils() {
  if (!utensilList) return;

  utensilList.innerHTML = '';

  if (window.innerWidth >= 768) {
    renderUtensilsTable(utensilList, utensils);
  } else {
    const alphabetical = [...utensils].sort((a, b) =>
      a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
    );
    renderUtensilsList(utensilList, alphabetical);
  }

  // Repintar deshace la selección: la fila abierta en el panel sigue marcada.
  if (editingUtensilId) {
    utensilList.querySelector(`.ingredient-table tr[data-id="${editingUtensilId}"]`)
      ?.classList.add('is-selected');
  }
}

function renderUtensilsTable(host, raw) {
  const sorted = [...raw].sort((a, b) => {
    const cmp = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
    return _utensilSort.dir === 'asc' ? cmp : -cmp;
  });

  const counts = mentionTaskCounts();

  const table = document.createElement('table');
  table.className = 'ingredient-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const th = document.createElement('th');
  th.className = 'ingredient-th-sortable is-active';
  th.innerHTML = `Nombre<span class="sort-arrow">${_utensilSort.dir === 'asc' ? '↑' : '↓'}</span>`;
  th.addEventListener('click', () => {
    _utensilSort.dir = _utensilSort.dir === 'asc' ? 'desc' : 'asc';
    renderUtensils();
  });
  headerRow.appendChild(th);

  const thUsed = document.createElement('th');
  thUsed.textContent = 'Usado en';
  headerRow.appendChild(thUsed);

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  sorted.forEach((utensil) => {
    const tr = document.createElement('tr');
    tr.dataset.id = utensil.id;

    const nameTd = document.createElement('td');
    nameTd.textContent = utensil.name;
    tr.appendChild(nameTd);

    // Tareas que lo mencionan. Mismo formato que el recuento de Recetas.
    const usedTd = document.createElement('td');
    usedTd.className = 'recipe-table-count';
    const used = counts.get(mentionId('utensilio', utensil.id)) || 0;
    usedTd.textContent = used === 0 ? '-' : used === 1 ? '1 tarea' : `${used} tareas`;
    tr.appendChild(usedTd);

    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => {
      clearUtensilSelection();
      tr.classList.add('is-selected');
      startEditUtensil(utensil.id);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  host.appendChild(table);
}

function renderUtensilsList(host, sortedUtensils) {
  const ul = document.createElement('ul');
  sortedUtensils.forEach((utensil) => {
    const li = document.createElement('li');
    li.className = 'ingredient-row';
    li.dataset.id = utensil.id;

    li.innerHTML = `
      <div class="ingredient-row-content">
        <div class="ingredient-row-left">
          <span class="ingredient-row-name">${utensil.name}</span>
        </div>

        <span class="recipe-row-icon" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </div>
    `;

    li.addEventListener('click', () => startEditUtensil(utensil.id));

    ul.appendChild(li);
  });
  host.appendChild(ul);
}

function startEditUtensil(id) {
  const utensil = utensils.find((u) => u.id === id);
  if (!utensil) return;

  editingUtensilId = id;
  utensilNameInput.value = utensil.name;
  renderUsedInTareas('utensilUsedInTareas', mentionId('utensilio', id));

  utensilEditPanel?.classList.add('is-editing');
  utensilEditPanel?.classList.add('is-open');
}

function autoSaveUtensil() {
  if (!editingUtensilId) return;

  const utensil = utensils.find((u) => u.id === editingUtensilId);
  if (!utensil) return;

  const name = utensilNameInput.value.trim();
  if (!name || name === utensil.name) return;

  utensil.name = name;
  saveUtensils();
  renderUtensils();
}

utensilNameInput?.addEventListener('change', autoSaveUtensil);

// El panel no tiene botón de guardar: Enter en el campo guarda y lo cierra.
utensilForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  autoSaveUtensil();
  closeUtensilPanel();
});

const utensilEditDropdown = document.getElementById('utensilEditDropdown');

document.getElementById('utensilEditMenuBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  utensilEditDropdown.hidden = !utensilEditDropdown.hidden;
});

document.addEventListener('click', () => {
  if (utensilEditDropdown && !utensilEditDropdown.hidden) {
    utensilEditDropdown.hidden = true;
  }
});

document.getElementById('utensilEditDeleteBtn')?.addEventListener('click', () => {
  utensilEditDropdown.hidden = true;
  if (!editingUtensilId) return;

  const utensil = utensils.find((u) => u.id === editingUtensilId);
  if (!utensil) return;
  if (!confirm(`¿Seguro que quieres eliminar "${utensil.name}"?`)) return;

  const id = editingUtensilId;
  closeUtensilPanel();
  utensils = utensils.filter((u) => u.id !== id);
  saveUtensils();
  renderUtensils();
});

renderUtensils();

let _utensilsWasDesktop = window.innerWidth >= 768;
window.addEventListener('resize', () => {
  const isDesktopNow = window.innerWidth >= 768;
  if (isDesktopNow !== _utensilsWasDesktop) {
    _utensilsWasDesktop = isDesktopNow;
    renderUtensils();
  }
});

// -----------------------
// AJUSTES: UBICACIONES Y COMERCIOS (interfaz del modal)
// -----------------------
function refreshIngredientSelects() {
  populateSettingsSelect(locationSelect, 'shared-location', undefined, 'Selecciona una ubicación...');
  populateSettingsSelect(storeSelect, 'shared-store', undefined, 'Selecciona un comercio...');
  populateSettingsSelect(newLocationSelect, 'shared-location', undefined, 'Selecciona una ubicación...');
  populateSettingsSelect(newStoreSelect, 'shared-store', undefined, 'Selecciona un comercio...');
}

function refreshConsumableSelects() {
  populateCategorySelect(consumableCategorySelect);
  populateCategorySelect(newConsumableCategorySelect);
  populateSettingsSelect(consumableLocationSelect, 'shared-location', undefined, 'Selecciona una ubicación...');
  populateSettingsSelect(consumableStoreSelect, 'shared-store', undefined, 'Selecciona un comercio...');
  populateSettingsSelect(newConsumableLocationSelect, 'shared-location', undefined, 'Selecciona una ubicación...');
  populateSettingsSelect(newConsumableStoreSelect, 'shared-store', undefined, 'Selecciona un comercio...');
}


function makeSettingsIconBtn({ className, label, svg }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `settings-row-btn ${className}`;
  btn.setAttribute('aria-label', label);
  btn.innerHTML = svg;
  return btn;
}

const SETTINGS_ICONS = {
  grip: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><circle cx="6" cy="4" r="1.3"/><circle cx="10" cy="4" r="1.3"/><circle cx="6" cy="8" r="1.3"/><circle cx="10" cy="8" r="1.3"/><circle cx="6" cy="12" r="1.3"/><circle cx="10" cy="12" r="1.3"/></svg>',
  edit: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.333 2a1.885 1.885 0 0 1 2.667 2.667L4.889 13.778 2 14l.222-2.889L11.333 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  delete: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4h12M6 4V2.667A.667.667 0 0 1 6.667 2h2.666a.667.667 0 0 1 .667.667V4m2 0v9.333a.667.667 0 0 1-.667.667H4.667A.667.667 0 0 1 4 13.333V4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  confirm: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 8.5L6.5 12L13 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function commitSettingsEdit(listKey, id, rawName) {
  const cfg = SETTINGS_LISTS[listKey];
  const items = cfg.getItems() || [];
  const item = items.find((it) => it.id === id);
  if (!item) return;

  const name = rawName.trim();

  if (!name) {
    // Nombre vacío: si era una entrada recién creada, se descarta.
    if (!item.name) {
      cfg.setItems(items.filter((it) => it.id !== id));
      saveSettingsList(listKey);
      cfg.onChange();
    }
    _settingsEditing = null;
    renderSettings();
    return;
  }

  item.name = name;
  // La clave interna solo se genera la primera vez. Renombrar nunca la cambia,
  // para que los registros que ya la usan sigan apuntando a esta entrada.
  if (!item.value) item.value = slugifySettingValue(name) || String(id);

  saveSettingsList(listKey);
  cfg.onChange();
  _settingsEditing = null;
  renderSettings();
}

// Una lista con `sections` se pinta repartida en secciones (Ubicaciones, una
// por estancia); el resto, como una sola lista.
function renderSettingsList(listKey) {
  const cfg = SETTINGS_LISTS[listKey];
  if (cfg.sections) {
    renderSettingsSections(listKey);
    return;
  }

  const listEl = document.getElementById(cfg.listElId);
  if (!listEl) return;

  // Los listeners viven en la propia <ul>, que sobrevive a cada repintado:
  // engancharlos una sola vez evita duplicarlos.
  if (!listEl.dataset.dragReady) {
    enableSettingsDrag(listEl, listKey);
    listEl.dataset.dragReady = '1';
  }

  const items = cfg.getItems() || [];
  listEl.innerHTML = '';

  if (items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'settings-empty';
    empty.textContent = `No hay ${cfg.plural} todavía.`;
    listEl.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    listEl.appendChild(buildSettingsRow(listKey, item));
  });
}

// Las secciones son las entradas de otra lista de Ajustes (las estancias), en
// su orden configurado, más una última para las entradas sin asignar. Una
// estancia sin ubicaciones también sale: es donde se crean las suyas.
function renderSettingsSections(listKey) {
  const cfg = SETTINGS_LISTS[listKey];
  const { listKey: fromList, field, emptyTitle } = cfg.sections;
  const container = document.getElementById(cfg.sectionsElId);
  if (!container) return;

  // Los listeners viven en el contenedor, que sobrevive a cada repintado.
  if (!container.dataset.dragReady) {
    enableSettingsSectionsDrag(container, listKey);
    container.dataset.dragReady = '1';
  }

  const items = cfg.getItems() || [];
  container.innerHTML = '';

  // settingsOptions añade las estancias que ya no estén en la lista pero que
  // alguna ubicación siga teniendo asignadas: así no desaparece ninguna fila.
  const sections = settingsOptions(fromList, items.map((it) => it[field]))
    .map(({ value, label }) => ({ value, title: label }));
  sections.push({ value: '', title: emptyTitle });

  sections.forEach(({ value, title }) => {
    const section = document.createElement('div');
    section.className = 'settings-section';
    section.dataset.room = value;

    const titleEl = document.createElement('span');
    titleEl.className = 'settings-section-title';
    titleEl.textContent = title;
    section.appendChild(titleEl);

    const listEl = document.createElement('ul');
    listEl.className = 'settings-list';
    listEl.dataset.room = value;

    const rows = items.filter((it) => (it[field] || '') === value);
    if (rows.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'settings-empty';
      empty.textContent = `No hay ${cfg.plural} en esta sección.`;
      listEl.appendChild(empty);
    } else {
      rows.forEach((item) => listEl.appendChild(buildSettingsRow(listKey, item)));
    }
    section.appendChild(listEl);

    // Crear dentro de la sección deja la nueva entrada ya en esa estancia.
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'settings-add-btn';
    addBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 3.5V12.5M3.5 8H12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <span>Añadir ${cfg.noun}</span>
    `;
    addBtn.addEventListener('click', () => addSettingsItem(listKey, { [field]: value }));
    section.appendChild(addBtn);

    container.appendChild(section);
  });
}

function buildSettingsRow(listKey, item) {
  const cfg = SETTINGS_LISTS[listKey];

  const li = document.createElement('li');
  li.className = 'settings-row';
  li.dataset.id = item.id;

  const isEditing = _settingsEditing
    && _settingsEditing.listKey === listKey
    && _settingsEditing.id === item.id;

  const actions = document.createElement('div');
  actions.className = 'settings-row-actions';

  if (isEditing) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'settings-row-input';
    input.value = item.name || '';
    input.placeholder = cfg.placeholder;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        input.dataset.cancelled = 'true';
        commitSettingsEdit(listKey, item.id, item.name || '');
      }
    });
    input.addEventListener('blur', () => {
      if (input.dataset.cancelled === 'true') return;
      commitSettingsEdit(listKey, item.id, input.value);
    });
    li.appendChild(input);

    const confirmBtn = makeSettingsIconBtn({
      className: 'settings-row-btn--confirm',
      label: 'Guardar',
      svg: SETTINGS_ICONS.confirm,
    });
    // mousedown en lugar de click: el blur del input llega antes que el
    // click y volvería a pintar la lista, perdiendo el botón.
    confirmBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      commitSettingsEdit(listKey, item.id, input.value);
    });
    actions.appendChild(confirmBtn);
    li.appendChild(actions);

    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
    return li;
  }

  const handle = document.createElement('span');
  handle.className = 'settings-row-handle';
  handle.setAttribute('aria-hidden', 'true');
  handle.innerHTML = SETTINGS_ICONS.grip;
  li.appendChild(handle);

  const nameEl = document.createElement('span');
  nameEl.className = 'settings-row-name';
  nameEl.textContent = item.name;
  li.appendChild(nameEl);

  // Cuántos registros usan esta entrada ahora mismo.
  if (cfg.showUsage) {
    const used = cfg.usageCount(item.value);
    const countEl = document.createElement('span');
    countEl.className = 'settings-row-count' + (used > 0 ? ' is-used' : '');
    countEl.textContent = used;
    countEl.title = `${used} ${settingsUsageWord(cfg, used)}`;
    li.appendChild(countEl);
  }

  const editBtn = makeSettingsIconBtn({
    className: 'settings-row-btn--edit',
    label: `Editar ${cfg.noun}`,
    svg: SETTINGS_ICONS.edit,
  });
  editBtn.addEventListener('click', () => {
    _settingsEditing = { listKey, id: item.id };
    renderSettings();
  });

  const deleteBtn = makeSettingsIconBtn({
    className: 'settings-row-btn--delete',
    label: `Eliminar ${cfg.noun}`,
    svg: SETTINGS_ICONS.delete,
  });
  deleteBtn.addEventListener('click', () => {
    // Avisar si la entrada está en uso: los registros no se tocan, pero
    // conviene saber que se quedarán apuntando a algo que ya no está en la lista.
    const used = cfg.usageCount(item.value);
    const warning = used === 0
      ? ''
      : cfg.deleteWarning
        ? cfg.deleteWarning(used)
        : `\n\nHay ${used} ${settingsUsageWord(cfg, used)} usando esta ${cfg.noun}. No se borrarán ni perderán el dato, pero dejará de aparecer en la lista.`;
    if (!confirm(`¿Seguro que quieres eliminar "${item.name}"?${warning}`)) return;
    cfg.setItems((cfg.getItems() || []).filter((it) => it.id !== item.id));
    saveSettingsList(listKey);
    cfg.onDelete?.(item.value);
    cfg.onChange();
    renderSettings();
  });

  [editBtn, deleteBtn].forEach((b) => actions.appendChild(b));
  li.appendChild(actions);

  return li;
}

// Plural del nombre que usan el contador y el aviso al borrar.
function settingsUsageWord(cfg, count) {
  if (count === 1) return cfg.usageNoun;
  return cfg.usagePlural || `${cfg.usageNoun}s`;
}

// Aplica el orden que haya quedado en el DOM tras arrastrar.
function reorderSettingsItems(listKey, orderedIds) {
  const cfg = SETTINGS_LISTS[listKey];
  const items = cfg.getItems() || [];
  const byId = new Map(items.map((it) => [String(it.id), it]));

  const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  if (reordered.length !== items.length) return;

  const changed = reordered.some((it, i) => it.id !== items[i].id);
  if (!changed) return;

  cfg.setItems(reordered);
  saveSettingsList(listKey);
  cfg.onChange();
  renderSettings();
}

// Arrastre con eventos de puntero en lugar de la API de drag&drop de HTML5,
// que en Safari de iOS no funciona: así se puede reordenar también desde el
// móvil. Se mueve el <li> por el DOM mientras se arrastra y al soltar se
// vuelca ese orden a los datos.
function enableSettingsDrag(listEl, listKey) {
  let dragging = null;

  listEl.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.settings-row-handle');
    // Si hay una fila en edición, su input tiene el foco: no se arrastra.
    if (!handle || _settingsEditing) return;
    const li = handle.closest('.settings-row');
    if (!li) return;

    e.preventDefault();
    dragging = li;
    li.classList.add('is-dragging');
    handle.setPointerCapture(e.pointerId);
  });

  listEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    e.preventDefault();

    const others = [...listEl.querySelectorAll('.settings-row')].filter((r) => r !== dragging);
    const before = others.find((r) => {
      const box = r.getBoundingClientRect();
      return e.clientY < box.top + box.height / 2;
    });

    if (before) listEl.insertBefore(dragging, before);
    else listEl.appendChild(dragging);
  });

  const finishDrag = () => {
    if (!dragging) return;
    dragging.classList.remove('is-dragging');
    dragging = null;
    const order = [...listEl.querySelectorAll('.settings-row')].map((r) => r.dataset.id);
    reorderSettingsItems(listKey, order);
  };

  listEl.addEventListener('pointerup', finishDrag);
  listEl.addEventListener('pointercancel', finishDrag);
}

// Misma idea que enableSettingsDrag, pero sobre el contenedor de secciones: la
// fila puede soltarse en cualquiera de ellas y al hacerlo se queda con la
// estancia de la sección en la que cae.
function enableSettingsSectionsDrag(container, listKey) {
  const field = SETTINGS_LISTS[listKey].sections.field;
  let dragging = null;

  container.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.settings-row-handle');
    // Si hay una fila en edición, su input tiene el foco: no se arrastra.
    if (!handle || _settingsEditing) return;
    const li = handle.closest('.settings-row');
    if (!li) return;

    e.preventDefault();
    dragging = li;
    li.classList.add('is-dragging');
    handle.setPointerCapture(e.pointerId);
  });

  container.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    e.preventDefault();

    // La sección de destino se decide por el alto de la sección entera, no por
    // el de su lista: así una sección vacía también es fácil de acertar.
    const sections = [...container.querySelectorAll('.settings-section')];
    let target = sections.find((s) => {
      const box = s.getBoundingClientRect();
      return e.clientY >= box.top && e.clientY <= box.bottom;
    });
    // En el hueco entre dos secciones (o fuera de todas), la más cercana.
    if (!target) {
      let best = null;
      sections.forEach((s) => {
        const box = s.getBoundingClientRect();
        const d = Math.min(Math.abs(e.clientY - box.top), Math.abs(e.clientY - box.bottom));
        if (!best || d < best.d) best = { s, d };
      });
      target = best?.s;
    }

    const listEl = target?.querySelector('.settings-list');
    if (!listEl) return;

    const others = [...listEl.querySelectorAll('.settings-row')].filter((r) => r !== dragging);
    const before = others.find((r) => {
      const box = r.getBoundingClientRect();
      return e.clientY < box.top + box.height / 2;
    });

    if (before) listEl.insertBefore(dragging, before);
    else listEl.appendChild(dragging);
  });

  const finishDrag = () => {
    if (!dragging) return;
    dragging.classList.remove('is-dragging');
    dragging = null;

    const placed = [];
    container.querySelectorAll('.settings-list').forEach((listEl) => {
      listEl.querySelectorAll('.settings-row').forEach((r) => {
        placed.push({ id: r.dataset.id, section: listEl.dataset.room || '' });
      });
    });
    applySettingsSectionOrder(listKey, field, placed);
  };

  container.addEventListener('pointerup', finishDrag);
  container.addEventListener('pointercancel', finishDrag);
}

// Vuelca a los datos el orden y las secciones que hayan quedado en el DOM.
function applySettingsSectionOrder(listKey, field, placed) {
  const cfg = SETTINGS_LISTS[listKey];
  const items = cfg.getItems() || [];
  const byId = new Map(items.map((it) => [String(it.id), it]));

  const reordered = placed.map((p) => byId.get(p.id)).filter(Boolean);
  if (reordered.length !== items.length) return;

  const changed = reordered.some((it, i) =>
    it.id !== items[i].id || (it[field] || '') !== placed[i].section);
  if (!changed) return;

  reordered.forEach((it, i) => { it[field] = placed[i].section; });

  cfg.setItems(reordered);
  saveSettingsList(listKey);
  cfg.onChange();
  renderSettings();
}

// `extra` lleva los campos que ya vienen dados por dónde se crea: al añadir
// desde una sección, su estancia.
function addSettingsItem(listKey, extra = {}) {
  const cfg = SETTINGS_LISTS[listKey];
  const items = [...(cfg.getItems() || [])];
  const id = Date.now();
  items.push({ id, value: '', name: '', ...extra });
  cfg.setItems(items);
  _settingsEditing = { listKey, id };
  renderSettings();
}

function renderSettings() {
  ensureSettingsSeed();
  Object.keys(SETTINGS_LISTS).forEach(renderSettingsList);
}

// Ajustes de la aplicación (botón inferior de la barra de navegación).
// De momento el modal no tiene contenido: solo abre y cierra.
const appSettingsModal = document.getElementById('appSettingsModal');

const appSettingsEmail = document.getElementById('appSettingsEmail');

function renderAppSettingsSession() {
  if (appSettingsEmail) appSettingsEmail.textContent = auth.currentUser?.email || '—';
}

let _appSettingsTab = 'stores';

// La pestaña marcada se deduce del estado y se recalcula en cada pintado, para
// que siempre haya exactamente una activa.
function syncAppSettingsTabs() {
  const btns = document.querySelectorAll('#appSettingsNav .app-settings-nav-btn');
  if (!btns.length) return;

  const known = [...btns].some((b) => b.dataset.appSettingsTab === _appSettingsTab);
  if (!known) _appSettingsTab = 'stores';

  btns.forEach((b) => b.classList.toggle('active', b.dataset.appSettingsTab === _appSettingsTab));
  document.querySelectorAll('#appSettingsModal .app-settings-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.appSettingsPanel === _appSettingsTab);
  });
}

document.querySelectorAll('#appSettingsNav .app-settings-nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    _appSettingsTab = btn.dataset.appSettingsTab;
    syncAppSettingsTabs();
  });
});

document.getElementById('addAppSettingsStore')?.addEventListener('click', () => addSettingsItem('shared-store'));
document.getElementById('addAppSettingsRoom')?.addEventListener('click', () => addSettingsItem('shared-room'));
// Ubicaciones no tiene un botón fijo: cada sección pinta el suyo.

// Hay un botón de ajustes en la barra de cada sección del rail.
document.querySelectorAll('.nav-settings-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    _settingsEditing = null;
    _appSettingsTab = 'stores';
    syncAppSettingsTabs();
    renderSettings();
    renderAppSettingsSession();
    openModal(appSettingsModal);
  });
});

document.getElementById('closeAppSettingsModal')?.addEventListener('click', () => {
  closeModal(appSettingsModal);
});

appSettingsModal?.addEventListener('click', (e) => {
  if (e.target === appSettingsModal) closeModal(appSettingsModal);
});

ensureSettingsSeed();
refreshIngredientSelects();
refreshConsumableSelects();

// -----------------------
// EDITOR DE TEXTO CON FORMATO (.rich-text)
// -----------------------

// Solo se guarda el marcado que produce la barra de herramientas. Lo que se
// pega se inserta como texto plano, y al cargar se filtra de nuevo: así nunca
// se vuelca HTML arbitrario en el editor.
const RICH_TEXT_TAGS = ['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'BR', 'P', 'DIV'];

function sanitizeRichText(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const root = doc.body.firstElementChild;

  root.querySelectorAll('*').forEach((el) => {
    if (!RICH_TEXT_TAGS.includes(el.tagName)) {
      el.replaceWith(...el.childNodes);
      return;
    }
    [...el.attributes].forEach((attr) => el.removeAttribute(attr.name));
  });

  return root.innerHTML;
}

function getRichTextValue(editor) {
  if (!editor) return '';
  // Un editor vacío deja restos como `<br>` o `<div><br></div>`: se guarda
  // cadena vacía para que el placeholder vuelva a aparecer.
  if (!editor.textContent.trim() && !editor.querySelector('li')) return '';
  return sanitizeRichText(editor.innerHTML);
}

function setRichTextValue(editor, html) {
  if (!editor) return;
  editor.innerHTML = sanitizeRichText(html);
}

// Botones de la barra de herramientas. La barra la monta el componente para que
// todos los editores sean iguales y el HTML de cada campo quede en dos líneas.
const RICH_TEXT_COMMANDS = [
  {
    command: 'bold',
    label: 'Negrita',
    icon: `<path d="M5.83337 10H11.25C12.6307 10 13.75 8.88071 13.75 7.5C13.75 6.11929 12.6307 5 11.25 5H5.83337V10Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
           <path d="M5.83337 10H11.875C13.2557 10 14.375 11.1193 14.375 12.5C14.375 13.8807 13.2557 15 11.875 15H5.83337V10Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    command: 'italic',
    label: 'Cursiva',
    icon: `<path d="M12.5 4.16675H7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
           <path d="M11.6667 15.8333H6.66675" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
           <path d="M10.8333 4.16675L8.33325 15.8334" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  { divider: true },
  {
    command: 'insertUnorderedList',
    label: 'Lista con viñetas',
    icon: `<path d="M7.5 5H16.6667" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
           <path d="M7.5 10H16.6667" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
           <path d="M7.5 15H16.6667" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
           <circle cx="4.16667" cy="5" r="1.04167" fill="currentColor"/>
           <circle cx="4.16667" cy="10" r="1.04167" fill="currentColor"/>
           <circle cx="4.16667" cy="15" r="1.04167" fill="currentColor"/>`,
  },
  {
    command: 'insertOrderedList',
    label: 'Lista numerada',
    icon: `<path d="M8.33337 5H16.6667" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
           <path d="M8.33337 10H16.6667" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
           <path d="M8.33337 15H16.6667" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
           <path d="M3.33337 3.75L4.58337 3.33334V6.25" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
           <path d="M3.33337 8.75C3.33337 8.33334 3.75004 8.125 4.16671 8.125C4.79171 8.125 5.00004 8.54167 5.00004 8.95834C5.00004 9.58334 3.33337 10.2083 3.33337 11.4583H5.00004" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
           <path d="M3.33337 13.5417H5.00004L3.95837 14.7917C4.58337 14.7917 5.20837 15 5.20837 15.8333C5.20837 16.4583 4.68754 16.6667 4.16671 16.6667C3.75004 16.6667 3.43754 16.5208 3.33337 16.25" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
];

function buildRichTextToolbar(root, editor) {
  const toolbar = document.createElement('div');
  toolbar.className = 'rich-text-toolbar';

  RICH_TEXT_COMMANDS.forEach((item) => {
    if (item.divider) {
      const divider = document.createElement('span');
      divider.className = 'rich-text-divider';
      toolbar.appendChild(divider);
      return;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rich-text-btn';
    btn.dataset.command = item.command;
    btn.setAttribute('aria-label', item.label);
    btn.title = item.label;
    btn.innerHTML =
      `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">${item.icon}</svg>`;
    toolbar.appendChild(btn);
  });

  root.insertBefore(toolbar, editor);
  return toolbar;
}

function initRichText(root, onChange) {
  const editor = root?.querySelector('.rich-text-editor');
  if (!editor) return;

  const toolbar = root.querySelector('.rich-text-toolbar') || buildRichTextToolbar(root, editor);
  const buttons = toolbar.querySelectorAll('.rich-text-btn');

  function syncButtons() {
    buttons.forEach((btn) => {
      let active = false;
      try { active = document.queryCommandState(btn.dataset.command); } catch { active = false; }
      btn.classList.toggle('is-active', active);
    });
  }

  buttons.forEach((btn) => {
    // En mousedown se evita que el botón robe el foco: sin selección activa
    // el comando no se aplicaría a nada.
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      editor.focus();
      document.execCommand(btn.dataset.command, false, null);
      syncButtons();
      onChange?.();
    });
  });

  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') || '';
    document.execCommand('insertText', false, text);
  });

  editor.addEventListener('keyup', syncButtons);
  editor.addEventListener('mouseup', syncButtons);
  editor.addEventListener('focus', syncButtons);
  editor.addEventListener('blur', () => {
    buttons.forEach((btn) => btn.classList.remove('is-active'));
    onChange?.();
  });
}

// Los comentarios de Ingredientes y Consumibles. Se arrancan aquí y no junto a
// sus formularios, que están más arriba en el archivo, porque el componente
// necesita RICH_TEXT_COMMANDS y aún no estaría definido. Guardan al salir del
// editor y al pulsar un botón de formato.
initRichText(ingredientCommentInput?.closest('.rich-text'), () => autoSaveIngredient());
initRichText(consumableCommentInput?.closest('.rich-text'), () => autoSaveConsumable());

// -----------------------
// COCINADOS
// -----------------------
const recipeForm = document.getElementById('recipeForm');
const recipeNameInput = document.getElementById('recipeNameInput');
const recipeList = document.getElementById('recipeList');
const ingredientSelectors = document.getElementById('ingredientSelectors');
const addIngredientBtn = document.getElementById('addIngredientToRecipe');
const recipeServingsInput = document.getElementById('recipeServingsInput');

// Campos de texto con formato de la sección 'Cocinado'. `key` es la propiedad
// de la receta: 'diaAnterior' se mantiene aunque el campo se llame ahora
// 'Noche del día anterior', para no perder lo ya escrito.
const RECIPE_TEXT_FIELDS = [
  { key: 'diaAnterior',    id: 'recipeNocheAnteriorInput' },
  { key: 'mismaManana',    id: 'recipeMismaMananaInput' },
  { key: 'momentoIngesta', id: 'recipeMomentoIngestaInput' },
].map((field) => ({ ...field, el: document.getElementById(field.id) }));

// Las raciones se guardan como número entero; el campo vacío o con un valor no
// válido deja la receta sin raciones en lugar de guardar NaN.
function getServingsValue(input) {
  const raw = input?.value.trim();
  if (!raw) return null;
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function setServingsValue(input, value) {
  if (!input) return;
  input.value = (value === null || value === undefined) ? '' : value;
}

// Deja en el campo el mismo valor que se va a guardar: si se escribe 2,5 o un
// número no válido, el campo no se queda mostrando algo distinto de la receta.
function normalizeServingsInput(input) {
  setServingsValue(input, getServingsValue(input));
}

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

closeRecipeSheetBtn?.addEventListener('click', () => {
  closeRecipePanel();
});

// -----------------------
// MODAL NUEVA RECETA
// -----------------------
const newRecipeModal = document.getElementById('newRecipeModal');
const newRecipeForm = document.getElementById('newRecipeForm');
const newRecipeIngredientSelectors = document.getElementById('newRecipeIngredientSelectors');
const newRecipeAddIngredientBtn = document.getElementById('newRecipeAddIngredient');

if (openRecipeModalBtn) {
  openRecipeModalBtn.addEventListener('click', () => {
    if (newRecipeForm) newRecipeForm.reset();
    if (newRecipeIngredientSelectors) newRecipeIngredientSelectors.innerHTML = '';
    openModal(newRecipeModal);
  });
}

document.getElementById('closeNewRecipeModal')?.addEventListener('click', () => {
  closeModal(newRecipeModal);
});

newRecipeModal?.addEventListener('click', (e) => {
  if (e.target === newRecipeModal) closeModal(newRecipeModal);
});

function addNewRecipeIngredientRow() {
  if (!newRecipeIngredientSelectors) return;
  if (ingredients.length === 0) {
    alert('Añade primero algún ingrediente');
    return;
  }

  const div = document.createElement('div');
  div.className = 'recipe-ingredient-row';

  const selectWrapper = document.createElement('div');
  selectWrapper.className = 'select-field';

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

  selectWrapper.appendChild(select);

  const formatoWrapper = document.createElement('div');
  formatoWrapper.className = 'formato-wrapper';

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'number-input';
  input.placeholder = 'Cantidad';
  input.min = '1';

  const unitSpan = document.createElement('span');
  unitSpan.className = 'formato-unit';
  unitSpan.textContent = '-';

  select.addEventListener('change', () => {
    const ing = ingredients.find(i => i.id === Number(select.value));
    unitSpan.textContent = ing?.unit ?? '-';
  });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'recipe-ingredient-remove-btn';
  removeBtn.setAttribute('aria-label', 'Eliminar ingrediente de la receta');
  removeBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 5L5 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M5 5L15 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  removeBtn.addEventListener('click', () => div.remove());

  formatoWrapper.appendChild(input);
  formatoWrapper.appendChild(unitSpan);
  div.appendChild(selectWrapper);
  div.appendChild(formatoWrapper);
  div.appendChild(removeBtn);
  newRecipeIngredientSelectors.appendChild(div);
}

if (newRecipeAddIngredientBtn) {
  newRecipeAddIngredientBtn.addEventListener('click', addNewRecipeIngredientRow);
}

if (newRecipeForm) {
  newRecipeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('newRecipeNameInput');
    const name = nameInput?.value.trim();
    if (!name) {
      alert('Rellena el nombre de la receta');
      return;
    }

    const recipeIngredients = [];
    newRecipeIngredientSelectors?.querySelectorAll('.recipe-ingredient-row').forEach(row => {
      const select = row.querySelector('select');
      const input = row.querySelector('input');
      if (!select || !input) return;
      if (select.value && input.value) {
        recipeIngredients.push({
          ingredientId: Number(select.value),
          quantity: Number(input.value),
        });
      }
    });

    recipes.push({ id: Date.now(), name, ingredients: recipeIngredients });
    saveRecipes();
    renderRecipes();
    closeModal(newRecipeModal);
  });
}



// -----------------------
// MODAL / PANEL CALENDARIO
// -----------------------
const openCalendarModalBtn = document.getElementById('openCalendarModal');
const calendarModal = document.getElementById('calendarModal');
const closeCalendarModalBtn = document.getElementById('closeCalendarModal');
const calendarEditPanel = document.getElementById('calendarEditPanel');
const closeCalendarEditPanelBtn = document.getElementById('closeCalendarEditPanel');

function openModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.remove('hidden');
  void modalEl.offsetWidth;
  modalEl.classList.add('is-open');
}

function closeModal(modalEl) {
  if (!modalEl) return;
  const content = modalEl.querySelector('.modal-content');
  modalEl.classList.remove('is-open');
  const fallback = setTimeout(() => { modalEl.classList.add('hidden'); }, 350);
  const onEnd = (e) => {
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

// Referencias al formulario del panel de edición
const calendarEditForm = document.getElementById('calendarEditForm');
const calendarEditDateInput = document.getElementById('calendarEditDate');
const calendarEditDateWrapper = calendarEditDateInput ? calendarEditDateInput.closest('.date-picker') : null;
const calendarEditRecipeSelect = document.getElementById('calendarEditRecipe');
const calendarEditRepeatSelect = document.getElementById('calendarEditRepeat');
const calendarEditMealSelect = document.getElementById('calendarEditMeal');
const editWeekdayPicker = document.getElementById('editWeekdayPicker');

const calendarSubmitBtn = document.getElementById('calendarSubmitBtn');
const deleteCalendarEntryBtn = document.getElementById('deleteCalendarEntryBtn');
const calendarEditDropdown = document.getElementById('calendarEditDropdown');
const deleteCalendarConfirmModal = document.getElementById('deleteCalendarConfirmModal');
const confirmDeleteOccurrenceBtn = document.getElementById('confirmDeleteOccurrenceBtn');
const confirmDeleteAllBtn = document.getElementById('confirmDeleteAllBtn');
const confirmDeleteCancelBtn = document.getElementById('confirmDeleteCancelBtn');
let _calendarEditingEntry = null;

// Panel de detalle (solo lectura, móvil)
const calendarDetailPanel      = document.getElementById('calendarDetailPanel');
const calendarDetailTitle      = document.getElementById('calendarDetailTitle');
const calendarDetailIngredients = document.getElementById('calendarDetailIngredients');
const calendarDetailDropdown   = document.getElementById('calendarDetailDropdown');
let _viewingCalendarEntry = null;

// Panel de edición: abrir / cerrar
const planningSection = document.getElementById('planning');

function openCalendarPanel() {
  calendarEditPanel?.classList.add('is-open');
  planningSection?.classList.add('panel-open');
}

function closeCalendarPanel() {
  calendarEditPanel?.classList.remove('is-open');
  if (calendarEditDropdown) calendarEditDropdown.hidden = true;
  if (calendarDetailPanel?.classList.contains('is-open') && _viewingCalendarEntry) {
    // Vinimos desde el panel de detalle — refrescar y volver a él
    openCalendarDetailPanel(_viewingCalendarEntry);
  } else {
    planningSection?.classList.remove('panel-open');
  }
}

// Panel de detalle: abrir / cerrar
const BOX_ICON_SVG = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17.5 13.3334V6.66675C17.4997 6.37448 17.4225 6.08742 17.2763 5.83438C17.13 5.58134 16.9198 5.37122 16.6667 5.22508L10.8333 1.89175C10.58 1.74547 10.2926 1.66846 10 1.66846C9.70744 1.66846 9.42003 1.74547 9.16667 1.89175L3.33333 5.22508C3.08022 5.37122 2.86998 5.58134 2.72372 5.83438C2.57745 6.08742 2.5003 6.37448 2.5 6.66675V13.3334C2.5003 13.6257 2.57745 13.9127 2.72372 14.1658C2.86998 14.4188 3.08022 14.6289 3.33333 14.7751L9.16667 18.1084C9.42003 18.2547 9.70744 18.3317 10 18.3317C10.2926 18.3317 10.58 18.2547 10.8333 18.1084L16.6667 14.7751C16.9198 14.6289 17.13 14.4188 17.2763 14.1658C17.4225 13.9127 17.4997 13.6257 17.5 13.3334Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.72498 5.80005L9.99998 10.0084L17.275 5.80005" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 18.4V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function openCalendarDetailPanel(entry) {
  _viewingCalendarEntry = entry;
  const recipe = recipes.find(r => r.id === entry.recipeId);
  if (!recipe) return;

  if (calendarDetailTitle) calendarDetailTitle.textContent = recipe.name;

  if (calendarDetailIngredients) {
    calendarDetailIngredients.innerHTML = '';
    const items = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
    if (items.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'calendar-detail-ingredient-empty';
      empty.textContent = 'Sin ingredientes';
      calendarDetailIngredients.appendChild(empty);
    } else {
      items.forEach(item => {
        const ing = ingredients.find(i => i.id === item.ingredientId);
        if (!ing) return;
        const li = document.createElement('li');
        li.className = 'calendar-detail-ingredient';
        li.innerHTML = `<span class="calendar-detail-ingredient-icon" aria-hidden="true">${BOX_ICON_SVG}</span><span class="calendar-detail-ingredient-name">${ing.name}</span><span class="calendar-detail-ingredient-qty">${item.quantity} ${ing.unit}</span>`;
        calendarDetailIngredients.appendChild(li);
      });
    }
  }

  if (calendarDetailDropdown) calendarDetailDropdown.hidden = true;
  calendarDetailPanel?.classList.add('is-open');
  planningSection?.classList.add('panel-open');
}

function closeCalendarDetailPanel() {
  calendarDetailPanel?.classList.remove('is-open');
  if (!calendarEditPanel?.classList.contains('is-open')) {
    planningSection?.classList.remove('panel-open');
  }
  if (calendarDetailDropdown) calendarDetailDropdown.hidden = true;
  _viewingCalendarEntry = null;
}

// ── Panel edición de receta desde Planificación (móvil) ──────────────────────
const calendarRecipeEditPanel = document.getElementById('calendarRecipeEditPanel');
const calendarRecipeEditNameInput = document.getElementById('calendarRecipeEditNameInput');
const calendarRecipeEditServingsInput = document.getElementById('calendarRecipeEditServingsInput');
const calendarRecipeEditIngredientsEl = document.getElementById('calendarRecipeEditIngredients');

function _makeCalendarIngredientRow(item) {
  const div = document.createElement('div');
  div.className = 'recipe-ingredient-row';

  const selectWrapper = document.createElement('div');
  selectWrapper.className = 'select-field';
  const select = document.createElement('select');
  const sortedIngs = [...ingredients].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  sortedIngs.forEach(ing => {
    const opt = document.createElement('option');
    opt.value = ing.id;
    opt.textContent = ing.name;
    if (item && ing.id === item.ingredientId) opt.selected = true;
    select.appendChild(opt);
  });
  selectWrapper.appendChild(select);

  const formatoWrapper = document.createElement('div');
  formatoWrapper.className = 'formato-wrapper';
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'number-input';
  input.placeholder = 'Cantidad';
  input.min = '1';
  if (item) input.value = item.quantity;
  const unitSpan = document.createElement('span');
  unitSpan.className = 'formato-unit';
  const currentIng = item ? ingredients.find(i => i.id === item.ingredientId) : null;
  unitSpan.textContent = currentIng?.unit || '-';

  select.addEventListener('change', () => {
    const ing = ingredients.find(i => i.id === Number(select.value));
    unitSpan.textContent = ing?.unit ?? '-';
    autoSaveCalendarRecipeEdit();
  });
  input.addEventListener('change', () => autoSaveCalendarRecipeEdit());

  formatoWrapper.appendChild(input);
  formatoWrapper.appendChild(unitSpan);
  div.appendChild(selectWrapper);
  div.appendChild(formatoWrapper);
  div.appendChild(makeRemoveIngredientRowBtn(div, item ? item.ingredientId : null));
  return div;
}

function autoSaveCalendarRecipeEdit() {
  if (!editingRecipeId) return;
  const name = calendarRecipeEditNameInput?.value.trim();
  if (!name) return;
  const recipe = recipes.find(r => r.id === editingRecipeId);
  if (!recipe) return;

  const recipeIngredients = [];
  calendarRecipeEditIngredientsEl?.querySelectorAll('.recipe-ingredient-row').forEach(row => {
    const sel = row.querySelector('select');
    const inp = row.querySelector('input');
    if (sel?.value && inp?.value) {
      recipeIngredients.push({ ingredientId: Number(sel.value), quantity: Number(inp.value) });
    }
  });

  recipe.name = name;
  recipe.ingredients = recipeIngredients;
  recipe.servings = getServingsValue(calendarRecipeEditServingsInput);
  saveRecipes();
  renderRecipes();
  if (calendarList) renderCalendarEntries();
}

function openCalendarRecipeEdit(recipeId) {
  const recipe = recipes.find(r => r.id === recipeId);
  if (!recipe) return;
  editingRecipeId = recipeId;

  if (calendarRecipeEditNameInput) calendarRecipeEditNameInput.value = recipe.name;
  setServingsValue(calendarRecipeEditServingsInput, recipe.servings);
  if (calendarRecipeEditIngredientsEl) {
    calendarRecipeEditIngredientsEl.innerHTML = '';
    (recipe.ingredients || []).forEach(item => {
      const row = _makeCalendarIngredientRow(item);
      calendarRecipeEditIngredientsEl.appendChild(row);
    });
  }

  calendarRecipeEditPanel?.classList.add('is-open');
}

function closeCalendarRecipeEditPanel() {
  autoSaveCalendarRecipeEdit();
  calendarRecipeEditPanel?.classList.remove('is-open');
  // Refrescar el panel de detalle con los nuevos datos de la receta
  if (_viewingCalendarEntry) {
    const entry = _viewingCalendarEntry;
    openCalendarDetailPanel(entry);
  }
}

document.getElementById('closeCalendarRecipeEditPanel')?.addEventListener('click', closeCalendarRecipeEditPanel);

document.getElementById('calendarRecipeEditAddIngredient')?.addEventListener('click', () => {
  if (!calendarRecipeEditIngredientsEl) return;
  if (ingredients.length === 0) { alert('Añade primero algún ingrediente'); return; }
  const row = _makeCalendarIngredientRow(null);
  calendarRecipeEditIngredientsEl.appendChild(row);
});

calendarRecipeEditServingsInput?.addEventListener('change', () => {
  normalizeServingsInput(calendarRecipeEditServingsInput);
  autoSaveCalendarRecipeEdit();
});

document.getElementById('calendarRecipeEditForm')?.addEventListener('submit', e => e.preventDefault());
// ─────────────────────────────────────────────────────────────────────────────

// Fecha en el panel de edición
function setCalendarEditDate(value) {
  if (!calendarEditDateInput) return;
  calendarEditDateInput.value = value;
  if (calendarEditDateWrapper) {
    if (value) calendarEditDateWrapper.setAttribute('data-has-value', '');
    else calendarEditDateWrapper.removeAttribute('data-has-value');
  }
}

if (calendarEditDateInput) {
  calendarEditDateInput.addEventListener('change', () => {
    if (calendarEditDateWrapper) {
      if (calendarEditDateInput.value) calendarEditDateWrapper.setAttribute('data-has-value', '');
      else calendarEditDateWrapper.removeAttribute('data-has-value');
    }
  });
}

// Weekday picker del panel de edición
function getEditSelectedWeekdays() {
  if (!editWeekdayPicker) return [];
  return [...editWeekdayPicker.querySelectorAll('.weekday-btn.active')]
    .map(btn => Number(btn.dataset.day));
}

function setEditSelectedWeekdays(days) {
  if (!editWeekdayPicker) return;
  editWeekdayPicker.querySelectorAll('.weekday-btn').forEach(btn => {
    btn.classList.toggle('active', days.includes(Number(btn.dataset.day)));
  });
}

function syncEditWeekdayPicker(days) {
  if (!editWeekdayPicker || !calendarEditRepeatSelect) return;
  const isWeekly = calendarEditRepeatSelect.value === 'weekly';
  editWeekdayPicker.classList.toggle('hidden', !isWeekly);
  if (isWeekly && days !== undefined) setEditSelectedWeekdays(days);
}

if (editWeekdayPicker) {
  editWeekdayPicker.querySelectorAll('.weekday-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      autoSaveCalendarEdit();
    });
  });
}

if (calendarEditRepeatSelect) {
  calendarEditRepeatSelect.addEventListener('change', () => {
    const isWeekly = calendarEditRepeatSelect.value === 'weekly';
    editWeekdayPicker?.classList.toggle('hidden', !isWeekly);
    if (isWeekly && calendarEditDateInput?.value) {
      const dow = new Date(calendarEditDateInput.value + 'T12:00:00').getDay();
      setEditSelectedWeekdays([dow]);
    }
  });
}

// Dropdown del menú del panel de edición
document.getElementById('calendarEditMenuBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (calendarEditDropdown) calendarEditDropdown.hidden = !calendarEditDropdown.hidden;
});

document.addEventListener('click', () => {
  if (calendarEditDropdown && !calendarEditDropdown.hidden) {
    calendarEditDropdown.hidden = true;
  }
  if (calendarDetailDropdown && !calendarDetailDropdown.hidden) {
    calendarDetailDropdown.hidden = true;
  }
});

// Panel de detalle: listeners
document.getElementById('closeCalendarDetailPanel')?.addEventListener('click', closeCalendarDetailPanel);

document.getElementById('calendarDetailMenuBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (calendarDetailDropdown) calendarDetailDropdown.hidden = !calendarDetailDropdown.hidden;
});

document.getElementById('editRecipeFromDetailPanelBtn')?.addEventListener('click', () => {
  const entry = _viewingCalendarEntry;
  if (!entry) return;
  if (calendarDetailDropdown) calendarDetailDropdown.hidden = true;
  // En móvil: abre el panel de edición de receta dentro de Planificación
  // El panel de detalle queda abierto en fondo; en desktop no existe este panel
  if (window.innerWidth < 768) {
    openCalendarRecipeEdit(entry.recipeId);
  } else {
    calendarDetailPanel?.classList.remove('is-open');
    _viewingCalendarEntry = null;
    startEditRecipe(entry.recipeId);
    openRecipePanel();
  }
});

document.getElementById('editFromDetailPanelBtn')?.addEventListener('click', () => {
  const entry = _viewingCalendarEntry;
  if (!entry) return;
  // Mantener el panel de detalle abierto — el de edición apila encima
  if (calendarDetailDropdown) calendarDetailDropdown.hidden = true;
  openCalendarModalPreset(entry.date, entry.meal, 'edit', entry.recipeId, entry.repeat ?? 'never', entry);
});

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
      if (!window.confirm('¿Seguro que quieres eliminar este cocinado?')) return;
      applyDeleteCalendarEntry();
      closeCalendarDetailPanel();
      closeCalendarPanel();
    }
  });
}

if (confirmDeleteOccurrenceBtn) {
  confirmDeleteOccurrenceBtn.addEventListener('click', () => {
    applyDeleteCalendarOccurrence();
    if (deleteCalendarConfirmModal) deleteCalendarConfirmModal.classList.add('hidden');
    closeCalendarDetailPanel();
    closeCalendarPanel();
  });
}

if (confirmDeleteAllBtn) {
  confirmDeleteAllBtn.addEventListener('click', () => {
    applyDeleteCalendarEntry();
    if (deleteCalendarConfirmModal) deleteCalendarConfirmModal.classList.add('hidden');
    closeCalendarDetailPanel();
    closeCalendarPanel();
  });
}

if (confirmDeleteCancelBtn) {
  confirmDeleteCancelBtn.addEventListener('click', () => {
    if (deleteCalendarConfirmModal) deleteCalendarConfirmModal.classList.add('hidden');
  });
}

// create → modal | edit → panel lateral
function openCalendarModalPreset(date, meal, mode = 'create', recipeId = null, repeat = null, entry = null) {
  if (mode === 'create') {
    setCalendarDate(date);
    if (calendarMealSelect) calendarMealSelect.value = meal;
    if (calendarRecipeSelect) calendarRecipeSelect.value = '';
    if (calendarRepeatSelect) calendarRepeatSelect.value = 'never';
    syncWeekdayPicker();
    _calendarEditingEntry = null;
    openModal(calendarModal);
  } else {
    setCalendarEditDate(date);
    if (calendarEditMealSelect) calendarEditMealSelect.value = meal;
    if (recipeId !== null && calendarEditRecipeSelect) calendarEditRecipeSelect.value = recipeId;
    if (repeat !== null && calendarEditRepeatSelect) calendarEditRepeatSelect.value = repeat;
    const days = entry?.days?.length
      ? entry.days
      : (date ? [new Date(date + 'T12:00:00').getDay()] : []);
    syncEditWeekdayPicker(days);
    _calendarEditingEntry = entry;
    openCalendarPanel();
  }
}

// Modal "Añadir cocinado"
if (openCalendarModalBtn && calendarModal && closeCalendarModalBtn) {
  openCalendarModalBtn.addEventListener('click', () => {
    if (calendarRecipeSelect) calendarRecipeSelect.value = '';
    if (calendarMealSelect) calendarMealSelect.value = '';
    setCalendarDate('');
    if (calendarRepeatSelect) calendarRepeatSelect.value = 'never';
    syncWeekdayPicker();
    openModal(calendarModal);
  });

  closeCalendarModalBtn.addEventListener('click', () => {
    closeModal(calendarModal);
  });

  calendarModal.addEventListener('click', (e) => {
    if (e.target === calendarModal) closeModal(calendarModal);
  });
}

// Panel "Editar cocinado"
closeCalendarEditPanelBtn?.addEventListener('click', () => closeCalendarPanel());

function autoSaveCalendarEdit() {
  const date = calendarEditDateInput?.value;
  const recipeId = Number(calendarEditRecipeSelect?.value);
  const repeat = calendarEditRepeatSelect?.value || 'never';
  const meal = calendarEditMealSelect?.value;

  if (!date || !recipeId || !meal) return;

  // Eliminar la entrada original
  if (_calendarEditingEntry) {
    const orig = _calendarEditingEntry;
    calendarEntries = calendarEntries.filter(e => {
      if (orig.repeat && orig.repeat !== 'never') {
        return !(e.startDate === orig.startDate && e.recipeId === orig.recipeId && e.meal === orig.meal && e.repeat === orig.repeat);
      }
      return !(e.date === orig.date && e.recipeId === orig.recipeId && e.meal === orig.meal);
    });
  }

  // Añadir entrada actualizada
  if (repeat === 'never') {
    addCalendarEntry({ date, recipeId, meal });
    _calendarEditingEntry = { date, recipeId, meal, repeat: 'never' };
  } else if (repeat === 'daily') {
    addCalendarEntry({ startDate: date, recipeId, meal, repeat: 'daily' });
    _calendarEditingEntry = { startDate: date, recipeId, meal, repeat: 'daily', date };
  } else if (repeat === 'weekly') {
    const days = getEditSelectedWeekdays();
    const effectiveDays = days.length > 0 ? days : [new Date(date + 'T12:00:00').getDay()];
    addCalendarEntry({ startDate: date, recipeId, meal, repeat: 'weekly', days: effectiveDays });
    _calendarEditingEntry = { startDate: date, recipeId, meal, repeat: 'weekly', days: effectiveDays, date };
  }

  saveCalendarEntries();
  renderCalendarEntries();
  if (shoppingList && lastShoppingList) renderStoresOverview();
}

[calendarEditRecipeSelect, calendarEditMealSelect, calendarEditDateInput, calendarEditRepeatSelect].forEach(el => {
  if (el) el.addEventListener('change', autoSaveCalendarEdit);
});



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

// Solo las pestañas de esta pantalla. Sin el [data-shopping-tab] esto cogía
// también las de Listas y las de Consumibles, les enganchaba este listener y
// al pulsarlas llamaba a setShoppingTab(undefined), que marcaba como activas
// todas las que no tienen ese atributo: las dos a la vez.
const shoppingTabButtons = document.querySelectorAll('.shopping-tab-btn[data-shopping-tab]');
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
  btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 5L5 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M5 5L15 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
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

  const selectWrapper = document.createElement('div');
  selectWrapper.className = 'select-field';

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

  selectWrapper.appendChild(select);

  const formatoWrapper = document.createElement('div');
  formatoWrapper.className = 'formato-wrapper';

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'number-input';
  input.placeholder = 'Cantidad';
  input.min = '1';

  const unitSpan = document.createElement('span');
  unitSpan.className = 'formato-unit';
  unitSpan.textContent = '-';

  select.addEventListener('change', () => {
    const ing = ingredients.find(i => i.id === Number(select.value));
    unitSpan.textContent = ing?.unit ?? '-';
  });

  formatoWrapper.appendChild(input);
  formatoWrapper.appendChild(unitSpan);
  div.appendChild(selectWrapper);
  div.appendChild(formatoWrapper);
  div.appendChild(makeRemoveIngredientRowBtn(div, null));

  ingredientSelectors.appendChild(div);
}

if (addIngredientBtn) {
  addIngredientBtn.addEventListener('click', addIngredientRow);
}

function autoSaveRecipe() {
  if (!editingRecipeId) return;

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
  recipe.servings = getServingsValue(recipeServingsInput);
  RECIPE_TEXT_FIELDS.forEach((field) => {
    recipe[field.key] = getRichTextValue(field.el);
  });
  saveRecipes();
  renderRecipes();
  if (calendarList) renderCalendarEntries();

  const savedId = editingRecipeId;
  document.querySelector(`.recipe-table tr[data-id="${savedId}"]`)
    ?.classList.add('is-selected');
}

recipeNameInput?.addEventListener('change', () => autoSaveRecipe());
recipeServingsInput?.addEventListener('change', () => {
  normalizeServingsInput(recipeServingsInput);
  autoSaveRecipe();
});
ingredientSelectors?.addEventListener('change', () => autoSaveRecipe());

// Guardan al salir del editor y al pulsar un botón de formato.
RECIPE_TEXT_FIELDS.forEach((field) => {
  initRichText(field.el?.closest('.rich-text'), () => autoSaveRecipe());
});

if (recipeForm) {
  recipeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!editingRecipeId) return;

    const recipeIngredients = [];
    ingredientSelectors?.querySelectorAll('.recipe-ingredient-row').forEach((row) => {
      const select = row.querySelector('select');
      const input = row.querySelector('input');
      if (!select || !input) return;
      if (select.value && input.value) {
        recipeIngredients.push({
          ingredientId: Number(select.value),
          quantity: Number(input.value),
        });
      }
    });

    if (!recipeNameInput.value.trim()) {
      alert('Rellena el nombre de la receta');
      return;
    }

    const recipe = recipes.find((r) => r.id === editingRecipeId);
    recipe.name = recipeNameInput.value.trim();
    recipe.ingredients = recipeIngredients;
    recipe.servings = getServingsValue(recipeServingsInput);
    RECIPE_TEXT_FIELDS.forEach((field) => {
      recipe[field.key] = getRichTextValue(field.el);
    });

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
    countCell.textContent = count === 0 ? '-' : count === 1 ? '1 ingrediente' : `${count} ingredientes`;

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
    [...filteredRecipes].sort((a, b) => a.name.localeCompare(b.name, 'es')).forEach((recipe) => {
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
        startEditRecipe(recipe.id);
        openRecipePanel();
      });
      ul.appendChild(li);
    });
    recipeList.appendChild(ul);
  }

  renderCalendarRecipeSelect();
  // La tabla de Cocinados muestra nombres de receta: se repinta con ellos.
  renderCocinados();
}

function startEditRecipe(recipeId) {
  const recipe = recipes.find((r) => r.id === recipeId);
  if (!recipe) return;

  editingRecipeId = recipeId;

  const title = document.getElementById('recipeModalTitle');
  if (title) title.textContent = 'Editar receta';

  // Rellenar nombre
  recipeNameInput.value = recipe.name;

  // Rellenar número de raciones
  setServingsValue(recipeServingsInput, recipe.servings);

  // Rellenar los campos de texto de 'Cocinado'
  RECIPE_TEXT_FIELDS.forEach((field) => {
    setRichTextValue(field.el, recipe[field.key]);
  });

  // Limpiar ingredientes actuales
  ingredientSelectors.innerHTML = '';

  // Rellenar ingredientes del cocinado
  recipe.ingredients.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'recipe-ingredient-row';

    const selectWrapper = document.createElement('div');
    selectWrapper.className = 'select-field';

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

    selectWrapper.appendChild(select);

    const formatoWrapper = document.createElement('div');
    formatoWrapper.className = 'formato-wrapper';

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'number-input';
    input.min = '0';
    input.placeholder = 'Cantidad';
    input.value = item.quantity;

    const unitSpan = document.createElement('span');
    unitSpan.className = 'formato-unit';
    const selectedIng = ingredients.find(i => i.id === item.ingredientId);
    unitSpan.textContent = selectedIng?.unit ?? '-';

    select.addEventListener('change', () => {
      const ing = ingredients.find(i => i.id === Number(select.value));
      unitSpan.textContent = ing?.unit ?? '-';
    });

    formatoWrapper.appendChild(input);
    formatoWrapper.appendChild(unitSpan);
    row.appendChild(selectWrapper);
    row.appendChild(formatoWrapper);
    row.appendChild(makeRemoveIngredientRowBtn(row, item.ingredientId));
    ingredientSelectors.appendChild(row);
  });


}

function resetRecipeForm() {
  editingRecipeId = null;
  if (recipeForm) recipeForm.reset();
  if (ingredientSelectors) ingredientSelectors.innerHTML = '';
  // `form.reset()` no afecta a un contenteditable: hay que vaciarlo a mano.
  RECIPE_TEXT_FIELDS.forEach((field) => {
    if (field.el) field.el.innerHTML = '';
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

  const start = parseISODate(entry.startDate);
  if (Number.isNaN(start.getTime())) return; // seguridad

  const realEnd = toISODateString(start > end ? start : end);
  const excluded = Array.isArray(entry.excludedDates) ? entry.excludedDates : [];

  if (entry.repeat === 'weekly' && Array.isArray(entry.days) && entry.days.length > 0) {
    entry.days.forEach(dow => {
      const diff = (dow - start.getDay() + 7) % 7;
      const firstOcc = addDays(start, diff);
      for (let d = new Date(firstOcc); toISODateString(d) <= realEnd; d = addDays(d, 7)) {
        const iso = toISODateString(d);
        if (entry.until && iso >= entry.until) break;
        if (excluded.includes(iso)) continue;
        expandedEntries.push({ date: iso, recipeId: entry.recipeId, meal: entry.meal, repeat: entry.repeat, startDate: entry.startDate, days: entry.days });
      }
    });
  } else {
    const step = entry.repeat === 'weekly' ? 7 : 1;
    for (let d = new Date(start); toISODateString(d) <= realEnd; d = addDays(d, step)) {
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

          row.addEventListener('click', () => openCalendarModalPreset(date, entry.meal, 'edit', entry.recipeId, entry.repeat ?? 'never', entry));
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

      const cookedKey = `${date}-${entry.recipeId}-${entry.meal}`;

      const recipeLi = document.createElement('li');
      recipeLi.classList.add('calendar-recipe-row');
      if (!recipe.ingredients || recipe.ingredients.length === 0) {
        recipeLi.classList.add('is-no-ingredients');
      }
      if (calendarCooked[cookedKey]) {
        recipeLi.classList.add('is-cooked');
      }

      // Contenido de texto (ingesta + nombre receta)
      const entryBody = document.createElement('div');
      entryBody.className = 'calendar-entry-body';

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

      entryBody.appendChild(mealEl);
      entryBody.appendChild(recipeNameEl);

      // Checkbox "cocinado"
      const cbLabel = document.createElement('label');
      cbLabel.className = 'cb calendar-cb';
      const cbInput = document.createElement('input');
      cbInput.type = 'checkbox';
      cbInput.className = 'cb-input';
      cbInput.checked = !!calendarCooked[cookedKey];
      const cbBox = document.createElement('span');
      cbBox.className = 'cb-box';
      cbLabel.appendChild(cbInput);
      cbLabel.appendChild(cbBox);

      cbLabel.addEventListener('click', (e) => e.stopPropagation());
      cbInput.addEventListener('change', () => {
        if (cbInput.checked) {
          calendarCooked[cookedKey] = true;
        } else {
          delete calendarCooked[cookedKey];
        }
        saveCalendarCooked();
        recipeLi.classList.toggle('is-cooked', cbInput.checked);
      });

      recipeLi.appendChild(cbLabel);
      recipeLi.appendChild(entryBody);
      recipeLi.addEventListener('click', () => openCalendarDetailPanel(entry));
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
    const start = parseISODate(entry.startDate);
    if (Number.isNaN(start.getTime())) return;

    const excluded = Array.isArray(entry.excludedDates) ? entry.excludedDates : [];

    if (repeat === 'weekly' && Array.isArray(entry.days) && entry.days.length > 0) {
      entry.days.forEach(dow => {
        const diff = (dow - start.getDay() + 7) % 7;
        const firstOcc = addDays(start, diff);
        for (let d = new Date(firstOcc); toISODateString(d) <= endDate; d = addDays(d, 7)) {
          const iso = toISODateString(d);
          if (entry.until && iso >= entry.until) break;
          if (iso < startDate) continue;
          if (excluded.includes(iso)) continue;
          expanded.push({ date: iso, recipeId: entry.recipeId, meal: entry.meal, repeat, startDate: entry.startDate, days: entry.days });
        }
      });
    } else {
      const step = repeat === 'weekly' ? 7 : 1;
      for (let d = new Date(start); toISODateString(d) <= endDate; d = addDays(d, step)) {
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
  const sorted = [...recipes].sort((a, b) => a.name.localeCompare(b.name, 'es'));

  // Modal "Añadir cocinado"
  if (calendarRecipeSelect) {
    calendarRecipeSelect.innerHTML = '<option value="">Selecciona una receta...</option>';
    sorted.forEach((recipe) => {
      const option = document.createElement('option');
      option.value = recipe.id;
      option.textContent = recipe.name;
      calendarRecipeSelect.appendChild(option);
    });
  }

  // Panel "Editar cocinado"
  if (calendarEditRecipeSelect) {
    calendarEditRecipeSelect.innerHTML = '<option value="">Selecciona una receta...</option>';
    sorted.forEach((recipe) => {
      const option = document.createElement('option');
      option.value = recipe.id;
      option.textContent = recipe.name;
      calendarEditRecipeSelect.appendChild(option);
    });
  }
}





// -----------------------
// TOOLTIP
// -----------------------

// Cualquier elemento con `data-tooltip` muestra ese texto al pasar por encima.
// El globo es un único nodo colgado de <body>: como hijo del elemento lo
// recortaría el `overflow` del contenedor (la tabla de Cocinados, por ejemplo).
const TOOLTIP_GAP = 8;
let _tooltipEl = null;

function getTooltipEl() {
  if (!_tooltipEl) {
    _tooltipEl = document.createElement('div');
    _tooltipEl.className = 'tooltip';
    _tooltipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(_tooltipEl);
  }
  return _tooltipEl;
}

function showTooltip(host) {
  const text = host.dataset.tooltip;
  if (!text) return;

  const tip = getTooltipEl();
  tip.textContent = text;
  // Hay que hacerlo visible antes de medirlo: con `opacity: 0` ya ocupa su
  // sitio, pero el texto acaba de cambiar y necesita un alto y ancho nuevos.
  tip.style.left = '0px';
  tip.style.top = '0px';
  tip.classList.add('is-visible');

  const hostBox = host.getBoundingClientRect();
  const tipBox = tip.getBoundingClientRect();

  // Centrado sobre el elemento, pero sin salirse de la ventana: las notas de
  // la última columna de la tabla quedan pegadas al borde derecho.
  const maxLeft = window.innerWidth - tipBox.width - TOOLTIP_GAP;
  const left = Math.max(TOOLTIP_GAP, Math.min(hostBox.left + (hostBox.width - tipBox.width) / 2, maxLeft));

  // Encima del elemento; si ahí no cabe (primera fila de la tabla), debajo.
  let top = hostBox.top - tipBox.height - TOOLTIP_GAP;
  if (top < TOOLTIP_GAP) top = hostBox.bottom + TOOLTIP_GAP;

  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

function hideTooltip() {
  if (_tooltipEl) _tooltipEl.classList.remove('is-visible');
}

// Delegado en el documento para que valga también para lo que se pinta después.
document.addEventListener('mouseover', (e) => {
  const host = e.target.closest?.('[data-tooltip]');
  if (host) showTooltip(host);
});

document.addEventListener('mouseout', (e) => {
  const host = e.target.closest?.('[data-tooltip]');
  // Moverse entre los hijos del propio elemento no es salir de él.
  if (host && !host.contains(e.relatedTarget)) hideTooltip();
});

// Está posicionado respecto a la ventana: al desplazar la tabla o la página se
// quedaría flotando donde estaba. En captura, para oír también a la tabla.
window.addEventListener('scroll', hideTooltip, true);

// -----------------------
// COCINADOS: tabla semanal
// -----------------------

const cocinadoRecipeModal = document.getElementById('cocinadoRecipeModal');
const cocinadoRecipeForm = document.getElementById('cocinadoRecipeForm');
const cocinadoRecipeSelect = document.getElementById('cocinadoRecipeSelect');
const cocinadoRecipeModalContext = document.getElementById('cocinadoRecipeModalContext');
const cocinadoRecipeModalTitle = document.getElementById('cocinadoRecipeModalTitle');
const cocinadoRecipeSubmitBtn = document.getElementById('cocinadoRecipeSubmitBtn');
const cocinadoServingsSection = document.getElementById('cocinadoServingsSection');
const cocinadoServingsRows = document.getElementById('cocinadoServingsRows');
const deleteCocinadoBtn = document.getElementById('deleteCocinadoBtn');

// Celda desde la que se abrió el modal: { dayId, mealId }
let _cocinadoTarget = null;
// Ingesta que se está editando, o null si se está añadiendo una nueva.
// Las raciones guardadas antes de que existieran los grupos no tienen batchId:
// en ese caso se identifican por la celda y la posición que ocupan en ella.
let _cocinadoEditing = null;

function cocinadoKey(dayId, mealId) {
  return `${dayId}-${mealId}`;
}

// Cada celda guarda sus raciones: { recipeId, batchId, first }. `batchId` une
// las raciones que salen de un mismo cocinado, aunque estén en días distintos,
// y `first` marca la que se consume antes dentro de ese grupo.
function normalizeCocinadoServing(value) {
  if (value && typeof value === 'object') {
    return {
      recipeId: Number(value.recipeId),
      batchId: value.batchId || null,
      first: !!value.first,
    };
  }
  // Formato anterior: la celda guardaba solo el id de la receta. Cada uno es
  // una ración suelta, y por tanto la primera de su propio grupo.
  return { recipeId: Number(value), batchId: null, first: true };
}

function getCocinadoServings(dayId, mealId) {
  const value = cocinados[cocinadoKey(dayId, mealId)];
  return Array.isArray(value) ? value.map(normalizeCocinadoServing) : [];
}

function putCocinadoServings(dayId, mealId, servings) {
  const key = cocinadoKey(dayId, mealId);
  if (servings.length) cocinados[key] = servings;
  else delete cocinados[key];
}

// Todas las raciones de un grupo, con la celda en la que está cada una, en el
// orden en que aparecen los días de la tabla.
function findBatchServings(batchId, mealId) {
  const found = [];
  if (!batchId) return found;

  COCINADOS_DAYS.forEach((day) => {
    getCocinadoServings(day.id, mealId).forEach((serving, index) => {
      if (serving.batchId === batchId) found.push({ dayId: day.id, index, serving });
    });
  });
  return found;
}

// ── Mutaciones del modelo. No guardan ni repintan: de eso se encargan las
//    funciones de más abajo, para poder componer varias en un solo cambio. ──

function insertCocinadoBatch(batchId, mealId, recipeId, assignments) {
  assignments.forEach(({ dayId, first }) => {
    const servings = getCocinadoServings(dayId, mealId);
    servings.push({ recipeId, batchId, first });
    putCocinadoServings(dayId, mealId, servings);
  });
}

function deleteCocinadoBatch(batchId, mealId) {
  if (!batchId) return;

  COCINADOS_DAYS.forEach((day) => {
    const servings = getCocinadoServings(day.id, mealId)
      .filter((serving) => serving.batchId !== batchId);
    putCocinadoServings(day.id, mealId, servings);
  });
}

function deleteCocinadoServingAt(dayId, mealId, index) {
  const servings = getCocinadoServings(dayId, mealId);
  const removed = servings[index];
  if (!removed) return null;

  servings.splice(index, 1);
  putCocinadoServings(dayId, mealId, servings);
  return removed;
}

// Si se quita la primera ración de un grupo, el grupo se quedaría sin ninguna
// marcada: pasa a serlo la siguiente que quede, por orden de días.
// ── Operaciones completas: mutan, guardan y repintan. ──

// Solo con la hora, dos ingestas creadas en el mismo milisegundo —o a la vez
// en dos dispositivos— compartirían grupo, y editar una borraría la otra.
function newCocinadoBatchId() {
  return `b${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function addCocinadoBatch(mealId, recipeId, assignments) {
  insertCocinadoBatch(newCocinadoBatchId(), mealId, recipeId, assignments);
  saveCocinados();
  renderCocinados();
}

// Editar una ingesta es reemplazar sus raciones conservando su grupo, para que
// siga siendo la misma ingesta.
function updateCocinadoBatch(batchId, mealId, recipeId, assignments) {
  deleteCocinadoBatch(batchId, mealId);
  insertCocinadoBatch(batchId, mealId, recipeId, assignments);
  saveCocinados();
  renderCocinados();
}

// La ingesta se borra entera: todas sus raciones, estén en el día que estén.
function removeCocinadoBatch(editing, mealId) {
  if (editing.batchId) {
    deleteCocinadoBatch(editing.batchId, mealId);
  } else {
    // Ración del formato anterior, sin grupo: la ingesta es ella sola.
    deleteCocinadoServingAt(editing.dayId, mealId, editing.index);
  }

  saveCocinados();
  renderCocinados();
}

// Desplazamiento de días dentro de la semana de la tabla, que es un ciclo: el
// día siguiente al domingo es el lunes, y el anterior al lunes, el domingo.
function shiftCocinadoDay(dayId, offset) {
  const index = COCINADOS_DAYS.findIndex((day) => day.id === dayId);
  if (index < 0) return null;

  const total = COCINADOS_DAYS.length;
  return COCINADOS_DAYS[(((index + offset) % total) + total) % total].id;
}

// Notas que toca mostrar en una celda: el campo indicado de las recetas cuyas
// raciones caen donde dice `config`.
function getCocinadoNotes(cellDayId, cellMealId, config) {
  const targetDayId = shiftCocinadoDay(cellDayId, config.dayOffset);
  if (targetDayId === null) return [];

  const meals = config.ownMeal
    ? COCINADOS_MEALS.filter((meal) => meal.id === cellMealId)
    : COCINADOS_MEALS.filter((meal) => meal.recipes);

  const notes = [];

  meals.forEach((meal) => {
    getCocinadoServings(targetDayId, meal.id).forEach((serving) => {
      if (config.firstOnly && !serving.first) return;

      const recipe = recipes.find((r) => r.id === serving.recipeId);
      const html = sanitizeRichText(recipe?.[config.field]);
      if (!recipe || !html) return;

      // En la celda de la propia ingesta, repetir el nombre de la ingesta
      // sobraría: basta el de la receta para distinguir entre varias.
      const source = config.ownMeal ? recipe.name : `${recipe.name} · ${meal.name}`;
      notes.push({ source, html });
    });
  });

  return notes;
}

function makeCocinadoNote(note, showSource) {
  const item = document.createElement('li');
  item.className = 'week-cell-note';

  // De qué receta es la nota no se escribe en la celda, que es estrecha: sale
  // en el tooltip al pasar por encima de la caja.
  item.dataset.tooltip = note.source;

  // En la vista de móvil sí se escribe: hay ancho para ella, y en táctil no hay
  // hover que saque el tooltip.
  if (showSource) {
    const source = document.createElement('span');
    source.className = 'week-cell-note-source';
    source.textContent = note.source;
    item.appendChild(source);
  }

  const body = document.createElement('div');
  body.className = 'week-cell-note-body rich-text-content';
  body.innerHTML = note.html;

  item.appendChild(body);
  return item;
}

function makeCocinadoAddBtn(dayId, mealId, mealName, dayName) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'week-cell-add-btn';
  btn.setAttribute('aria-label', `Añadir receta — ${mealName}, ${dayName}`);
  btn.title = 'Añadir receta';
  // El mismo icono que el botón de Planificación (`.calendar-meal-add-btn`).
  btn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
  btn.addEventListener('click', () => openCocinadoRecipeModal(dayId, mealId));
  return btn;
}

// `position` es el número de ración dentro del reparto, contando desde la que
// se consume antes: el mismo orden en que salen las filas del modal.
function cocinadoBylineText(position, split) {
  if (!split) return 'Ración única';
  if (position < 0) return '';

  const ordinal = COCINADO_ORDINALS[position];
  // Con más de diez raciones no hay ordinal escrito, pero la caja no se queda
  // sin indicar de qué ración se trata.
  return ordinal ? `${ordinal} ración` : `Ración ${position + 1}`;
}

function makeCocinadoEntry(dayId, mealId, serving, index) {
  const recipe = recipes.find((r) => r.id === serving.recipeId);

  const item = document.createElement('li');
  item.className = 'week-cell-entry';

  // Una ingesta repartida en varias raciones se edita entera desde un único
  // sitio: la ración marcada como primera. Desde las demás se editaría lo
  // mismo, y tener la entrada abierta en tres celdas hacía pensar que cada
  // ración se tocaba por separado.
  const batch = serving.batchId ? findBatchServings(serving.batchId, mealId) : [];
  const split = batch.length > 1;
  // Si el reparto no tiene ninguna ración marcada —datos guardados antes de
  // que existiera la marca— la ingesta se quedaría sin forma de editarse.
  const editable = !split || serving.first || !batch.some((entry) => entry.serving.first);

  // La caja entera abre la edición, no solo el nombre: así el cursor cambia en
  // cualquier punto del amarillo y lo que se puede pulsar coincide con lo que
  // el cursor anuncia.
  if (editable) {
    item.classList.add('is-editable');
    item.title = 'Editar ingesta';
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.addEventListener('click', () => openCocinadoEditModal(dayId, mealId, index));
    item.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openCocinadoEditModal(dayId, mealId, index);
    });
  }

  const name = document.createElement('span');
  name.className = 'week-cell-entry-name';
  // Una receta borrada deja su id en la tabla: se avisa en lugar de dejar
  // la celda en blanco.
  name.textContent = recipe ? recipe.name : 'Receta eliminada';
  if (!recipe) name.classList.add('week-cell-entry-missing');

  item.appendChild(name);

  // `findBatchServings` devuelve en orden de días; la ración 1 es la que se
  // consume antes, así que se pone delante (ordenación estable: las demás
  // conservan el orden de días, igual que las filas del modal de edición).
  const ordered = [...batch].sort((a, b) => Number(b.serving.first) - Number(a.serving.first));
  const position = ordered.findIndex((entry) => entry.dayId === dayId && entry.index === index);
  const bylineText = cocinadoBylineText(position, split);

  if (bylineText) {
    const byline = document.createElement('span');
    byline.className = 'week-cell-entry-byline';
    byline.textContent = bylineText;
    item.appendChild(byline);
  }

  return item;
}

// El contenido de una celda —sus raciones y sus notas— es el mismo en la tabla
// de desktop y en la vista de móvil, así que lo monta una sola función en el
// nodo que reciba.
function fillCocinadoCell(container, dayId, meal, showNoteSource) {
  if (meal.recipes) {
    const servings = getCocinadoServings(dayId, meal.id);
    if (servings.length) {
      const list = document.createElement('ul');
      list.className = 'week-cell-list';
      servings.forEach((serving, index) => {
        list.appendChild(makeCocinadoEntry(dayId, meal.id, serving, index));
      });
      container.appendChild(list);
    }
  }

  if (meal.notes) {
    const notes = getCocinadoNotes(dayId, meal.id, meal.notes);
    if (notes.length) {
      const list = document.createElement('ul');
      list.className = 'week-cell-notes';
      notes.forEach((note) => list.appendChild(makeCocinadoNote(note, showNoteSource)));
      container.appendChild(list);
    }
  }
}

// Los nodos se buscan aquí y no en una constante del módulo: renderRecipes()
// llama a esta función y se ejecuta antes de que este bloque se evalúe.
function renderCocinadosTable() {
  const cocinadosTableHead = document.getElementById('cocinadosTableHead');
  const cocinadosTableBody = document.getElementById('cocinadosTableBody');
  if (!cocinadosTableHead || !cocinadosTableBody) return;

  cocinadosTableHead.innerHTML = '';
  const headRow = document.createElement('tr');

  COCINADOS_DAYS.forEach((day) => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = day.name;
    headRow.appendChild(th);
  });
  cocinadosTableHead.appendChild(headRow);

  cocinadosTableBody.innerHTML = '';
  COCINADOS_MEALS.forEach((meal) => {
    const row = document.createElement('tr');

    COCINADOS_DAYS.forEach((day) => {
      const cell = document.createElement('td');

      // Cada celda se titula con su ingesta, y el '+' va en esa misma línea.
      const header = document.createElement('div');
      header.className = 'week-cell-header';

      const title = document.createElement('span');
      title.className = 'week-cell-title';
      title.textContent = meal.name;
      header.appendChild(title);

      if (meal.recipes) {
        header.appendChild(makeCocinadoAddBtn(day.id, meal.id, meal.name, day.name));
      }

      cell.appendChild(header);
      fillCocinadoCell(cell, day.id, meal, false);

      row.appendChild(cell);
    });

    cocinadosTableBody.appendChild(row);
  });
}

// ── Vista de móvil ──
// Nombres de las recetas que hay en una celda: los de sus raciones y los de las
// recetas de las que salen sus notas.
function cocinadoCellRecipeNames(dayId, meal) {
  const names = [];

  if (meal.recipes) {
    getCocinadoServings(dayId, meal.id).forEach((serving) => {
      const recipe = recipes.find((r) => r.id === serving.recipeId);
      names.push(recipe ? recipe.name : 'Receta eliminada');
    });
  }

  if (meal.notes) {
    // `source` lleva, según la celda, el nombre de la receta o el de la receta
    // y su ingesta separados por '·': en el resumen basta el de la receta.
    getCocinadoNotes(dayId, meal.id, meal.notes)
      .forEach((note) => names.push(note.source.split(' · ')[0]));
  }

  return [...new Set(names)];
}

// Fila de menú: el nombre a la izquierda —con lo que haya dentro debajo, si se
// le pasa— y el chevron a la derecha, igual que la lista de recetas en móvil
// (`.recipe-row`). Los días van sin resumen: el menú se lee de un tirón.
function makeCocinadoMobileRow(label, summary, onOpen) {
  const item = document.createElement('li');
  item.className = 'cocinados-mobile-row';
  item.tabIndex = 0;
  item.setAttribute('role', 'button');

  const body = document.createElement('div');
  body.className = 'cocinados-mobile-row-body';

  const name = document.createElement('span');
  name.className = 'cocinados-mobile-row-name';
  name.textContent = label;
  body.appendChild(name);

  if (summary) {
    const detail = document.createElement('span');
    detail.className = 'cocinados-mobile-row-summary';
    detail.textContent = summary;
    body.appendChild(detail);
  }

  item.appendChild(body);
  item.insertAdjacentHTML('beforeend', `
    <span class="cocinados-mobile-row-icon">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </span>`);

  item.addEventListener('click', onOpen);
  item.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onOpen();
  });

  return item;
}

// Cabecera de los niveles de dentro: el botón de volver y dónde se está.
function makeCocinadoMobileNav(title, onBack) {
  const nav = document.createElement('div');
  nav.className = 'cocinados-mobile-nav';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'cocinados-mobile-back';
  back.setAttribute('aria-label', 'Volver');
  back.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 18L9 12L15 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  back.addEventListener('click', onBack);

  const heading = document.createElement('span');
  heading.className = 'cocinados-mobile-title';
  heading.textContent = title;

  nav.appendChild(back);
  nav.appendChild(heading);
  return nav;
}

function renderCocinadosMobile() {
  const root = document.getElementById('cocinadosMobile');
  if (!root) return;

  // Un día o una ingesta que ya no existan dejarían la vista en blanco: se cae
  // al nivel anterior, que siempre se puede pintar.
  const day = COCINADOS_DAYS.find((d) => d.id === cocinadoMobileDayId) || null;
  const meal = day
    ? COCINADOS_MEALS.find((m) => m.id === cocinadoMobileMealId) || null
    : null;
  cocinadoMobileDayId = day ? day.id : null;
  cocinadoMobileMealId = meal ? meal.id : null;

  root.innerHTML = '';

  // Primer nivel: los siete días.
  if (!day) {
    const list = document.createElement('ul');
    list.className = 'cocinados-mobile-list';

    COCINADOS_DAYS.forEach((entry) => {
      list.appendChild(makeCocinadoMobileRow(entry.name, '', () => {
        cocinadoMobileDayId = entry.id;
        renderCocinadosMobile();
      }));
    });

    root.appendChild(list);
    return;
  }

  // Segundo nivel: las ingestas del día.
  if (!meal) {
    root.appendChild(makeCocinadoMobileNav(day.name, () => {
      cocinadoMobileDayId = null;
      renderCocinadosMobile();
    }));

    const list = document.createElement('ul');
    list.className = 'cocinados-mobile-list';

    COCINADOS_MEALS.forEach((entry) => {
      const summary = cocinadoCellRecipeNames(day.id, entry).join(', ');
      list.appendChild(makeCocinadoMobileRow(entry.name, summary, () => {
        cocinadoMobileMealId = entry.id;
        renderCocinadosMobile();
      }));
    });

    root.appendChild(list);
    return;
  }

  // Tercer nivel: el contenido de la celda.
  root.appendChild(makeCocinadoMobileNav(`${day.name} · ${meal.name}`, () => {
    cocinadoMobileMealId = null;
    renderCocinadosMobile();
  }));

  const cell = document.createElement('div');
  cell.className = 'cocinados-mobile-cell';
  fillCocinadoCell(cell, day.id, meal, true);

  // Sin raciones ni notas la pantalla se quedaría vacía sin decir por qué.
  if (!cell.childElementCount) {
    const empty = document.createElement('p');
    empty.className = 'cocinados-mobile-empty';
    empty.textContent = meal.recipes
      ? 'Todavía no hay recetas en esta ingesta.'
      : 'Nada que preparar.';
    cell.appendChild(empty);
  }

  root.appendChild(cell);

  // El '+' de la celda de la tabla es diminuto y se descubre al pasar por
  // encima: en móvil, donde no hay puntero, el botón va escrito y entero.
  if (meal.recipes) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'secondary cocinados-mobile-add';
    add.textContent = 'Añadir receta';
    add.addEventListener('click', () => openCocinadoRecipeModal(day.id, meal.id));
    root.appendChild(add);
  }
}

// Las dos vistas se pintan siempre y es el CSS el que enseña la que toca, así
// girar el teléfono o cambiar el tamaño de la ventana no deja ninguna sin montar.
function renderCocinados() {
  renderCocinadosTable();
  renderCocinadosMobile();
}

// Raciones de la receta elegida en el modal. Una receta sin raciones definidas
// se trata como una sola, que es el comportamiento que había antes.
function getCocinadoModalServings() {
  const recipe = recipes.find((r) => r.id === Number(cocinadoRecipeSelect?.value));
  const servings = Number(recipe?.servings);
  return Number.isFinite(servings) && servings > 1 ? Math.floor(servings) : 1;
}

// Días elegidos ahora mismo en el modal; null en los que estén sin elegir.
function readCocinadoServingDays() {
  if (!cocinadoServingsRows) return [];
  return [...cocinadoServingsRows.querySelectorAll('select')]
    .map((select) => (select.value === '' ? null : Number(select.value)));
}

function makeCocinadoDaySelect(index, selectedDayId) {
  const wrapper = document.createElement('div');
  wrapper.className = 'select-field cocinado-serving-day';

  const select = document.createElement('select');
  select.required = true;
  select.dataset.servingIndex = index;
  select.setAttribute('aria-label', `Día de la ración ${index + 1}`);
  select.innerHTML = '<option value="">Selecciona un día...</option>';

  COCINADOS_DAYS.forEach((day) => {
    const option = document.createElement('option');
    option.value = day.id;
    option.textContent = day.name;
    if (day.id === selectedDayId) option.selected = true;
    select.appendChild(option);
  });

  wrapper.appendChild(select);
  return wrapper;
}

// Monta una fila por ración. `prefillDays` son los días ya elegidos (al editar
// una ingesta, o al cambiar de receta sin perder lo seleccionado); la ración 1
// cae por defecto en el día de la celda desde la que se abrió el modal, y es
// siempre la primera en consumirse.
function renderCocinadoServingFields(prefillDays) {
  if (!cocinadoServingsSection || !cocinadoServingsRows) return;

  const total = getCocinadoModalServings();
  cocinadoServingsSection.hidden = total <= 1;
  cocinadoServingsRows.innerHTML = '';

  if (total <= 1) return;

  for (let index = 0; index < total; index += 1) {
    const prefilled = prefillDays?.[index];
    const dayId = prefilled != null
      ? prefilled
      : (index === 0 ? _cocinadoTarget?.dayId ?? null : null);

    const row = document.createElement('div');
    row.className = 'cocinado-serving-row';

    const label = document.createElement('span');
    label.className = 'cocinado-serving-label';
    label.textContent = `Ración ${index + 1}`;

    row.appendChild(label);
    row.appendChild(makeCocinadoDaySelect(index, dayId));
    cocinadoServingsRows.appendChild(row);
  }
}

function fillCocinadoRecipeSelect(selectedRecipeId) {
  // Se rellena al abrir para que recoja las recetas creadas desde la última vez.
  const sorted = [...recipes].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  cocinadoRecipeSelect.innerHTML = sorted.length
    ? '<option value="">Selecciona una receta...</option>'
    : '<option value="">No hay recetas creadas</option>';

  sorted.forEach((recipe) => {
    const option = document.createElement('option');
    option.value = recipe.id;
    option.textContent = recipe.name;
    if (recipe.id === selectedRecipeId) option.selected = true;
    cocinadoRecipeSelect.appendChild(option);
  });
}

function openCocinadoModal({ dayId, mealId, editing, recipeId, prefillDays }) {
  if (!cocinadoRecipeModal || !cocinadoRecipeSelect) return;

  const day = COCINADOS_DAYS.find((d) => d.id === dayId);
  const meal = COCINADOS_MEALS.find((m) => m.id === mealId);

  _cocinadoTarget = { dayId, mealId };
  _cocinadoEditing = editing || null;

  if (cocinadoRecipeModalTitle) {
    cocinadoRecipeModalTitle.textContent = editing ? 'Editar ingesta' : 'Añadir ingesta';
  }
  if (cocinadoRecipeSubmitBtn) {
    cocinadoRecipeSubmitBtn.textContent = editing ? 'Guardar' : 'Añadir';
  }
  // Añadiendo no hay ingesta que eliminar.
  if (deleteCocinadoBtn) {
    deleteCocinadoBtn.hidden = !editing;
  }
  if (cocinadoRecipeModalContext) {
    cocinadoRecipeModalContext.textContent = `${meal?.name || ''} · ${day?.name || ''}`;
  }

  fillCocinadoRecipeSelect(recipeId ?? null);
  renderCocinadoServingFields(prefillDays);
  openModal(cocinadoRecipeModal);
}

function openCocinadoRecipeModal(dayId, mealId) {
  openCocinadoModal({ dayId, mealId });
}

// Editar la ingesta a la que pertenece una ración: se recuperan las raciones de
// su grupo para precargar los días, en el orden de los días de la tabla.
function openCocinadoEditModal(dayId, mealId, index) {
  const serving = getCocinadoServings(dayId, mealId)[index];
  if (!serving) return;

  // `findBatchServings` devuelve en orden de días, pero la ración 1 del modal
  // es la primera en consumirse: se pone delante para que al guardar la marca
  // siga en la misma ración y no salte al día más temprano.
  const batch = serving.batchId ? findBatchServings(serving.batchId, mealId) : [];
  const ordered = [...batch].sort((a, b) => Number(b.serving.first) - Number(a.serving.first));
  const prefillDays = ordered.length ? ordered.map((item) => item.dayId) : [dayId];

  openCocinadoModal({
    dayId,
    mealId,
    recipeId: serving.recipeId,
    prefillDays,
    editing: { batchId: serving.batchId, dayId, index },
  });
}

function closeCocinadoRecipeModal() {
  _cocinadoTarget = null;
  _cocinadoEditing = null;
  closeModal(cocinadoRecipeModal);
}

// Al cambiar de receta cambia el número de raciones: se conservan los días ya
// elegidos para las que sigan existiendo.
cocinadoRecipeSelect?.addEventListener('change', () => {
  renderCocinadoServingFields(readCocinadoServingDays());
});

cocinadoRecipeForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!_cocinadoTarget) return;

  const { dayId, mealId } = _cocinadoTarget;
  const editing = _cocinadoEditing;
  const recipeId = Number(cocinadoRecipeSelect?.value);
  if (!recipeId) return;

  const total = getCocinadoModalServings();
  let assignments;

  if (total <= 1) {
    // Una sola ración: va a la celda desde la que se abrió el modal.
    assignments = [{ dayId, first: true }];
  } else {
    // Ojo: el valor vacío de un select es '', y Number('') es 0, que es el id
    // de Domingo. Hay que descartar el vacío antes de convertirlo a número.
    const daySelects = [...cocinadoServingsRows.querySelectorAll('select')];
    if (daySelects.some((select) => select.value === '')) {
      alert('Elige un día para cada ración');
      return;
    }
    // La ración 1 es, por convenio, la primera en consumirse.
    assignments = daySelects.map((select, index) => ({
      dayId: Number(select.value),
      first: index === 0,
    }));
  }

  if (!editing) {
    addCocinadoBatch(mealId, recipeId, assignments);
  } else if (editing.batchId) {
    updateCocinadoBatch(editing.batchId, mealId, recipeId, assignments);
  } else {
    // Ración del formato anterior, sin grupo: se sustituye por una ingesta nueva.
    deleteCocinadoServingAt(editing.dayId, mealId, editing.index);
    addCocinadoBatch(mealId, recipeId, assignments);
  }

  closeCocinadoRecipeModal();
});

deleteCocinadoBtn?.addEventListener('click', () => {
  if (!_cocinadoTarget || !_cocinadoEditing) return;

  const { mealId } = _cocinadoTarget;
  const editing = _cocinadoEditing;
  // El nombre sale de la ingesta guardada, no del selector: si había cambiado
  // la receta sin guardar, lo que se borra sigue siendo la ingesta original.
  const serving = getCocinadoServings(editing.dayId, mealId)[editing.index];
  const recipe = recipes.find((r) => r.id === serving?.recipeId);

  // Como en el resto de borrados de la app: se confirma con el nombre delante.
  if (!confirm(`¿Seguro que quieres eliminar "${recipe?.name || 'esta ingesta'}"?`)) return;

  removeCocinadoBatch(editing, mealId);
  closeCocinadoRecipeModal();
});

document.getElementById('closeCocinadoRecipeModal')
  ?.addEventListener('click', closeCocinadoRecipeModal);

cocinadoRecipeModal?.addEventListener('click', (e) => {
  if (e.target === cocinadoRecipeModal) closeCocinadoRecipeModal();
});

renderCocinados();

// -----------------------
// MODAL DETALLE COCINADO
// -----------------------

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





// ----------------------
// TABS
// ----------------------
const railButtons = document.querySelectorAll('.rail-btn');
const railNav = document.querySelector('.rail');
const railNavs = document.querySelectorAll('.tabs[data-rail-nav]');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const isMobile = () => window.matchMedia('(max-width: 767px)').matches;

// Pestaña que abre cada sección del rail cuando aún no se ha visitado.
const RAIL_DEFAULT_TAB = {
  general: 'reparto',
  compras: 'shopping-list-2',
  cocina: 'cocinados',
  limpieza: 'tareas-limpieza',
  lavanderia: 'tareas-lavanderia',
  residuos: 'tareas-residuos',
};

function isKnownRail(rail) {
  return !!rail && Object.prototype.hasOwnProperty.call(RAIL_DEFAULT_TAB, rail);
}

function hideNavOnMobile() {
  if (isMobile()) {
    railNav?.classList.add('nav-hidden');
    railNavs.forEach((nav) => nav.classList.add('nav-hidden'));
  }
}

function showNav() {
  railNav?.classList.remove('nav-hidden');
  railNavs.forEach((nav) => nav.classList.remove('nav-hidden'));
}

// Sección del rail a la que pertenece una pestaña. 'recipes' está en las dos
// barras, así que quien conozca el rail de origen debe pasarlo explícitamente.
function railOfTab(tabId) {
  const btn = document.querySelector(`.tabs[data-rail-nav] .tab-btn[data-tab="${tabId}"]`);
  return btn?.closest('.tabs')?.dataset.railNav || 'compras';
}

function setActiveRail(rail) {
  railButtons.forEach((b) => b.classList.toggle('active', b.dataset.rail === rail));
  railNavs.forEach((nav) => { nav.hidden = nav.dataset.railNav !== rail; });
  localStorage.setItem(ACTIVE_RAIL_KEY, rail);
}

// Abre una pestaña. Cada barra conserva su propio botón activo, de modo que al
// volver a una sección del rail se recupera la pestaña en la que se estaba.
function activateTab(tabId, rail) {
  const targetRail = isKnownRail(rail) ? rail : railOfTab(tabId);
  const nav = document.querySelector(`.tabs[data-rail-nav="${targetRail}"]`);
  const btnToActivate = nav?.querySelector(`.tab-btn[data-tab="${tabId}"]`);

  if (!btnToActivate || !document.getElementById(tabId)) return false;

  setActiveRail(targetRail);
  localStorage.setItem(ACTIVE_TAB_KEY, tabId);

  nav.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  btnToActivate.classList.add('active');

  tabContents.forEach((section) => {
    section.classList.toggle('active', section.id === tabId);
  });

  return true;
}

railButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const rail = btn.dataset.rail;
    const nav = document.querySelector(`.tabs[data-rail-nav="${rail}"]`);
    const current = nav?.querySelector('.tab-btn.active');

    activateTab(current?.dataset.tab || RAIL_DEFAULT_TAB[rail], rail);

    // En móvil el rail abre la barra de la sección: no se salta al contenido.
    showNav();
  });
});

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const tabId = btn.dataset.tab;
    const rail = btn.closest('.tabs')?.dataset.railNav;

    activateTab(tabId, rail);

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
  const savedRail = localStorage.getItem(ACTIVE_RAIL_KEY);

  if (isKnownRail(savedRail)) setActiveRail(savedRail);

  if (!savedTabId) return;

  // Migrar tab antigua 'shopping-list' a 'shopping-list-2'
  if (savedTabId === 'shopping-list') savedTabId = 'shopping-list-2';

  if (!activateTab(savedTabId, savedRail) && !activateTab(savedTabId)) return;

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
const lista2TypeSelect = document.getElementById('lista2TypeSelect');
const lista2WeeklyFields = document.getElementById('lista2WeeklyFields');

// Las listas creadas antes de existir el tipo son todas semanales: tienen
// comercio y rango de fechas, así que la ausencia de `type` se lee como
// 'semanal' sin tocar el registro guardado.
function isLista2Mensual(item) {
  return item.type === 'mensual';
}

const LISTA2_MENSUAL_TITLE = 'Compra mensual';
const LISTA2_SEMANAL_TITLE = 'Compra semanal';

// Título de una lista. Las semanales creadas cuando se elegía comercio
// conservan su `storeKey` y siguen mostrándose con el nombre del comercio.
function lista2Title(item) {
  if (isLista2Mensual(item)) return LISTA2_MENSUAL_TITLE;
  if (item.storeKey) return STORE_LABELS[item.storeKey] || item.storeKey;
  return LISTA2_SEMANAL_TITLE;
}

// Fecha de creación de una lista. Las creadas antes de existir `createdAt` no
// lo tienen, pero su id es el `Date.now()` del momento en que se crearon, así
// que sirve de respaldo sin necesidad de migrar nada.
function lista2CreatedAtISO(item) {
  const ts = item.createdAt ?? item.id;
  if (!ts) return '';
  return toISODateString(new Date(ts));
}

// En una lista mensual conviven consumibles e ingredientes básicos de
// despensa, así que se busca en las dos tablas.
function findLista2Record(item, name) {
  if (isLista2Mensual(item)) {
    return consumables.find((c) => c.name === name)
      || ingredients.find((i) => i.name === name)
      || null;
  }
  return ingredients.find((i) => i.name === name) || null;
}

// Los campos del bloque semanal solo son obligatorios cuando ese bloque se ve:
// si siguieran siendo `required` estando ocultos, el navegador bloquearía el
// envío del formulario mensual sin poder señalar dónde está el error.
function syncLista2TypeFields() {
  const isWeekly = lista2TypeSelect?.value === 'semanal';
  lista2WeeklyFields?.classList.toggle('hidden', !isWeekly);
  [lista2Start, lista2End].forEach((el) => {
    if (el) el.required = isWeekly;
  });
}
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
// Comercios marcados en el filtro de "Editar cantidades". Vacío = sin filtrar.
// No se guarda: cada vez que se abre la vista se empieza sin filtro.
let _lista2ShopStores = new Set();

function showLista2Detail() {
  lista2DetailView?.classList.add('is-visible');
  lista2ListView?.classList.add('hidden');
}

function hideLista2Detail() {
  closeLista2Sheet();
  closeLista2ShopView();
  currentLista2StoreKey = null;
  if (lista2DetailHeaderActions) lista2DetailHeaderActions.hidden = false;
  lista2DetailView?.classList.remove('is-visible');
  lista2ListView?.classList.remove('hidden');
  renderLista2();
}

function openLista2ShopView(item) {
  _lista2ShopStores = new Set();
  document.getElementById('lista2ShopFilterDropdown')?.classList.add('hidden');
  updateLista2ShopFilterBadge();
  renderLista2ShopList(item);
  lista2ShopViewEl?.classList.add('is-visible');
}

function closeLista2ShopView() {
  document.getElementById('lista2ShopFilterDropdown')?.classList.add('hidden');
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

lista2TypeSelect?.addEventListener('change', syncLista2TypeFields);

function openLista2ModalHandler() {
  if (lista2TypeSelect) lista2TypeSelect.value = '';
  syncLista2TypeFields();
  openModal(lista2Modal);
}

document.getElementById('openLista2Modal')?.addEventListener('click', openLista2ModalHandler);
document.getElementById('openLista2ModalDesktop')?.addEventListener('click', openLista2ModalHandler);

document.getElementById('closeLista2Modal')?.addEventListener('click', () => {
  closeModal(lista2Modal);
});

document.getElementById('backToLista2')?.addEventListener('click', hideLista2Detail);

lista2Form?.addEventListener('submit', (e) => {
  e.preventDefault();

  const type = lista2TypeSelect?.value;
  if (!type) return;

  if (type === 'mensual') {
    // Todos los consumibles activos, de cualquier comercio, más los
    // ingredientes que sean a la vez de compra mensual y básicos de despensa.
    const names = new Set();
    consumables
      .filter((c) => c.active !== false)
      .forEach((c) => names.add(c.name));
    ingredients
      .filter((i) => i.shoppingType === 'mensual' && i.pantry)
      .forEach((i) => names.add(i.name));

    const ingredientNames = [...names]
      .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

    lista2Items.push({
      id: Date.now(),
      type: 'mensual',
      createdAt: Date.now(),
      ingredientNames,
    });

    saveLista2Items();
    closeModal(lista2Modal);
    lista2Form.reset();
    syncLista2TypeFields();
    [lista2Start, lista2End].forEach(input => syncLista2DateWrapper(input));
    renderLista2();
    return;
  }

  const start = lista2Start?.value;
  const end = lista2End?.value;

  if (!start || !end) return;

  const entries = getExpandedCalendarEntriesInRange(start, end);

  const ingredientIdSet = new Set();
  entries.forEach((entry) => {
    const recipe = recipes.find((r) => r.id === entry.recipeId);
    if (!recipe) return;
    recipe.ingredients.forEach(({ ingredientId }) => ingredientIdSet.add(ingredientId));
  });

  // Añadir siempre los básicos de despensa, sea cual sea su comercio
  ingredients.forEach((ing) => {
    if (ing.pantry) ingredientIdSet.add(ing.id);
  });

  const ingredientNames = [...ingredientIdSet]
    .map((id) => ingredients.find((i) => i.id === id))
    .filter((ing) => ing && ing.shoppingType === 'semanal')
    .map((ing) => ing.name)
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

  lista2Items.push({
    id: Date.now(),
    type: 'semanal',
    createdAt: Date.now(),
    startDate: start,
    endDate: end,
    ingredientNames,
  });

  saveLista2Items();
  closeModal(lista2Modal);
  lista2Form.reset();
  syncLista2TypeFields();
  [lista2Start, lista2End].forEach(input => syncLista2DateWrapper(input));
  renderLista2();
});

const lista2IngredientSheet = document.getElementById('lista2IngredientSheet');
const lista2SheetTitle = document.getElementById('lista2SheetTitle');
const lista2SheetProduct = document.getElementById('lista2SheetProduct');

// Copiar al portapapeles. La API moderna necesita contexto seguro y permiso;
// si no está disponible se copia la selección de un campo temporal, que es lo
// que entienden los navegadores antiguos.
async function copyToClipboard(text) {
  if (!text) return false;

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.top = '0';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { copied = false; }
    helper.remove();
    return copied;
  }
}

function resetCopyCommentBtn(btn) {
  clearTimeout(btn._copyResetTimer);
  btn.classList.remove('is-copied');
  const label = btn.querySelector('span');
  if (label) label.textContent = 'Copiar';
}

// El comentario se copia como texto plano: el formato solo es para verlo.
// El propio botón avisa de lo que ha pasado y se repone al rato.
async function copyLista2Comment(commentEl, btn) {
  const copied = await copyToClipboard(commentEl.innerText.trim());

  const label = btn.querySelector('span');
  if (label) label.textContent = copied ? 'Copiado' : 'No se ha podido copiar';
  btn.classList.toggle('is-copied', copied);

  clearTimeout(btn._copyResetTimer);
  btn._copyResetTimer = setTimeout(() => resetCopyCommentBtn(btn), 2000);
}

function openLista2Sheet(ingredientName) {
  // En una compra mensual el nombre puede ser de un consumible: se resuelve en
  // el mismo orden que las filas de la lista (consumibles primero) y el panel
  // se queda solo con las secciones que le sirven.
  const item = lista2Items.find((i) => i.id === currentLista2ItemId);
  const consumable = item && isLista2Mensual(item)
    ? consumables.find((c) => c.name === ingredientName)
    : null;
  const ingredient = consumable || ingredients.find((i) => i.name === ingredientName);
  if (!ingredient) return;
  const isConsumable = !!consumable;

  document.querySelectorAll('#lista2DetailList li.is-selected')
    .forEach(r => r.classList.remove('is-selected'));
  const activeLi = document.querySelector(`#lista2DetailList li[data-name="${CSS.escape(ingredientName)}"]`);
  if (activeLi) activeLi.classList.add('is-selected');

  if (lista2SheetTitle) lista2SheetTitle.textContent = ingredient.name;
  if (lista2SheetProduct) lista2SheetProduct.textContent = ingredient.product || '—';

  const editBtn = document.getElementById('lista2SheetEditBtn');
  if (editBtn) {
    const editLabel = isConsumable ? 'Editar consumible' : 'Editar ingrediente';
    editBtn.setAttribute('aria-label', editLabel);
    const editBtnText = editBtn.querySelector('span');
    if (editBtnText) editBtnText.textContent = editLabel;

    editBtn.onclick = () => {
      if (lista2SheetDropdown) lista2SheetDropdown.hidden = true;
      if (isConsumable) {
        activateTab('consumables', 'compras');
        // El panel de edición es único y se lleva a la pestaña desde la que se
        // abre: aquí llega desde Listas, así que vuelve a la de Compras.
        moveConsumablePanelTo(consumableList);
        startEditConsumable(ingredient.id);
      } else {
        activateTab('ingredients', 'compras');
        startEditIngredient(ingredient.id);
      }
    };
  }

  // Receta y despensa: un consumible no tiene nada que poner en ellas.
  document.getElementById('lista2SheetConversionSection')?.toggleAttribute('hidden', isConsumable);
  document.getElementById('lista2SheetPantrySection')?.toggleAttribute('hidden', isConsumable);
  document.getElementById('lista2SheetPlannedSection')?.toggleAttribute('hidden', isConsumable);

  const conversionEl = document.getElementById('lista2SheetConversion');
  if (conversionEl && !isConsumable) {
    if (ingredient.productUnit && ingredient.formato != null && ingredient.formato !== '') {
      conversionEl.textContent = `1 ${ingredient.productUnit} = ${ingredient.formato} ${ingredient.unit}`;
      conversionEl.classList.remove('lista2-sheet-pantry-empty');
    } else {
      conversionEl.textContent = 'Información no disponible.';
      conversionEl.classList.add('lista2-sheet-pantry-empty');
    }
  }

  const pantryEl = document.getElementById('lista2SheetPantry');
  if (pantryEl && !isConsumable) {
    if (ingredient.pantry && ingredient.minQuantity != null && ingredient.minQuantity !== '') {
      pantryEl.textContent = `Cantidad mínima: ${formatMinQty(ingredient)}`;
      pantryEl.classList.remove('lista2-sheet-pantry-empty');
    } else {
      pantryEl.textContent = 'Este ingrediente no es un básico de despensa.';
      pantryEl.classList.add('lista2-sheet-pantry-empty');
    }
  }

  const recipesList = document.getElementById('lista2SheetRecipes');
  if (recipesList && !isConsumable) {
    recipesList.innerHTML = '';

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

  // Sección "Comentario". Sin comentario no hay nada que copiar: el botón no
  // se ve y queda el aviso de que está vacío.
  const commentEl = document.getElementById('lista2SheetComment');
  const copyCommentBtn = document.getElementById('lista2SheetCopyComment');
  if (commentEl) {
    const hasComment = !!ingredient.comment?.trim();
    commentEl.classList.toggle('lista2-sheet-pantry-empty', !hasComment);
    if (hasComment) {
      setRichTextValue(commentEl, ingredient.comment);
    } else {
      commentEl.textContent = 'Sin comentario.';
    }
    if (copyCommentBtn) {
      copyCommentBtn.hidden = !hasComment;
      resetCopyCommentBtn(copyCommentBtn);
      copyCommentBtn.onclick = () => copyLista2Comment(commentEl, copyCommentBtn);
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
      // Calcular cantidad planificada sumando desde el calendario. Un
      // consumible no está en ninguna receta: se salta el cálculo.
      let total = 0;
      if (!isConsumable) {
        const entries = getExpandedCalendarEntriesInRange(lista2Item.startDate, lista2Item.endDate);
        entries.forEach((entry) => {
          const recipe = recipes.find((r) => r.id === entry.recipeId);
          if (!recipe) return;
          const ri = recipe.ingredients.find((x) => x.ingredientId === ingredient.id);
          if (!ri) return;
          total += ri.quantity;
        });
      }
      const calculatedPlanned = total > 0 ? total : null;

      const hasMinQuantity = ingredient.minQuantity != null && ingredient.minQuantity !== '';
      const isPantry = ingredient.pantry && hasMinQuantity;
      if (isConsumable) {
        // Lo único que aporta un consumible es su cantidad mínima, y no lleva
        // unidad de receta.
        if (hasMinQuantity) {
          const minQty = ingredient.unit ? formatMinQty(ingredient) : ingredient.minQuantity;
          shoppingLabelEl.textContent = `Cantidad mínima: ${minQty}`;
          shoppingLabelEl.classList.remove('lista2-sheet-pantry-empty');
        } else {
          shoppingLabelEl.textContent = 'Sin cantidad mínima.';
          shoppingLabelEl.classList.add('lista2-sheet-pantry-empty');
        }
      } else if (isPantry) {
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

const ingredientEditDropdown = document.getElementById('ingredientEditDropdown');

document.getElementById('ingredientEditMenuBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  ingredientEditDropdown.hidden = !ingredientEditDropdown.hidden;
});

document.addEventListener('click', () => {
  if (ingredientEditDropdown && !ingredientEditDropdown.hidden) {
    ingredientEditDropdown.hidden = true;
  }
});

document.getElementById('ingredientEditDeleteBtn')?.addEventListener('click', () => {
  ingredientEditDropdown.hidden = true;
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

const consumableEditDropdown = document.getElementById('consumableEditDropdown');

document.getElementById('consumableEditMenuBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  consumableEditDropdown.hidden = !consumableEditDropdown.hidden;
});

document.addEventListener('click', () => {
  if (consumableEditDropdown && !consumableEditDropdown.hidden) {
    consumableEditDropdown.hidden = true;
  }
});

document.getElementById('consumableEditDuplicateBtn')?.addEventListener('click', () => {
  consumableEditDropdown.hidden = true;
  if (!editingConsumableId) return;
  duplicateConsumable(editingConsumableId);
});

document.getElementById('consumableEditDeleteBtn')?.addEventListener('click', () => {
  consumableEditDropdown.hidden = true;
  if (!editingConsumableId) return;
  const consumable = consumables.find(c => c.id === editingConsumableId);
  if (!consumable) return;
  const ok = confirm(`¿Seguro que quieres eliminar "${consumable.name}"?`);
  if (ok) {
    closeConsumablePanel();
    deleteConsumable(editingConsumableId);
    editingConsumableId = null;
  }
});

const recipeEditDropdown = document.getElementById('recipeEditDropdown');

document.getElementById('recipeEditMenuBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  recipeEditDropdown.hidden = !recipeEditDropdown.hidden;
});

document.addEventListener('click', () => {
  if (recipeEditDropdown && !recipeEditDropdown.hidden) {
    recipeEditDropdown.hidden = true;
  }
});

document.getElementById('recipeEditDeleteBtn')?.addEventListener('click', () => {
  recipeEditDropdown.hidden = true;
  if (!editingRecipeId) return;
  const recipe = recipes.find(r => r.id === editingRecipeId);
  if (!recipe) return;
  const ok = confirm(`¿Seguro que quieres eliminar "${recipe.name}"?`);
  if (ok) {
    recipes = recipes.filter(r => r.id !== editingRecipeId);
    calendarEntries = calendarEntries.filter(e => e.recipeId !== editingRecipeId);
    saveRecipes();
    saveCalendarEntries();
    closeRecipePanel();
    renderRecipes();
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

// Comercios que se pueden filtrar: solo los que tiene algún ingrediente de la
// lista, en el orden configurado en Ajustes. El "Sin comercio" va al final.
function lista2ShopStoreOptions(item) {
  const present = new Set(item.ingredientNames.map((name) => lista2StoreKeyOf(item, name)));
  const opts = settingsOptions('shared-store', [...present])
    .filter(({ value }) => present.has(value));
  if (present.has('')) opts.push({ value: '', label: 'Sin comercio' });
  return opts;
}

function updateLista2ShopFilterBadge() {
  const btn = document.getElementById('openLista2ShopFilter');
  const badge = document.getElementById('lista2ShopFilterBadge');
  if (!btn || !badge) return;
  const count = _lista2ShopStores.size;
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove('hidden');
    btn.classList.add('is-active');
  } else {
    badge.classList.add('hidden');
    btn.classList.remove('is-active');
  }
}

function renderLista2ShopFilterPanel(item) {
  const container = document.getElementById('lista2ShopFilterContent');
  if (!container) return;
  container.innerHTML = '';

  const section = document.createElement('div');
  section.className = 'filter-section';
  const title = document.createElement('div');
  title.className = 'filter-section-title';
  title.textContent = 'Comercio';
  section.appendChild(title);

  const opts = lista2ShopStoreOptions(item);
  if (opts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'filter-option';
    empty.textContent = 'No hay comercios.';
    section.appendChild(empty);
  }

  opts.forEach(({ value: key, label }) => {
    const opt = document.createElement('label');
    opt.className = 'filter-option';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = key;
    cb.checked = _lista2ShopStores.has(key);
    cb.addEventListener('change', () => {
      if (cb.checked) _lista2ShopStores.add(key);
      else _lista2ShopStores.delete(key);
      renderLista2ShopList(item);
      updateLista2ShopFilterBadge();
    });
    opt.appendChild(cb);
    opt.appendChild(document.createTextNode(label));
    section.appendChild(opt);
  });

  container.appendChild(section);
}

const lista2ShopFilterBtn = document.getElementById('openLista2ShopFilter');
const lista2ShopFilterDropdown = document.getElementById('lista2ShopFilterDropdown');

if (lista2ShopFilterBtn && lista2ShopFilterDropdown) {
  lista2ShopFilterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (lista2ShopFilterDropdown.classList.contains('hidden')) {
      const item = lista2Items.find((i) => i.id === currentLista2ItemId);
      if (!item) return;
      renderLista2ShopFilterPanel(item);
      lista2ShopFilterDropdown.classList.remove('hidden');
    } else {
      lista2ShopFilterDropdown.classList.add('hidden');
    }
  });

  document.addEventListener('click', (e) => {
    if (!lista2ShopFilterDropdown.classList.contains('hidden') && !lista2ShopFilterDropdown.contains(e.target)) {
      lista2ShopFilterDropdown.classList.add('hidden');
    }
  });
}

document.getElementById('clearLista2ShopFilters')?.addEventListener('click', () => {
  _lista2ShopStores = new Set();
  const item = lista2Items.find((i) => i.id === currentLista2ItemId);
  if (item) {
    renderLista2ShopList(item);
    renderLista2ShopFilterPanel(item);
  }
  updateLista2ShopFilterBadge();
});

// Texto de cantidad de una fila, compartido por la vista por tipo y la vista
// por comercio. Un consumible no tiene unidad ni conversión: solo su cantidad
// mínima, o la cantidad que se le haya puesto a mano.
function lista2QtyText(item, record, name, totalQty) {
  const shopOverride = (lista2ShopQty[item.id] || {})[name];
  const isOverridden = shopOverride != null;
  // Un consumible no tiene unidad de receta ni conversión de producto; un
  // ingrediente sí. Manda el registro, no el tipo de lista.
  const hasUnits = !!record.unit;
  const hasMin = record.minQuantity != null && record.minQuantity !== '';
  let text;

  if (isOverridden && !hasUnits) {
    text = String(shopOverride);
  } else if (isOverridden) {
    const formato = parseFloat(record.formato);
    const hasConversion = record.productUnit && record.formato != null && record.formato !== '' && formato > 0;
    if (hasConversion) {
      const labels = PRODUCT_UNIT_LABELS[record.productUnit];
      const unitLabel = labels ? (shopOverride === 1 ? labels.singular : labels.plural) : record.productUnit;
      text = `${shopOverride} ${unitLabel}`;
    } else {
      text = `${shopOverride} ${record.unit}`;
    }
  } else if (!hasUnits) {
    text = record.minQuantity || '';
  } else if (isLista2Mensual(item)) {
    // En una lista mensual no hay planificación: los ingredientes que entran
    // son básicos de despensa, así que lo que aplica es su cantidad mínima.
    text = hasMin ? formatMinQty(record) : '';
  } else {
    const isPantryWithMin = record.pantry && hasMin;
    text = isPantryWithMin ? formatMinQty(record) : formatIngredientQty(record, totalQty);
  }

  return { text, isOverridden };
}

function lista2StoreKeyOf(item, name) {
  return findLista2Record(item, name)?.store || '';
}

const LISTA2_LOCATION_ORDER = [
  ...Object.keys(LOCATION_LABELS),
  'sin-ubicacion',
];

function formatIngredientQty(ingredient, rawQty) {
  if (rawQty == null || isNaN(rawQty)) return null;
  const formato = parseFloat(ingredient.formato);
  if (ingredient.productUnit && ingredient.formato != null && ingredient.formato !== '' && formato > 0) {
    // En el supermercado solo se compran unidades enteras del formato: 1 g de un
    // bote de 100 g sigue siendo 1 bote. El toFixed absorbe el ruido de coma
    // flotante para que 3 × 0,1 / 0,1 no acabe siendo 4.
    const converted = parseFloat((rawQty / formato).toFixed(6));
    const display = Math.ceil(converted);
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
      if (!ing) return;
      // Las listas creadas cuando se elegía comercio siguen ciñéndose a él.
      if (item.storeKey && ing.store !== item.storeKey) return;
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
    p.textContent = isLista2Mensual(item)
      ? 'No hay consumibles activos.'
      : 'No hay ingredientes planificados en este periodo.';
    lista2DetailList.appendChild(p);
    return;
  }

  // El mapa de cantidades sale del calendario y del rango de fechas: en una
  // lista mensual no hay ni una cosa ni la otra.
  const totalQtyByIngredient = isLista2Mensual(item) ? new Map() : buildTotalQtyMap(item);

  if (lista2ShopMode) {
    const shopQty = lista2ShopQty[item.id] || {};

    const locationOrder = isLista2Mensual(item)
      ? [...settingsOrder('shared-location'), 'sin-ubicacion']
      : LISTA2_LOCATION_ORDER;

    const locationKeyOf = (name) => findLista2Record(item, name)?.location || 'sin-ubicacion';

    const sorted = [...item.ingredientNames].sort((a, b) => {
      const iA = locationOrder.indexOf(locationKeyOf(a));
      const iB = locationOrder.indexOf(locationKeyOf(b));
      const oA = iA === -1 ? 999 : iA;
      const oB = iB === -1 ? 999 : iB;
      if (oA !== oB) return oA - oB;
      return a.localeCompare(b, 'es', { sensitivity: 'base' });
    });

    let currentLocationKey = null;
    sorted.forEach((name) => {
      const ingredient = findLista2Record(item, name);
      const locationKey = locationKeyOf(name);

      if (locationKey !== currentLocationKey) {
        currentLocationKey = locationKey;
        const locationHeader = document.createElement('li');
        locationHeader.className = 'lista2-shop-location-header';
        if (locationKey === 'sin-ubicacion') {
          locationHeader.textContent = 'Sin ubicación';
        } else {
          locationHeader.textContent = isLista2Mensual(item)
            ? settingsLabel('shared-location', locationKey)
            : (LOCATION_LABELS[locationKey] || 'Sin ubicación');
        }
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
        let prefix, qtyText;
        if (isLista2Mensual(item)) {
          // Un consumible no tiene unidad de receta ni cantidad planificada:
          // lo único que aporta es su cantidad mínima.
          prefix = 'Mínima';
          qtyText = ingredient.minQuantity || '';
        } else {
          const totalQty = totalQtyByIngredient.get(name);
          const isPantry = ingredient.pantry && ingredient.minQuantity != null && ingredient.minQuantity !== '';
          prefix = isPantry ? 'Mínima' : 'Planificada';
          qtyText = isPantry ? formatMinQty(ingredient) : formatIngredientQty(ingredient, totalQty);
        }

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
      const ingredient = findLista2Record(item, name);
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
        const { text: qtyText, isOverridden } =
          lista2QtyText(item, ingredient, name, totalQtyByIngredient.get(name));
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
    p.textContent = isLista2Mensual(item)
      ? 'No hay consumibles activos.'
      : 'No hay ingredientes planificados en este periodo.';
    lista2ShopList.appendChild(p);
    return;
  }

  // El filtro de comercio solo esconde filas: no toca las cantidades ni el
  // progreso de la lista. Sin comercios marcados se ven todas.
  const visibleNames = _lista2ShopStores.size > 0
    ? item.ingredientNames.filter((name) => _lista2ShopStores.has(lista2StoreKeyOf(item, name)))
    : item.ingredientNames;

  if (visibleNames.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'No hay nada de los comercios seleccionados.';
    lista2ShopList.appendChild(p);
    return;
  }

  // El mapa de cantidades sale del calendario y del rango de fechas: en una
  // lista mensual no hay ni una cosa ni la otra.
  const totalQtyByIngredient = isLista2Mensual(item) ? new Map() : buildTotalQtyMap(item);
  const shopQty = lista2ShopQty[item.id] || {};

  // Las ubicaciones son una lista única: manda el orden configurado en Ajustes.
  const locationOrder = [...settingsOrder('shared-location'), 'sin-ubicacion'];

  const locationKeyOf = (name) => findLista2Record(item, name)?.location || 'sin-ubicacion';

  // La compra mensual son consumibles: se agrupa por estancia y dentro de cada
  // una se respeta el orden de la pestaña Consumibles (por ubicación, y dentro
  // de una ubicación el que se haya dejado arrastrando las filas). Las listas
  // semanales son ingredientes, que no están en esa pestaña: siguen agrupadas
  // por ubicación y en orden alfabético.
  const byRoom = isLista2Mensual(item);

  const roomOrder = settingsOrder('shared-room');
  const sectionKeyOf = (name) => (byRoom
    ? locationRoomKey(findLista2Record(item, name)?.location)
    : locationKeyOf(name));

  const rankIn = (order, key, missing) => {
    const i = order.indexOf(key);
    return i === -1 ? missing : i;
  };
  // Sin estancia, al final.
  const sectionRank = (name) => {
    const key = sectionKeyOf(name);
    if (byRoom) return key ? rankIn(roomOrder, key, 2000) : 3000;
    return rankIn(locationOrder, key, 999);
  };
  // Posición en `consumables`, que es el orden que se arrastra a mano.
  const consumableRank = (name) => {
    const i = consumables.findIndex((c) => c.name === name);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };

  const sorted = [...visibleNames].sort((a, b) => {
    const section = sectionRank(a) - sectionRank(b);
    if (section !== 0) return section;

    if (!byRoom) return a.localeCompare(b, 'es', { sensitivity: 'base' });

    const location = rankIn(locationOrder, locationKeyOf(a), 999)
      - rankIn(locationOrder, locationKeyOf(b), 999);
    if (location !== 0) return location;
    return consumableRank(a) - consumableRank(b);
  });

  let currentSectionKey = null;
  let currentLocationKey = null;
  let firstSection = true;
  sorted.forEach((name) => {
    const ingredient = findLista2Record(item, name);
    const sectionKey = sectionKeyOf(name);

    if (firstSection || sectionKey !== currentSectionKey) {
      firstSection = false;
      currentSectionKey = sectionKey;
      // Al cambiar de estancia, su primer subgrupo vuelve a titularse aunque
      // sea de la misma ubicación que el último de la estancia anterior.
      currentLocationKey = null;
      const locationHeader = document.createElement('li');
      locationHeader.className = 'lista2-shop-location-header';
      if (byRoom) {
        locationHeader.textContent = sectionKey
          ? settingsLabel('shared-room', sectionKey)
          : 'Sin estancia';
      } else {
        locationHeader.textContent = sectionKey === 'sin-ubicacion'
          ? 'Sin ubicación'
          : settingsLabel('shared-location', sectionKey);
      }
      lista2ShopList.appendChild(locationHeader);
    }

    // Dentro de cada estancia, un subgrupo por ubicación. En las listas
    // semanales la sección ya es la ubicación, así que no hay subgrupo.
    if (byRoom) {
      const locationKey = locationKeyOf(name);
      if (locationKey !== currentLocationKey) {
        currentLocationKey = locationKey;
        const subHeader = document.createElement('li');
        subHeader.className = 'lista2-shop-sublocation-header';
        subHeader.textContent = locationKey === 'sin-ubicacion'
          ? 'Sin ubicación'
          : settingsLabel('shared-location', locationKey);
        lista2ShopList.appendChild(subHeader);
      }
    }

    const li = document.createElement('li');
    li.dataset.name = name;
    li.className = 'lista2-shop-item';

    const nameGroup = document.createElement('div');
    nameGroup.className = 'lista2-name-group';

    const nameEl = document.createElement('span');
    nameEl.className = 'shopping-name';
    nameEl.textContent = name;
    nameGroup.appendChild(nameEl);

    if (ingredient) {
      let prefix, qtyText;
      if (isLista2Mensual(item)) {
        // Tanto los consumibles como los ingredientes de una lista mensual
        // aportan su cantidad mínima; solo los ingredientes llevan unidad.
        prefix = 'Mínima';
        const hasMin = ingredient.minQuantity != null && ingredient.minQuantity !== '';
        qtyText = hasMin
          ? (ingredient.unit ? formatMinQty(ingredient) : String(ingredient.minQuantity))
          : '';
      } else {
        const totalQty = totalQtyByIngredient.get(name);
        const isPantry = ingredient.pantry && ingredient.minQuantity != null && ingredient.minQuantity !== '';
        prefix = isPantry ? 'Mínima' : 'Planificada';
        qtyText = isPantry ? formatMinQty(ingredient) : formatIngredientQty(ingredient, totalQty);
      }
      // La cantidad y el aviso de caducado comparten línea, debajo del nombre.
      const meta = document.createElement('div');
      meta.className = 'lista2-shop-meta';

      const byline = document.createElement('span');
      byline.className = 'lista2-ingredient-qty';
      if (qtyText) byline.textContent = `${prefix}: ${qtyText}`;
      meta.appendChild(byline);

      // Caducado: para los que caducan este mes o ya caducaron. Aquí va solo
      // el texto en rojo, separado de la cantidad por un punto; la alarma se
      // queda para la columna «Caducidad» de las tablas.
      if (expiryStatus(ingredient.expiryDate) === 'due') {
        if (byline.textContent) {
          const separator = document.createElement('span');
          separator.className = 'lista2-shop-meta-separator';
          separator.textContent = '·';
          meta.appendChild(separator);
        }
        const expired = document.createElement('span');
        expired.className = 'lista2-shop-expired';
        expired.textContent = 'Caducado';
        meta.appendChild(expired);
      }

      nameGroup.appendChild(meta);
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
  currentLista2StoreKey = null;
  if (lista2DetailHeaderActions) lista2DetailHeaderActions.hidden = false;
  lista2ShopMode = false;
  const shopBtn = document.getElementById('lista2ShopModeBtn');
  if (shopBtn) shopBtn.classList.remove('is-active');

  closeLista2Sheet();

  if (lista2DetailTitle) {
    lista2DetailTitle.textContent = lista2Title(item);
  }
  if (lista2DetailMeta) {
    lista2DetailMeta.textContent = isLista2Mensual(item)
      ? formatDateShort(lista2CreatedAtISO(item))
      : `${formatDateShort(item.startDate)} – ${formatDateShort(item.endDate)}`;
  }
  updateLista2Progress(item);

  renderLista2DetailList(item);
  showLista2Detail();
}

// ── Vista "Por comercio" ──────────────────────────────────────────────
// Reagrupa los elementos de todas las listas (mensuales y semanales) por
// comercio. No crea listas nuevas: cada fila sigue apuntando a la lista de
// origen, así que marcar un elemento aquí lo marca también en su lista.

let _lista2View = 'type';
let currentLista2StoreKey = null;

const lista2StoreGroupsContainer = document.getElementById('lista2StoreGroupsContainer');
const lista2DetailHeaderActions = document.querySelector('.lista2-detail-header-actions');

// Nombre visible de un comercio. La clave puede venir de la lista de comercios
// de Ingredientes o de la de Consumibles, que se configuran por separado.
function lista2StoreLabel(key) {
  if (!key) return 'Sin comercio';
  return settingsLabel('shared-store', key);
}

// Orden de los comercios: primero el configurado en Ingredientes, después los
// que solo existan en Consumibles, y al final los sueltos y el "sin comercio".
function lista2StoreRank(key) {
  if (!key) return 3000;
  const i = settingsOrder('shared-store').indexOf(key);
  return i === -1 ? 2000 : i;
}

// Map(comercio -> Map(nombre -> { name, listIds, sourceItem })).
// Un mismo nombre puede aparecer en varias listas: se muestra una sola vez y
// se guardan todas sus procedencias para marcarlo en todas a la vez.
function buildLista2StoreGroups() {
  const groups = new Map();

  lista2Items.forEach((item) => {
    item.ingredientNames.forEach((name) => {
      const key = lista2StoreKeyOf(item, name);
      if (!groups.has(key)) groups.set(key, new Map());
      const byName = groups.get(key);
      if (!byName.has(name)) byName.set(name, { name, listIds: [], sourceItem: item });
      byName.get(name).listIds.push(item.id);
    });
  });

  return groups;
}

function lista2EntryDone(entry) {
  return entry.listIds.every((id) => !!(lista2Checked[id] || {})[entry.name]);
}

// Cantidad 0 significa "no hace falta comprarlo": no cuenta para el progreso,
// igual que en la vista por tipo.
function lista2EntrySkipped(entry) {
  return entry.listIds.every((id) => (lista2ShopQty[id] || {})[entry.name] === 0);
}

function lista2GroupProgress(byName) {
  const entries = [...byName.values()].filter((e) => !lista2EntrySkipped(e));
  return {
    done: entries.filter(lista2EntryDone).length,
    total: entries.length,
  };
}

function renderLista2StoreGroups() {
  if (!lista2StoreGroupsContainer) return;
  lista2StoreGroupsContainer.innerHTML = '';

  const groups = buildLista2StoreGroups();

  // Un comercio sin nada que comprar (todos sus elementos a cantidad 0) se
  // oculta: no aportaría nada y su contador sería siempre X/0.
  const visibleKeys = [...groups.keys()]
    .filter((key) => lista2GroupProgress(groups.get(key)).total > 0)
    .sort((a, b) => lista2StoreRank(a) - lista2StoreRank(b));

  if (visibleKeys.length === 0) {
    const p = document.createElement('p');
    p.className = 'lista2-empty';
    p.textContent = lista2Items.length === 0
      ? 'Crea una nueva lista para empezar.'
      : 'No hay nada que comprar.';
    lista2StoreGroupsContainer.appendChild(p);
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'store-list';

  visibleKeys
    .forEach((storeKey) => {
      const byName = groups.get(storeKey);
      const { done, total } = lista2GroupProgress(byName);

      const row = document.createElement('div');
      row.className = 'store-row';
      row.innerHTML = `
        <div class="store-row-left">
          <div class="store-row-name">${lista2StoreLabel(storeKey)}</div>
        </div>
        <span class="lista2-progress">${done}/${total}</span>
        <span class="recipe-row-icon" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      `;
      row.addEventListener('click', () => openLista2StoreDetail(storeKey));
      wrapper.appendChild(row);
    });

  lista2StoreGroupsContainer.appendChild(wrapper);
}

function openLista2StoreDetail(storeKey) {
  currentLista2ItemId = null;
  currentLista2StoreKey = storeKey;
  closeLista2Sheet();

  // Esta lista es virtual: no se puede eliminar ni editar cantidades.
  if (lista2DetailHeaderActions) lista2DetailHeaderActions.hidden = true;

  if (lista2DetailTitle) lista2DetailTitle.textContent = lista2StoreLabel(storeKey);
  if (lista2DetailMeta) lista2DetailMeta.textContent = '';

  renderLista2StoreDetailList(storeKey);
  showLista2Detail();
}

function updateLista2StoreProgress(byName) {
  if (!lista2DetailProgress) return;
  const { done, total } = lista2GroupProgress(byName);
  lista2DetailProgress.textContent = `${done}/${total}`;
}

function renderLista2StoreDetailList(storeKey) {
  if (!lista2DetailList) return;
  lista2DetailList.innerHTML = '';

  const byName = buildLista2StoreGroups().get(storeKey);

  // Los elementos con cantidad 0 no hay que comprarlos: no se listan, igual
  // que tampoco cuentan para el progreso. Un comercio cuyos elementos estén
  // todos a 0 se queda vacío, en coherencia con su contador X/0.
  const entries = byName
    ? [...byName.values()].filter((e) => !lista2EntrySkipped(e))
    : [];

  if (entries.length === 0) {
    const p = document.createElement('p');
    p.className = 'lista2-empty';
    p.textContent = 'No hay elementos que comprar en este comercio.';
    lista2DetailList.appendChild(p);
    updateLista2StoreProgress(byName || new Map());
    return;
  }

  // Las cantidades planificadas dependen de la lista de origen; se calculan
  // una vez por lista y se reutilizan.
  const qtyMaps = new Map();
  const qtyMapFor = (item) => {
    if (!qtyMaps.has(item.id)) {
      qtyMaps.set(item.id, isLista2Mensual(item) ? new Map() : buildTotalQtyMap(item));
    }
    return qtyMaps.get(item.id);
  };

  const alphabetical = [...entries].sort((a, b) =>
    a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
  );
  const pending = alphabetical.filter((e) => !lista2EntryDone(e));
  const completed = alphabetical.filter((e) => lista2EntryDone(e));

  [...pending, ...completed].forEach((entry) => {
    const item = entry.sourceItem;
    const record = findLista2Record(item, entry.name);
    const isDone = lista2EntryDone(entry);

    const li = document.createElement('li');
    li.dataset.name = entry.name;
    li.className = 'lista2-ingredient-item';
    if (isDone) li.classList.add('is-complete');

    const cbLabel = document.createElement('label');
    cbLabel.className = 'cb';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'cb-input';
    checkbox.checked = isDone;
    const cbBox = document.createElement('span');
    cbBox.className = 'cb-box';
    cbBox.setAttribute('aria-hidden', 'true');
    cbLabel.appendChild(checkbox);
    cbLabel.appendChild(cbBox);

    // Se marca en todas las listas donde aparezca, para que el estado sea el
    // mismo se mire desde donde se mire.
    checkbox.addEventListener('change', () => {
      entry.listIds.forEach((id) => {
        if (!lista2Checked[id]) lista2Checked[id] = {};
        if (checkbox.checked) lista2Checked[id][entry.name] = true;
        else delete lista2Checked[id][entry.name];
      });
      saveLista2Checked();
      renderLista2StoreDetailList(storeKey);
    });

    const nameGroup = document.createElement('div');
    nameGroup.className = 'lista2-name-group';

    const nameEl = document.createElement('span');
    nameEl.className = 'shopping-name';
    nameEl.textContent = entry.name;
    nameGroup.appendChild(nameEl);

    if (record?.product) {
      const productEl = document.createElement('span');
      productEl.className = 'lista2-ingredient-product';
      productEl.textContent = record.product;
      nameGroup.appendChild(productEl);
    }

    li.appendChild(cbLabel);
    li.appendChild(nameGroup);

    if (record) {
      const { text, isOverridden } =
        lista2QtyText(item, record, entry.name, qtyMapFor(item).get(entry.name));
      if (text) {
        const qtyEl = document.createElement('span');
        qtyEl.className = 'lista2-ingredient-qty';
        qtyEl.textContent = text;
        if (isOverridden) {
          const dot = document.createElement('span');
          dot.className = 'lista2-qty-override-dot';
          dot.setAttribute('aria-label', 'Cantidad editada manualmente');
          qtyEl.prepend(dot);
        }
        li.appendChild(qtyEl);
      }
    }

    lista2DetailList.appendChild(li);
  });

  updateLista2StoreProgress(byName);
}

// La pestaña marcada se deduce siempre de _lista2View, no del clic: así
// siempre hay exactamente una activa, se llegue por donde se llegue.
function syncLista2ViewTabs() {
  const tabs = document.querySelectorAll('#lista2ViewTabs .shopping-tab-btn');
  if (!tabs.length) return;

  // Ante un valor inesperado se vuelve a la vista por tipo, para no dejar
  // ninguna pestaña marcada.
  const known = [...tabs].some((b) => b.dataset.lista2View === _lista2View);
  if (!known) _lista2View = 'type';

  tabs.forEach((b) => b.classList.toggle('active', b.dataset.lista2View === _lista2View));
}

document.querySelectorAll('#lista2ViewTabs .shopping-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    _lista2View = btn.dataset.lista2View;
    renderLista2();
  });
});

function renderLista2() {
  syncLista2ViewTabs();

  // La vista por comercio se alimenta de las mismas listas, así que se
  // repinta siempre junto con la vista por tipo.
  renderLista2StoreGroups();
  const showingByStore = _lista2View === 'store';
  if (lista2ItemsContainer) lista2ItemsContainer.hidden = showingByStore;
  if (lista2StoreGroupsContainer) lista2StoreGroupsContainer.hidden = !showingByStore;

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

    const isMensual = isLista2Mensual(item);
    const storeName = lista2Title(item);
    const dateRange = isMensual
      ? formatDateShort(lista2CreatedAtISO(item))
      : `${formatDateShort(item.startDate)} – ${formatDateShort(item.endDate)}`;
    const shopQtyRow = lista2ShopQty[item.id] || {};
    const nonPantryNames = item.ingredientNames.filter(name => shopQtyRow[name] !== 0);
    const totalIngredients = nonPantryNames.length;
    const checkedIngredients = nonPantryNames.filter(name => (lista2Checked[item.id] || {})[name]).length;

    row.innerHTML = `
      <div class="store-row-left">
        <div class="store-row-name">${storeName}</div>
        ${dateRange ? `<div class="store-row-meta">${dateRange}</div>` : ''}
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

// Firebase almacena arrays como objetos {0:…,1:…} cuando tienen huecos o
// cuando contienen arrays anidados. Esta función los convierte de vuelta a arrays.
function fromFirebase(val) {
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) return val.map(fromFirebase);
  if (typeof val === 'object') {
    const keys = Object.keys(val);
    const allNumeric = keys.length > 0 && keys.every(k => /^\d+$/.test(k));
    if (allNumeric) {
      const arr = [];
      keys.sort((a, b) => Number(a) - Number(b)).forEach(k => {
        arr[Number(k)] = fromFirebase(val[k]);
      });
      return arr;
    }
    const obj = {};
    keys.forEach(k => { obj[k] = fromFirebase(val[k]); });
    return obj;
  }
  return val;
}

let _listenersStarted = false;

function startFirebaseListeners() {
  if (_listenersStarted) return;
  _listenersStarted = true;

  // Reparto va por su cuenta: tiene su propio nodo, su propio formato y su
  // propio aviso de error dentro de la vista.
  startRepartoListener();

  const paths = [
    { key: 'ingredients',      ref: 'compra/ingredients',      set: v => { ingredients      = Array.isArray(v) ? v : []; }, render: () => renderIngredients() },
    { key: 'consumables',      ref: 'compra/consumables',      set: v => { consumables      = Array.isArray(v) ? v : []; }, render: () => renderConsumables() },
    { key: 'utensils',         ref: 'compra/utensils',         set: v => { utensils         = Array.isArray(v) ? v : []; }, render: () => renderUtensils() },
    { key: 'settingsSharedLocations',     ref: 'compra/settingsSharedLocations',     set: v => { settingsSharedLocations     = Array.isArray(v) ? v : []; }, render: () => { renderSettings(); refreshIngredientSelects(); refreshConsumableSelects(); renderIngredients(); renderConsumables(); } },
    { key: 'settingsSharedStores',        ref: 'compra/settingsSharedStores',        set: v => { settingsSharedStores        = Array.isArray(v) ? v : []; }, render: () => { renderSettings(); refreshIngredientSelects(); refreshConsumableSelects(); renderIngredients(); renderConsumables(); } },
    { key: 'settingsSharedRooms',         ref: 'compra/settingsSharedRooms',         set: v => { settingsSharedRooms         = Array.isArray(v) ? v : []; }, render: () => renderSettings() },
    { key: 'recipes',          ref: 'compra/recipes',          set: v => { recipes          = Array.isArray(v) ? v.map(r => ({ ...r, ingredients: r.ingredients || [] })) : []; }, render: () => { renderRecipes(); renderCalendarEntries(); } },
    { key: 'calendarEntries',  ref: 'compra/calendarEntries',  set: v => { calendarEntries  = Array.isArray(v) ? v : []; }, render: () => renderCalendarEntries() },
    { key: 'calendarCooked',   ref: 'compra/calendarCooked',   set: v => { calendarCooked   = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; }, render: () => renderCalendarEntries() },
    { key: 'cocinados',        ref: 'compra/cocinados',        set: v => { cocinados        = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; }, render: () => renderCocinados() },
    { key: 'lista2Items',      ref: 'compra/lista2Items',      set: v => { lista2Items      = Array.isArray(v) ? v.map(item => ({ ...item, ingredientNames: item.ingredientNames || [] })) : []; }, render: () => renderLista2() },
    { key: 'lista2Checked',    ref: 'compra/lista2Checked',    set: v => { lista2Checked    = (v && typeof v === 'object') ? v : {}; }, render: () => renderLista2() },
    { key: 'lista2ShopQty',    ref: 'compra/lista2ShopQty',    set: v => { lista2ShopQty    = (v && typeof v === 'object') ? v : {}; }, render: () => renderLista2() },
    { key: 'purchasedItems',   ref: 'compra/purchasedItems',   set: v => { purchasedItems   = (v && typeof v === 'object') ? v : {}; }, render: () => { if (typeof renderShoppingListFromState === 'function') renderShoppingListFromState(); } },
    { key: 'lastShoppingList', ref: 'compra/lastShoppingList', set: v => { lastShoppingList = v; }, render: () => { if (typeof renderShoppingListFromState === 'function') renderShoppingListFromState(); } },
  ];

  // Rutas de la versión anterior de los ajustes (lista única editada desde
  // Consumibles). Se leen para migrarlas a las listas de Consumibles en
  // dispositivos donde no quede el localStorage antiguo.
  // Varias rutas pueden alimentar el mismo destino: los comercios vivían en
  // tres sitios distintos antes de unificarse en una sola lista.
  const legacySettingsPaths = [
    { ref: 'compra/settingsIngredientLocations', target: 'settingsSharedLocations' },
    { ref: 'compra/settingsConsumableLocations', target: 'settingsSharedLocations' },
    { ref: 'compra/settingsLocations',           target: 'settingsSharedLocations' },
    { ref: 'compra/settingsIngredientStores',    target: 'settingsSharedStores' },
    { ref: 'compra/settingsConsumableStores',    target: 'settingsSharedStores' },
    { ref: 'compra/settingsStores',              target: 'settingsSharedStores' },
  ];

  // Initial one-time load from Firebase; migrate from localStorage if Firebase is empty
  Promise.all([
    ...paths.map(p => db.ref(p.ref).once('value')),
    ...legacySettingsPaths.map(p => db.ref(p.ref).once('value')),
  ])
    .then(allSnaps => {
      const snaps = allSnaps.slice(0, paths.length);
      const legacySnaps = allSnaps.slice(paths.length);

      // Lo que había en las rutas antiguas manda sobre la semilla local, para
      // no perder las listas que ya se hubieran configurado desde Consumibles.
      const legacyByTarget = {};
      legacySnaps.forEach((snap, i) => {
        const val = fromFirebase(snap.val());
        if (!Array.isArray(val) || !val.length) return;
        const target = legacySettingsPaths[i].target;
        (legacyByTarget[target] = legacyByTarget[target] || []).push(val);
      });

      const legacyValues = {};
      Object.entries(legacyByTarget).forEach(([target, lists]) => {
        legacyValues[target] = mergeSettingsLists(...lists);
      });

      snaps.forEach((snap, i) => {
        const val = fromFirebase(snap.val());
        if (val !== null && val !== undefined) {
          paths[i].set(val);
        } else if (legacyValues[paths[i].key]) {
          // Ruta nueva vacía pero con datos en la ruta antigua: se migran.
          const migrated = legacyValues[paths[i].key];
          paths[i].set(migrated);
          localStorage.setItem(paths[i].key, JSON.stringify(migrated));
          db.ref(paths[i].ref).set(migrated);
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

      // Limpieza de calendarEntries y calendarCooked sobre datos reales de Firebase
      const _weekStart = toISODateString(startOfWeekMonday(new Date()));
      calendarEntries.forEach(e => {
        if (!Array.isArray(e.excludedDates)) return;
        e.excludedDates = e.excludedDates.filter(isValidISODateString);
      });
      calendarEntries = calendarEntries.filter(e => {
        const repeat = e.repeat || 'never';
        const isPattern = repeat === 'daily' || repeat === 'weekly';
        const keyDate = isPattern ? (e.startDate || e.date) : (e.date || e.startDate);
        return isValidISODateString(keyDate);
      });
      calendarEntries = calendarEntries.filter(e => {
        const repeat = e.repeat || 'never';
        if (repeat === 'never') return (e.date || '') >= _weekStart;
        if (e.until && e.until < _weekStart) return false;
        return true;
      });
      calendarEntries.forEach(e => {
        if (Array.isArray(e.excludedDates) && e.excludedDates.length) {
          e.excludedDates = e.excludedDates.filter(d => d >= _weekStart);
        }
      });
      if (calendarEntries.length > 0) saveCalendarEntries();
      const _cookedFiltered = {};
      Object.keys(calendarCooked).forEach(k => {
        const datePart = k.substring(0, 10);
        if (!isValidISODateString(datePart) || datePart >= _weekStart) {
          _cookedFiltered[k] = calendarCooked[k];
        }
      });
      if (Object.keys(_cookedFiltered).length !== Object.keys(calendarCooked).length) {
        calendarCooked = _cookedFiltered;
        saveCalendarCooked();
      }

      // Full re-render after initial load
      try { renderSettings(); } catch(e) {}
      try { refreshIngredientSelects(); } catch(e) {}
      try { refreshConsumableSelects(); } catch(e) {}
      try { renderIngredients(); } catch(e) {}
      try { renderConsumables(); } catch(e) {}
      try { renderRecipes(); } catch(e) {}
      try { renderCalendarEntries(); } catch(e) {}
      try { renderCocinados(); } catch(e) {}
      try { renderLista2(); } catch(e) {}
      try { if (typeof renderShoppingListFromState === 'function') renderShoppingListFromState(); } catch(e) {}

      // Set up persistent real-time listeners for cross-device sync.
      // No se ignoran los valores null: Firebase convierte los arrays/objetos
      // vacíos en null al guardarlos, así que null es un estado real (lista
      // vaciada/borrada) y debe propagarse igualmente a los demás dispositivos.
      paths.forEach(p => {
        db.ref(p.ref).on('value', snap => {
          const val = fromFirebase(snap.val());
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
    renderAppSettingsSession();
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

// ===========================================================================
// MENCIONES DE MATERIALES
// ===========================================================================
// Portado del campo Notas de la app Tareas. Al escribir «@» en el campo
// Instrucciones de una tarea aparece la lista de consumibles y utensilios de su
// área, y lo que se elige se inserta como una píldora.
//
// Va aquí arriba porque el blot lo usan los dos editores que pintan
// instrucciones: el del panel de tarea y el lector del Reparto.

const MENTION_TYPES = {
  utensilio:  { singular: 'Utensilio',  color: '#6b6b76' },
  consumible: { singular: 'Consumible', color: '#d97706' },
};

// El id de la mención lleva delante el tipo: consumibles y utensilios son dos
// listas distintas y sus números pueden coincidir.
function mentionId(tipo, id) {
  return `${tipo === 'utensilio' ? 'u' : 'c'}:${id}`;
}

// Todo lo mencionable, con el nombre que tiene ahora mismo. Los utensilios solo
// existen en Limpieza, así que es la categoría que se les da.
function mentionItems() {
  return [
    ...consumables.map((c) => ({
      id: mentionId('consumible', c.id),
      nombre: c.name,
      tipo: 'consumible',
      category: c.category || '',
    })),
    ...utensils.map((u) => ({
      id: mentionId('utensilio', u.id),
      nombre: u.name,
      tipo: 'utensilio',
      category: 'limpieza',
    })),
  ];
}

// Mención = embed en línea que guarda id, nombre y tipo. Al pintarse toma el
// nombre actual del material (por si se renombró); si ya no existe, conserva el
// nombre guardado y se marca como eliminado.
const QuillEmbed = Quill.import('blots/embed');
class MentionBlot extends QuillEmbed {
  static create(value) {
    const node = super.create();
    const item = mentionItems().find((m) => m.id === value.id);
    const nombre = item?.nombre ?? value.nombre ?? '';
    const tipo   = item?.tipo ?? value.tipo ?? '';
    node.dataset.id = value.id ?? '';
    node.dataset.nombre = nombre;
    node.dataset.tipo = tipo;
    if (!item) node.classList.add('mention--missing');
    node.textContent = `@${nombre}`;
    return node;
  }

  static value(node) {
    return { id: node.dataset.id, nombre: node.dataset.nombre, tipo: node.dataset.tipo };
  }
}
MentionBlot.blotName  = 'mention';
MentionBlot.tagName   = 'SPAN';
MentionBlot.className = 'mention';
Quill.register(MentionBlot);

// Ids de lo mencionado en unas instrucciones ya guardadas (HTML).
function mentionIdsInHtml(html) {
  if (!html) return [];
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return [...tpl.content.querySelectorAll('.mention[data-id]')].map((n) => n.dataset.id);
}

// Para buscar sin tildes ni mayúsculas.
function mentionNormalize(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Cuántas tareas mencionan cada material, contadas una vez por tarea aunque
// aparezca varias veces en sus instrucciones. La clave es el id de la mención.
function mentionTaskCounts() {
  const counts = new Map();
  repartoRows.forEach((row) => {
    new Set(mentionIdsInHtml(row.instrucciones)).forEach((id) => {
      counts.set(id, (counts.get(id) || 0) + 1);
    });
  });
  return counts;
}

// --- «Usado en»: tareas que mencionan un material ---
// Mismo componente que en Editar ingrediente, con sus clases: lo que cambia es
// que las filas son tareas y el botón lleva a la tarea en su pestaña.
const USED_IN_ICONS = {
  arrow: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.83337 14.1666L14.1667 5.83325" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.83337 5.83325H14.1667V14.1666" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  tarea: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.5 5.4L4 6.9L7 3.9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 13.4L4 14.9L7 11.9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.6 5.4H17.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M9.6 13.4H17.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  edit: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.333 2a1.885 1.885 0 0 1 2.667 2.667L4.889 13.778 2 14l.222-2.889L11.333 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

function renderUsedInTareas(hostId, wantedMentionId) {
  const host = document.getElementById(hostId);
  if (!host) return;

  const rows = repartoRows.filter(
    (r) => mentionIdsInHtml(r.instrucciones).includes(wantedMentionId)
  );

  host.innerHTML = '';
  if (!rows.length) return;

  const title = document.createElement('p');
  title.className = 'field-label-small';
  title.innerHTML = USED_IN_ICONS.arrow;
  title.append('Usado en');
  host.appendChild(title);

  const ul = document.createElement('ul');
  ul.className = 'ingredient-recipe-list';

  rows.forEach((row) => {
    const li = document.createElement('li');
    li.className = 'ingredient-recipe-row';

    li.innerHTML = USED_IN_ICONS.tarea;
    li.firstElementChild?.classList.add('ingredient-recipe-icon');

    const name = document.createElement('span');
    name.className = 'ingredient-recipe-name';
    name.textContent = row.tarea || 'Sin título';
    li.appendChild(name);

    // Solo se puede saltar a la tarea si su pestaña tiene lista en el rail.
    const tabId = RP_TAB_RAIL_TAB[rpTabOf(row.pestana)];
    if (tabId) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ingredient-recipe-edit-btn';
      btn.setAttribute('aria-label', 'Editar tarea');
      btn.innerHTML = USED_IN_ICONS.edit;
      btn.addEventListener('click', () => openTareaFromTab(row, tabId));
      li.appendChild(btn);
    }

    ul.appendChild(li);
  });

  host.appendChild(ul);
}

// ===========================================================================
// REPARTO
// ===========================================================================
// Portado de la app Tareas. Vista con UI propia (clases .rp / rp-, aisladas del
// resto de la app). La tabla es de solo lectura: al pulsar una fila se abre un
// modal que edita una copia (borrador) y solo confirma al guardar.
//
// Los datos viven en su propio nodo de Firebase (`compra/reparto`) y son
// independientes de los de Tareas (`reparto`): la primera vez se copian de allí
// y a partir de ese momento esta app solo escribe en el nodo propio.
// A diferencia de Tareas, aquí no hay columna «Rutina»: sus opciones salían de
// la pestaña Planificadas, que no existe en Compras. El valor guardado en cada
// fila se conserva, pero no se muestra ni se edita.

const RP_FB_PATH   = 'compra/reparto';  // nodo propio: lo único que se escribe
const RP_SEED_PATH = 'reparto';         // nodo de la app Tareas: solo se lee una vez

const RP_OWNERS = {
  cristina: { label: 'Cristina', initial: 'C', color: '#cd30e1' },
  fernando: { label: 'Fernando', initial: 'F', color: '#4688f9' },
  ambos:   { label: 'Ambos',    initial: 'A', color: '#0d9488' },
  'sin-asignar': { label: 'Sin asignar', initial: '?', color: '#b4b4bd' },
  'sin-atender': { label: 'Sin atender', initial: '!', color: '#f59e0b' },
};

// Opciones de cada campo. El autor no admite 'Sin asignar' (si se ha hecho,
// alguien la ha hecho); 'Sin atender' es solo del autor: nadie la está haciendo.
const RP_RESPONSIBLES = ['cristina', 'fernando', 'ambos', 'sin-asignar'];
const RP_AUTHORS = ['cristina', 'fernando', 'ambos', 'sin-atender'];

// 'personalizado' guarda su etiqueta libre en row.frecuenciaPersonalizada.
const RP_FREQS = { diario: 'Diario', semanal: 'Semanal', personalizado: 'Personalizado' };

function rpFreqLabel(row) {
  if (row.frecuencia === 'personalizado') return row.frecuenciaPersonalizada || 'Personalizado';
  return RP_FREQS[row.frecuencia];
}

const rpTabsBar       = document.getElementById('rp-tabs');
const rpSummary       = document.getElementById('rp-summary');
const rpGroups        = document.getElementById('rp-groups');
const rpGroupTemplate = document.getElementById('rp-group-template');
const rpEmptyCard     = document.getElementById('rp-empty-card');
const rpAddSectionBtn = document.getElementById('rp-add-section');

const rpModal        = document.getElementById('rp-modal');
const rpModalTitle   = document.getElementById('rp-modal-title');
const rpModalTask    = document.getElementById('rp-modal-task');
const rpModalOwner   = document.getElementById('rp-modal-owner');
const rpModalAuthor  = document.getElementById('rp-modal-author');
const rpModalFreq    = document.getElementById('rp-modal-freq');
const rpModalTab     = document.getElementById('rp-modal-tab');
const rpModalSection = document.getElementById('rp-modal-section');
const rpModalSave    = document.getElementById('rp-modal-save');
const rpModalDelete  = document.getElementById('rp-modal-delete');

const rpViewModal = document.getElementById('rp-view-modal');
const rpViewTitle = document.getElementById('rp-view-title');

// Lector de solo lectura. Se pinta con dangerouslyPasteHTML, que pasa el HTML
// por los conversores de Quill y descarta lo que no sean formatos conocidos.
const rpReaderQuill = new Quill('#rp-view-content', {
  theme: 'bubble',
  readOnly: true,
  modules: { toolbar: false },
});

// repartoRows se declara arriba, con el resto de los datos: las tablas de
// Consumibles y Utensilios lo leen al pintarse, y eso pasa antes de llegar aquí.
let rpActiveTab  = null;
let rpDraft      = null;   // copia editable de la fila abierta en el modal
let rpEditingId  = null;   // null = fila nueva
let rpLastFocus  = null;   // fila desde la que se abrió el modal
let rpFreqCustomInput = null; // campo libre de la frecuencia personalizada
let repartoSections   = [];   // secciones creadas aún sin filas: { pestana, seccion }
let repartoLegacyTabs = null; // lista de pestañas de los datos antiguos: ya no
                              // se usa (ahora son fijas), pero se devuelve tal
                              // cual al guardar para no borrar nada del nodo

function rpNewId() {
  return `rp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function rpNormalizeRow(row, i) {
  const r = row ?? {};
  return {
    id: r.id ?? `rp-legacy-${i}`,
    tarea: typeof r.tarea === 'string' ? r.tarea : '',
    pestana: typeof r.pestana === 'string' ? r.pestana.trim() : '',
    seccion: typeof r.seccion === 'string' ? r.seccion.trim() : '',
    responsable: RP_RESPONSIBLES.includes(r.responsable) ? r.responsable : 'cristina',
    autor: RP_AUTHORS.includes(r.autor) ? r.autor : 'cristina',
    frecuencia: RP_FREQS[r.frecuencia] ? r.frecuencia : 'diario',
    frecuenciaPersonalizada: typeof r.frecuenciaPersonalizada === 'string' ? r.frecuenciaPersonalizada : '',
    // Aquí no hay columna «Rutina», pero el valor que trajeran los datos se
    // conserva tal cual para no perderlo al guardar.
    rutina: Array.isArray(r.rutina) ? r.rutina.filter(id => typeof id === 'string') : [],
    instrucciones: typeof r.instrucciones === 'string' ? r.instrucciones : '',
  };
}

// 'General' es la pestaña fija de resumen: no es una pestaña de datos y va
// siempre primera.
const RP_SUMMARY_TAB = 'General';

// Las pestañas de datos son fijas: no se crean, ni se renombran, ni se
// reordenan, ni se borran. Para cambiarlas se edita esta lista.
const RP_TABS = ['Gestión de residuos', 'Lavandería', 'Limpieza', 'Compras', 'Cocina'];

// Pestaña de rescate. No es una de las fijas: sale al final, y solo si alguna
// fila (o alguna sección vacía) quedó guardada en una pestaña que no está en
// RP_TABS — por ejemplo las que se copiaron de la app Tareas, que tenía otras.
// Así ninguna fila deja de verse y no se reescribe nada por nuestra cuenta: en
// cuanto se mueven todas a su pestaña, la de rescate desaparece.
const RP_ORPHAN_TAB = 'Sin clasificar';

// Clave para comparar nombres de pestaña. Se reutiliza el slug de los ajustes
// (sin acentos, sin mayúsculas y sin espacios ni signos), así un «lavanderia»
// guardado cae en «Lavandería».
function rpTabKey(name) {
  return slugifySettingValue(String(name ?? ''));
}

const RP_TAB_BY_KEY = new Map(RP_TABS.map(name => [rpTabKey(name), name]));

// Pestaña en la que se ve lo guardado con ese nombre de pestaña.
function rpTabOf(pestana) {
  return RP_TAB_BY_KEY.get(rpTabKey(pestana)) ?? RP_ORPHAN_TAB;
}

function rpHasOrphans() {
  return repartoRows.some(row => rpTabOf(row.pestana) === RP_ORPHAN_TAB)
      || repartoSections.some(s => rpTabOf(s.pestana) === RP_ORPHAN_TAB);
}

function rpDataTabs() {
  return rpHasOrphans() ? [...RP_TABS, RP_ORPHAN_TAB] : [...RP_TABS];
}

// El nodo fue un array de filas antes de que existieran las pestañas, y luego
// pasó a ser { rows, tabs, sections }. Aquí se aceptan las dos formas. `tabs`
// ya no se usa —las pestañas son fijas—, pero se guarda para devolverlo tal
// cual y no borrar nada de lo que hubiera en el nodo.
function rpParseSnapshot(data) {
  const toList = v => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []);
  if (Array.isArray(data)) return { rows: data, sections: [], tabs: null };
  if (data && typeof data === 'object') {
    if ('rows' in data || 'tabs' in data || 'sections' in data) {
      return { rows: toList(data.rows), sections: toList(data.sections), tabs: data.tabs ?? null };
    }
    return { rows: Object.values(data), sections: [], tabs: null }; // array con huecos: Firebase lo devuelve como objeto
  }
  return { rows: [], sections: [], tabs: null };
}

// Las secciones vacías se guardan aparte porque, sin filas, no se pueden
// derivar de ellas. En cuanto reciben su primera fila sobran y se quitan.
// Las de una pestaña que ya no existe no se tiran: se ven en la de rescate.
function rpPruneSections() {
  const seen = new Set();
  repartoSections = repartoSections.filter(s => {
    if (!s || typeof s.pestana !== 'string' || typeof s.seccion !== 'string') return false;
    const pestana = s.pestana, seccion = s.seccion.trim();
    if (!seccion) return false;
    if (repartoRows.some(r => r.pestana === pestana && r.seccion === seccion)) return false;
    const id = `${pestana}\u0000${seccion}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map(s => ({ pestana: s.pestana, seccion: s.seccion.trim() }));
}

// Deja escrito el nombre exacto de la pestaña fija cuando lo guardado solo
// difiere en mayúsculas, acentos o espacios. Lo que no se parezca a ninguna se
// queda igual: se verá en la pestaña de rescate, pero no se pierde ni se mueve
// sin querer. Devuelve true si ha tocado algo (hay que persistirlo).
function rpReconcileTabs() {
  let changed = false;
  const canonizar = (item) => {
    const exacto = RP_TAB_BY_KEY.get(rpTabKey(item.pestana));
    if (exacto && item.pestana !== exacto) { item.pestana = exacto; changed = true; }
  };
  repartoRows.forEach(canonizar);
  repartoSections.forEach(canonizar);
  return changed;
}

function rpAllTabs() {
  return [RP_SUMMARY_TAB, ...rpDataTabs()];
}

function rpEnsureActiveTab() {
  const all = rpAllTabs();
  if (all.includes(rpActiveTab)) return;
  const saved = localStorage.getItem('compra-rp-active-tab');
  rpActiveTab = all.includes(saved) ? saved : all[0];
}

function rpSetActiveTab(name) {
  if (!rpAllTabs().includes(name)) return;
  rpActiveTab = name;
  localStorage.setItem('compra-rp-active-tab', name);
  rpClosePopover();
  renderReparto();
}

function rpTabRows(tab = rpActiveTab) {
  return repartoRows.filter(row => rpTabOf(row.pestana) === tab);
}

// Firebase rechaza en silencio la escritura si el nodo no tiene reglas: el error
// se muestra en la propia vista para no perder datos sin avisar.
function rpShowError(message) {
  const el = document.getElementById('rp-error');
  if (!el) return;
  el.textContent = message ?? '';
  el.hidden = !message;
}

function saveReparto() {
  rpPruneSections();
  const payload = (repartoRows.length || repartoSections.length)
    ? { rows: repartoRows, sections: repartoSections, tabs: repartoLegacyTabs }
    : null;
  db.ref(RP_FB_PATH).set(payload)
    .then(() => rpShowError(null))
    .catch((error) => {
      const msg = error?.message ?? String(error);
      console.error('[reparto] Error guardando en Firebase:', msg);
      rpShowError(
        /permission/i.test(msg)
          ? `No se pueden guardar los cambios: el nodo «${RP_FB_PATH}» no tiene permisos en las reglas de Firebase.`
          : `No se pueden guardar los cambios: ${msg}`
      );
    });
}

function rpSvg(paths, size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
}

const RP_ICON_CHEVRON  = rpSvg('<path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>', 14);
const RP_ICON_CHECK    = rpSvg('<path d="M13.5 4.5L6.5 11.5L3 8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>', 14);
const RP_ICON_COPY     = rpSvg('<path d="M13 6H7.33A1.33 1.33 0 0 0 6 7.33V13a1.33 1.33 0 0 0 1.33 1.33H13A1.33 1.33 0 0 0 14.33 13V7.33A1.33 1.33 0 0 0 13 6Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.33 10h-.66A1.33 1.33 0 0 1 1.33 8.67V3a1.33 1.33 0 0 1 1.34-1.33h5.66A1.33 1.33 0 0 1 9.67 3v.67" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>', 15);
const RP_ICON_DOC      = rpSvg('<path d="M9.33 1.83H4a1.17 1.17 0 0 0-1.17 1.17v10a1.17 1.17 0 0 0 1.17 1.17h8a1.17 1.17 0 0 0 1.17-1.17V5.67L9.33 1.83Z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.33 1.83V5.67h3.84" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.67 8.5h4.66M5.67 11h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>', 14);

// Quill devuelve '<p><br></p>' cuando el editor está vacío: hay que mirar el texto.
function rpHasInstructions(html) {
  if (!html) return false;
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0;
}

function rpAvatar(ownerKey) {
  const meta = RP_OWNERS[ownerKey];
  const el = document.createElement('span');
  el.className = 'rp-avatar';
  el.style.setProperty('--rp-avatar-bg', meta.color);
  el.textContent = meta.initial;
  return el;
}

// "Ambos" se representa con las dos iniciales superpuestas.
function rpPerson(ownerKey) {
  const wrap = document.createElement('span');
  wrap.className = 'rp-person';
  if (ownerKey === 'ambos') {
    const stack = document.createElement('span');
    stack.className = 'rp-avatar-stack';
    stack.append(rpAvatar('cristina'), rpAvatar('fernando'));
    wrap.appendChild(stack);
  } else {
    wrap.appendChild(rpAvatar(ownerKey));
  }
  const name = document.createElement('span');
  name.textContent = RP_OWNERS[ownerKey].label;
  wrap.appendChild(name);
  return wrap;
}

function rpOwnerBadge(ownerKey) {
  if (ownerKey !== 'ambos') return rpAvatar(ownerKey);
  const stack = document.createElement('span');
  stack.className = 'rp-avatar-stack';
  stack.append(rpAvatar('cristina'), rpAvatar('fernando'));
  return stack;
}

// --- Popover compartido (posición fija: no lo recorta el scroll de la tabla) ---

let rpPopover = null;
let rpPopoverAnchor = null;

function rpClosePopover() {
  if (!rpPopover) return;
  rpPopover.remove();
  rpPopoverAnchor?.setAttribute('aria-expanded', 'false');
  rpPopover = null;
  rpPopoverAnchor = null;
}

function rpPositionPopover(pop, anchor) {
  const r = anchor.getBoundingClientRect();
  const gap = 6;
  pop.style.minWidth = `${Math.max(r.width, 220)}px`;
  const h = pop.offsetHeight;
  const w = pop.offsetWidth;
  let top = r.bottom + gap;
  if (top + h > window.innerHeight - 8) {
    top = Math.max(8, r.top - gap - h);
  }
  let left = r.left;
  if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - w);
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
}

function rpOpenPopover(anchor, build) {
  const reopening = rpPopoverAnchor === anchor;
  rpClosePopover();
  if (reopening) return;

  const pop = document.createElement('div');
  pop.className = 'rp-popover';
  build(pop, () => rpClosePopover());
  document.body.appendChild(pop);

  rpPopover = pop;
  rpPopoverAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  rpPositionPopover(pop, anchor);
  pop.querySelector('input, .rp-option')?.focus();
}

document.addEventListener('pointerdown', (e) => {
  if (!rpPopover) return;
  if (rpPopover.contains(e.target) || rpPopoverAnchor?.contains(e.target)) return;
  rpClosePopover();
});

// Escape cierra primero el desplegable y, si no hay ninguno, el modal.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (rpPopover) {
    const anchor = rpPopoverAnchor;
    rpClosePopover();
    anchor?.focus();
  } else if (rpViewModal && !rpViewModal.hidden) {
    rpCloseViewModal();
  } else if (rpSectionModal && !rpSectionModal.hidden) {
    rpCloseSectionModal();
  } else if (rpModal && !rpModal.hidden) {
    rpCloseModal();
  }
});

window.addEventListener('resize', rpClosePopover);
window.addEventListener('scroll', rpClosePopover, true);

function rpOption({ label, selected, multi, onClick, prefix }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'rp-option';
  btn.setAttribute(multi ? 'aria-checked' : 'aria-selected', String(selected));
  if (multi) btn.setAttribute('role', 'menuitemcheckbox');

  if (multi) {
    const box = document.createElement('span');
    box.className = 'rp-checkbox';
    box.innerHTML = RP_ICON_CHECK;
    btn.appendChild(box);
  }
  if (prefix) btn.appendChild(prefix);

  const text = document.createElement('span');
  text.className = 'rp-option-label';
  text.textContent = label;
  btn.appendChild(text);

  if (!multi) {
    const check = document.createElement('span');
    check.className = 'rp-option-check';
    check.innerHTML = RP_ICON_CHECK;
    btn.appendChild(check);
  }

  btn.addEventListener('click', onClick);
  return btn;
}

function rpFieldTrigger() {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'rp-trigger rp-trigger--boxed';
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');

  const body = document.createElement('span');
  body.className = 'rp-trigger-body';

  const chevron = document.createElement('span');
  chevron.className = 'rp-trigger-chevron';
  chevron.innerHTML = RP_ICON_CHEVRON;

  trigger.append(body, chevron);
  return trigger;
}

// --- Campos del modal (escriben sobre rpDraft, no sobre la fila real) ---

// Selector de persona, común a Responsable y Autor: 'field' es la propiedad
// de rpDraft que edita y 'keys' las personas que ofrece.
function rpBuildPersonField(container, field, keys) {
  const trigger = rpFieldTrigger();
  const body = trigger.querySelector('.rp-trigger-body');
  const paint = () => { body.innerHTML = ''; body.appendChild(rpPerson(rpDraft[field])); };
  paint();

  trigger.addEventListener('click', () => {
    rpOpenPopover(trigger, (pop, close) => {
      const list = document.createElement('div');
      list.className = 'rp-popover-list';
      keys.forEach(key => {
        list.appendChild(rpOption({
          label: RP_OWNERS[key].label,
          selected: rpDraft[field] === key,
          multi: false,
          prefix: rpOwnerBadge(key),
          onClick: () => { rpDraft[field] = key; paint(); close(); },
        }));
      });
      pop.appendChild(list);
    });
  });

  container.innerHTML = '';
  container.appendChild(trigger);
}

// Selector de pestaña: solo las fijas. Si la fila viene de una pestaña que ya
// no existe, el disparador muestra ese nombre antiguo hasta que se elige una.
function rpBuildTabField() {
  const trigger = rpFieldTrigger();
  const body = trigger.querySelector('.rp-trigger-body');
  const label = document.createElement('span');
  label.textContent = rpDraft.pestana || 'Sin pestaña';
  body.appendChild(label);

  trigger.addEventListener('click', () => {
    rpOpenPopover(trigger, (pop, close) => {
      const list = document.createElement('div');
      list.className = 'rp-popover-list';
      RP_TABS.forEach(name => {
        list.appendChild(rpOption({
          label: name,
          selected: rpDraft.pestana === name,
          multi: false,
          onClick: () => {
            rpDraft.pestana = name;
            label.textContent = name;
            close();
            rpBuildSectionField(); // las secciones son las de la pestaña destino
          },
        }));
      });
      pop.appendChild(list);
    });
  });

  rpModalTab.innerHTML = '';
  rpModalTab.appendChild(trigger);
}

// Selector de sección: solo elige entre las que ya existen en la pestaña.
// Crearlas es cosa del botón «Nueva sección» del final de la vista.
function rpBuildSectionField() {
  const sections = rpSectionNames(rpDraft.pestana);
  // Al mover la fila a otra pestaña, su sección puede no existir allí.
  if (rpDraft.seccion && !sections.includes(rpDraft.seccion)) rpDraft.seccion = '';

  const trigger = rpFieldTrigger();
  const body = trigger.querySelector('.rp-trigger-body');
  const label = document.createElement('span');
  body.appendChild(label);

  const paint = () => {
    label.textContent = rpDraft.seccion || 'Sin sección';
    label.classList.toggle('rp-placeholder', !rpDraft.seccion);
  };
  paint();

  trigger.addEventListener('click', () => {
    rpOpenPopover(trigger, (pop, close) => {
      const list = document.createElement('div');
      list.className = 'rp-popover-list';

      ['', ...sections].forEach(name => {
        list.appendChild(rpOption({
          label: name || 'Sin sección',
          selected: rpDraft.seccion === name,
          multi: false,
          onClick: () => { close(); rpDraft.seccion = name; paint(); },
        }));
      });

      pop.appendChild(list);
    });
  });

  rpModalSection.innerHTML = '';
  rpModalSection.append(trigger);
}

// Selector: para añadir frecuencias basta con ampliar RP_FREQS.
// 'Personalizado' despliega debajo un campo libre, que es lo que verá la tabla.
function rpBuildFreqField() {
  const trigger = rpFieldTrigger();
  const body = trigger.querySelector('.rp-trigger-body');
  const label = document.createElement('span');
  label.textContent = RP_FREQS[rpDraft.frecuencia];
  body.appendChild(label);

  const custom = document.createElement('input');
  custom.type = 'text';
  custom.className = 'rp-field-input';
  custom.placeholder = 'Ej. Cada dos semanas';
  custom.maxLength = 110;
  custom.setAttribute('aria-label', 'Frecuencia personalizada');
  custom.value = rpDraft.frecuenciaPersonalizada;
  custom.hidden = rpDraft.frecuencia !== 'personalizado';
  custom.addEventListener('input', () => {
    rpDraft.frecuenciaPersonalizada = custom.value;
    rpSyncSaveState();
  });
  custom.addEventListener('keydown', (e) => { if (e.key === 'Enter') rpSaveModal(); });
  rpFreqCustomInput = custom;

  trigger.addEventListener('click', () => {
    rpOpenPopover(trigger, (pop, close) => {
      const list = document.createElement('div');
      list.className = 'rp-popover-list';
      Object.entries(RP_FREQS).forEach(([key, text]) => {
        list.appendChild(rpOption({
          label: text,
          selected: rpDraft.frecuencia === key,
          multi: false,
          onClick: () => {
            rpDraft.frecuencia = key;
            label.textContent = text;
            const isCustom = key === 'personalizado';
            custom.hidden = !isCustom;
            close();
            rpSyncSaveState();
            if (isCustom) custom.focus();
          },
        }));
      });
      pop.appendChild(list);
    });
  });

  rpModalFreq.innerHTML = '';
  rpModalFreq.append(trigger, custom);
}

// --- Modal ---

// Con 'Personalizado' la etiqueta libre es obligatoria: si no, la celda de la
// tabla quedaría sin nada que mostrar.
function rpSyncSaveState() {
  const needsCustom = rpDraft?.frecuencia === 'personalizado';
  const customFilled = !needsCustom || !!rpFreqCustomInput?.value.trim();
  rpModalSave.disabled = !rpModalTask.value.trim() || !customFilled;
}

// 'seccion' prerrellena el campo al crear desde el + de una sección.
function rpOpenModal(row = null, seccion = '') {
  rpEditingId = row?.id ?? null;
  rpDraft = row
    ? { ...row, rutina: [...row.rutina] }
    // Una fila nueva nace en la pestaña activa, siempre que sea una de las
    // fijas (desde «General» o la de rescate no se puede crear).
    : { id: rpNewId(), tarea: '', pestana: RP_TABS.includes(rpActiveTab) ? rpActiveTab : RP_TABS[0], seccion, responsable: 'cristina', autor: 'cristina', frecuencia: 'diario', frecuenciaPersonalizada: '', rutina: [], instrucciones: '' };

  rpLastFocus = document.activeElement;
  rpModalTitle.textContent = row ? 'Editar fila' : 'Nueva fila';
  rpModalTask.value = rpDraft.tarea;
  rpModalDelete.hidden = !row;
  rpBuildTabField();
  rpBuildSectionField();
  rpBuildPersonField(rpModalOwner, 'responsable', RP_RESPONSIBLES);
  rpBuildPersonField(rpModalAuthor, 'autor', RP_AUTHORS);
  rpBuildFreqField();
  rpSyncSaveState();

  rpModal.hidden = false;
  document.body.classList.add('rp-modal-open');
  rpModalTask.focus();
  rpModalTask.select();
}

function rpCloseModal() {
  rpClosePopover();
  rpModal.hidden = true;
  document.body.classList.remove('rp-modal-open');
  rpDraft = null;
  rpEditingId = null;
  rpFreqCustomInput = null;
  if (rpLastFocus?.isConnected) rpLastFocus.focus();
  rpLastFocus = null;
}

function rpSaveModal() {
  if (!rpDraft) return;
  rpDraft.tarea = rpModalTask.value.trim();
  if (!rpDraft.tarea) { rpModalTask.focus(); return; }

  if (rpDraft.frecuencia === 'personalizado') {
    rpDraft.frecuenciaPersonalizada = (rpFreqCustomInput?.value ?? '').trim();
    if (!rpDraft.frecuenciaPersonalizada) { rpFreqCustomInput?.focus(); return; }
  } else {
    rpDraft.frecuenciaPersonalizada = ''; // no se arrastra el texto de una frecuencia anterior
  }

  rpDraft.seccion = (rpDraft.seccion ?? '').trim();

  // Las instrucciones no se tocan aquí: se escriben en el panel de las pestañas
  // «Tareas» y el borrador las arrastra tal cual para no perderlas.

  const i = repartoRows.findIndex(r => r.id === rpEditingId);
  if (i === -1) repartoRows.push(rpDraft);
  else repartoRows[i] = rpDraft;

  // Si la fila se ha movido de pestaña, seguimos a la fila: si no, parecería
  // que ha desaparecido. Se compara la pestaña en la que se ve, no el nombre
  // guardado: una fila de la pestaña de rescate que no se recoloca se queda
  // donde estaba.
  const destino = rpTabOf(rpDraft.pestana);
  if (destino !== rpActiveTab) {
    rpActiveTab = destino;
    localStorage.setItem('compra-rp-active-tab', rpActiveTab);
  }

  rpCloseModal();
  renderReparto();
  saveReparto();
}

function rpDeleteFromModal() {
  repartoRows = repartoRows.filter(r => r.id !== rpEditingId);
  rpCloseModal();
  renderReparto();
  saveReparto();
}

// --- Modal de lectura de instrucciones ---

let rpViewLastFocus = null;

function rpOpenViewModal(row, opener) {
  rpViewLastFocus = opener ?? document.activeElement;
  rpViewTitle.textContent = row.tarea || 'Sin título';
  rpReaderQuill.clipboard.dangerouslyPasteHTML(row.instrucciones || '');
  rpViewModal.hidden = false;
  document.body.classList.add('rp-modal-open');
  document.getElementById('rp-view-close')?.focus();
}

function rpCloseViewModal() {
  rpViewModal.hidden = true;
  document.body.classList.remove('rp-modal-open');
  if (rpViewLastFocus?.isConnected) rpViewLastFocus.focus();
  rpViewLastFocus = null;
}

document.getElementById('rp-view-close')?.addEventListener('click', rpCloseViewModal);
document.getElementById('rp-view-backdrop')?.addEventListener('click', rpCloseViewModal);

rpModalTask?.addEventListener('input', rpSyncSaveState);
rpModalTask?.addEventListener('keydown', (e) => { if (e.key === 'Enter') rpSaveModal(); });
rpModalSave?.addEventListener('click', rpSaveModal);
rpModalDelete?.addEventListener('click', rpDeleteFromModal);
document.getElementById('rp-modal-cancel')?.addEventListener('click', rpCloseModal);
document.getElementById('rp-modal-close')?.addEventListener('click', rpCloseModal);
document.getElementById('rp-modal-backdrop')?.addEventListener('click', rpCloseModal);

// --- Tabla (solo lectura) ---

function rpBuildRow(row) {
  const tr = document.createElement('tr');
  tr.dataset.id = row.id;
  tr.tabIndex = 0;
  tr.setAttribute('role', 'button');
  tr.setAttribute('aria-label', `Editar ${row.tarea || 'fila sin título'}`);

  const tdGrip = document.createElement('td');
  tdGrip.className = 'rp-cell-grip';
  const grip = document.createElement('span');
  grip.className = 'rp-row-grip';
  grip.textContent = '⠿';
  grip.title = 'Arrastra para reordenar';
  grip.setAttribute('draggable', 'true');
  grip.addEventListener('click', (e) => e.stopPropagation()); // no debe abrir el modal
  grip.addEventListener('dragstart', (e) => {
    rpDragRow = tr;
    rpDragRowDropped = false;
    tr.classList.add('rp-row--dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.id);
    }
  });
  grip.addEventListener('dragend', () => {
    tr.classList.remove('rp-row--dragging');
    if (!rpDragRowDropped) renderReparto(); // cancelado: restaura el orden guardado
    rpDragRow = null;
  });
  tdGrip.appendChild(grip);

  const tdMatch = document.createElement('td');
  tdMatch.className = 'rp-cell-match';
  const matches = row.responsable === row.autor;
  const matchIcon = document.createElement('span');
  matchIcon.textContent = matches ? '✅' : '⚠️';
  matchIcon.title = matches ? 'El responsable coincide con el autor' : 'El responsable no coincide con el autor';
  matchIcon.setAttribute('aria-label', matchIcon.title);
  tdMatch.appendChild(matchIcon);

  const tdTask = document.createElement('td');
  const title = document.createElement('span');
  title.className = 'rp-cell-task' + (row.tarea ? '' : ' rp-placeholder');
  title.textContent = row.tarea || 'Sin título';
  tdTask.appendChild(title);

  const tdOwner = document.createElement('td');
  tdOwner.appendChild(rpPerson(row.responsable));

  const tdAuthor = document.createElement('td');
  tdAuthor.appendChild(rpPerson(row.autor));

  const tdFreq = document.createElement('td');
  const freq = document.createElement('span');
  freq.className = 'rp-cell-freq';
  freq.textContent = rpFreqLabel(row);
  tdFreq.appendChild(freq);

  // El botón solo existe si hay instrucciones; si no, la celda queda vacía.
  const tdInstr = document.createElement('td');
  if (rpHasInstructions(row.instrucciones)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rp-instr-btn';
    btn.setAttribute('aria-label', `Ver instrucciones de ${row.tarea || 'la fila'}`);
    btn.innerHTML = RP_ICON_DOC;
    const btnText = document.createElement('span');
    btnText.textContent = 'Ver';
    btn.appendChild(btnText);
    // Sin esto, el clic burbujearía a la fila y abriría también el modal de edición.
    btn.addEventListener('click', (e) => { e.stopPropagation(); rpOpenViewModal(row, btn); });
    tdInstr.appendChild(btn);
  }

  const tdDuplicate = document.createElement('td');
  const dupBtn = document.createElement('button');
  dupBtn.type = 'button';
  dupBtn.className = 'rp-row-duplicate';
  dupBtn.title = 'Duplicar fila';
  dupBtn.setAttribute('aria-label', `Duplicar ${row.tarea || 'la fila'}`);
  dupBtn.innerHTML = RP_ICON_COPY;
  dupBtn.addEventListener('click', (e) => { e.stopPropagation(); rpDuplicateRow(row); });
  tdDuplicate.appendChild(dupBtn);

  tr.append(tdGrip, tdMatch, tdTask, tdInstr, tdOwner, tdAuthor, tdFreq, tdDuplicate);
  tr.addEventListener('click', () => rpOpenModal(row));
  tr.addEventListener('keydown', (e) => {
    if (e.target !== tr) return; // el Enter sobre el botón de instrucciones es suyo
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); rpOpenModal(row); }
  });
  return tr;
}

// Las secciones se derivan de las propias filas, y su orden es el de aparición
// de sus filas en repartoRows. Las recién creadas sin filas (repartoSections)
// van detrás, hasta que reciben la primera.
function rpGroupRows(tab = rpActiveTab) {
  const groups = new Map();
  rpTabRows(tab).forEach(row => {
    const key = row.seccion || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  repartoSections.forEach(s => {
    if (rpTabOf(s.pestana) === tab && !groups.has(s.seccion)) groups.set(s.seccion, []);
  });
  return [...groups.entries()].map(([key, rows]) => ({ key, rows }));
}

function rpCreateSection(name) {
  const clean = name.trim();
  if (clean && !rpSectionNames().includes(clean)) {
    repartoSections.push({ pestana: rpActiveTab, seccion: clean });
    saveReparto();
  }
  renderReparto();
}

// Solo se borran secciones vacías: con filas, basta con renombrarla o mover
// sus filas a otra.
function rpDeleteSection(key) {
  repartoSections = repartoSections.filter(s => !(rpTabOf(s.pestana) === rpActiveTab && s.seccion === key));
  renderReparto();
  saveReparto();
}

// --- Modal de sección (crear y renombrar) ---

const rpSectionModal = document.getElementById('rp-section-modal');
const rpSectionName  = document.getElementById('rp-section-name');
const rpSectionSave  = document.getElementById('rp-section-save');
let rpSectionEditing  = null;  // null = sección nueva; si no, su nombre actual
let rpSectionLastFocus = null;

function rpOpenSectionModal(key = null) {
  rpSectionEditing = key;
  rpSectionLastFocus = document.activeElement;
  document.getElementById('rp-section-title').textContent =
    key === null ? 'Nueva sección' : 'Renombrar sección';
  rpSectionName.value = key ?? '';
  rpSyncSectionSave();
  rpSectionModal.hidden = false;
  document.body.classList.add('rp-modal-open');
  rpSectionName.focus();
  rpSectionName.select();
}

function rpCloseSectionModal() {
  rpSectionModal.hidden = true;
  document.body.classList.remove('rp-modal-open');
  rpSectionEditing = null;
  if (rpSectionLastFocus?.isConnected) rpSectionLastFocus.focus();
  rpSectionLastFocus = null;
}

function rpSyncSectionSave() {
  rpSectionSave.disabled = !rpSectionName.value.trim();
}

function rpSaveSectionModal() {
  const name = rpSectionName.value.trim();
  if (!name) { rpSectionName.focus(); return; }
  const key = rpSectionEditing;
  rpCloseSectionModal();
  if (key === null) rpCreateSection(name);
  else rpRenameSection(key, name);
}

rpSectionName?.addEventListener('input', rpSyncSectionSave);
rpSectionName?.addEventListener('keydown', (e) => { if (e.key === 'Enter') rpSaveSectionModal(); });
rpSectionSave?.addEventListener('click', rpSaveSectionModal);
document.getElementById('rp-section-cancel')?.addEventListener('click', rpCloseSectionModal);
document.getElementById('rp-section-close')?.addEventListener('click', rpCloseSectionModal);
document.getElementById('rp-section-backdrop')?.addEventListener('click', rpCloseSectionModal);

// Las secciones que ofrece el modal son las de la pestaña de esa fila.
function rpSectionNames(tab = rpActiveTab) {
  return rpGroupRows(tab).map(g => g.key).filter(Boolean);
}

// Renombrar = reetiquetar todas las filas del grupo. Con nombre vacío las saca
// de la sección; con el nombre de otra sección existente, ambas se fusionan.
function rpRenameSection(oldKey, newName) {
  const name = newName.trim();
  if (name === oldKey) return;
  rpTabRows().forEach(row => {
    if ((row.seccion || '') === oldKey) row.seccion = name;
  });
  // Una sección vacía renombrada a '' desaparece (rpPruneSections).
  repartoSections.forEach(s => {
    if (rpTabOf(s.pestana) === rpActiveTab && s.seccion === oldKey) s.seccion = name;
  });
  renderReparto();
  saveReparto();
}

// Reordenar = mover el bloque de filas de esa sección dentro del array. De paso
// deja las filas agrupadas de forma contigua, que es como se leen luego.
function rpApplySectionOrder(keys) {
  const pending = new Map(rpGroupRows().map(g => [g.key, g.rows]));
  const ordered = [];
  keys.forEach(key => {
    if (!pending.has(key)) return;
    ordered.push(...pending.get(key));
    pending.delete(key);
  });
  pending.forEach(rows => ordered.push(...rows)); // por si alguna no venía en la lista
  rpReplaceActiveTabRows(ordered);
  renderReparto();
  saveReparto();
}

// Sustituye las filas de la pestaña activa conservando las del resto: el orden
// entre pestañas es irrelevante, pero sus filas no deben perderse ni moverse.
function rpReplaceActiveTabRows(rows) {
  const others = repartoRows.filter(row => rpTabOf(row.pestana) !== rpActiveTab);
  repartoRows = [...rows, ...others];
}

function rpMoveSection(key, direction) {
  const keys = rpGroupRows().map(g => g.key);
  const i = keys.indexOf(key);
  const j = i + direction;
  if (i === -1 || j < 0 || j >= keys.length) return;
  [keys[i], keys[j]] = [keys[j], keys[i]];
  rpApplySectionOrder(keys);
}

// --- Arrastrar para reordenar (secciones y filas) ---
// Arrastre nativo del navegador (HTML5 DnD). En táctil no existe: para
// secciones quedan Subir/Bajar del menú.
let rpDragGroup = null;
let rpDragDropped = false;
let rpDragRow = null;
let rpDragRowDropped = false;

// Reconstruye el modelo leyendo el DOM: primero el orden de las secciones y,
// dentro de cada una, el de sus filas.
function rpApplyDomOrder() {
  const pending = new Map(rpTabRows().map(r => [r.id, r]));
  const ordered = [];
  rpGroups.querySelectorAll('.rp-group').forEach(groupEl => {
    groupEl.querySelectorAll('tbody tr').forEach(tr => {
      const row = pending.get(tr.dataset.id);
      if (!row) return;
      ordered.push(row);
      pending.delete(tr.dataset.id);
    });
  });
  pending.forEach(row => ordered.push(row)); // salvaguarda: nada se pierde
  rpReplaceActiveTabRows(ordered);
  renderReparto();
  saveReparto();
}

rpGroups?.addEventListener('dragover', (e) => {
  if (!rpDragGroup && !rpDragRow) return;
  e.preventDefault(); // imprescindible para que se dispare el 'drop' al soltar

  if (rpDragRow) {
    const overRow = e.target.closest?.('tr');
    if (!overRow || overRow === rpDragRow) return;
    const tbody = rpDragRow.parentElement;
    if (overRow.parentElement !== tbody) return; // solo dentro de la misma tabla
    const rect = overRow.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    tbody.insertBefore(rpDragRow, before ? overRow : overRow.nextSibling);
    return;
  }

  const over = e.target.closest?.('.rp-group');
  if (!over || over === rpDragGroup) return;
  const rect = over.getBoundingClientRect();
  const before = (e.clientY - rect.top) < rect.height / 2;
  rpGroups.insertBefore(rpDragGroup, before ? over : over.nextSibling);
});

rpGroups?.addEventListener('drop', (e) => {
  if (!rpDragGroup && !rpDragRow) return;
  e.preventDefault();
  if (rpDragRow) rpDragRowDropped = true; else rpDragDropped = true;
  rpApplyDomOrder();
});

function rpOpenSectionMenu(btn, key, index, total, isEmpty) {
  rpOpenPopover(btn, (pop, close) => {
    const list = document.createElement('div');
    list.className = 'rp-popover-list';

    const add = (label, disabled, onClick) => {
      const opt = rpOption({ label, selected: false, multi: false, onClick: () => { close(); onClick(); } });
      if (disabled) {
        opt.disabled = true;
        opt.classList.add('rp-option--disabled');
      }
      list.appendChild(opt);
    };

    add('Renombrar sección', false, () => rpOpenSectionModal(key));
    // Las vacías no tienen filas que mover: siempre van al final.
    add('Subir', isEmpty || index === 0, () => rpMoveSection(key, -1));
    add('Bajar', isEmpty || index === total - 1, () => rpMoveSection(key, 1));
    if (isEmpty) add('Eliminar sección', false, () => rpDeleteSection(key));

    pop.appendChild(list);
  });
}

// La copia se inserta justo debajo del original y conserva su sección.
function rpDuplicateRow(row) {
  const copy = { ...row, id: rpNewId(), rutina: [...row.rutina] };
  const i = repartoRows.findIndex(r => r.id === row.id);
  repartoRows.splice(i === -1 ? repartoRows.length : i + 1, 0, copy);
  renderReparto();
  saveReparto();
}

// --- Pestañas ---
// Son fijas (RP_TABS): aquí solo se pintan. No hay crear, renombrar, reordenar
// ni borrar, así que tampoco hay menú de pestaña ni arrastre.

function renderRepartoTabs() {
  if (!rpTabsBar) return;
  rpTabsBar.innerHTML = '';

  // Pestaña de resumen: sin contador, porque resume todas las demás.
  const fixed = document.createElement('div');
  fixed.className = 'rp-tab rp-tab--fixed' + (rpActiveTab === RP_SUMMARY_TAB ? ' rp-tab--active' : '');
  const fixedBtn = document.createElement('button');
  fixedBtn.type = 'button';
  fixedBtn.className = 'rp-tab-btn';
  fixedBtn.setAttribute('role', 'tab');
  fixedBtn.setAttribute('aria-selected', String(rpActiveTab === RP_SUMMARY_TAB));
  fixedBtn.textContent = RP_SUMMARY_TAB;
  fixedBtn.addEventListener('click', () => rpSetActiveTab(RP_SUMMARY_TAB));
  fixed.appendChild(fixedBtn);
  rpTabsBar.appendChild(fixed);

  rpDataTabs().forEach(name => {
    const tab = document.createElement('div');
    tab.className = 'rp-tab' + (name === rpActiveTab ? ' rp-tab--active' : '');
    if (name === RP_ORPHAN_TAB) tab.classList.add('rp-tab--orphan');
    tab.dataset.tab = name;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rp-tab-btn';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(name === rpActiveTab));
    btn.textContent = name;
    if (name === RP_ORPHAN_TAB) {
      btn.dataset.tooltip = 'Filas guardadas en una pestaña que ya no existe. Ábrelas y elige su pestaña: cuando no quede ninguna, esta desaparece.';
    }

    const count = document.createElement('span');
    count.className = 'rp-tab-count';
    count.textContent = rpTabRows(name).length;
    btn.appendChild(count);

    btn.addEventListener('click', () => rpSetActiveTab(name));
    tab.appendChild(btn);

    rpTabsBar.appendChild(tab);
  });
}

// --- Pestaña fija: resumen del reparto ---

// Las filas de "Ambos" cuentan como media tarea para cada uno; las de nadie
// ("Sin asignar" en responsable, "Sin atender" en autor) son una tercera
// porción. Entre las tres suman 100 %. 'field' elige la columna que se mide.
const RP_NOBODY = { responsable: 'sin-asignar', autor: 'sin-atender' };

function rpSummaryStats(rows = repartoRows, field = 'responsable') {
  const nobodyKey = RP_NOBODY[field];
  let cristina = 0, fernando = 0, ambos = 0, nobody = 0;
  rows.forEach(row => {
    if (row[field] === 'fernando') fernando++;
    else if (row[field] === 'ambos') ambos++;
    else if (row[field] === nobodyKey) nobody++;
    else cristina++;
  });
  const total = rows.length;
  const cWeight = cristina + ambos / 2;
  const fWeight = fernando + ambos / 2;
  const pct = w => (total ? (w / total) * 100 : 0);
  return {
    total, ambos, nobodyKey,
    cristina: { own: cristina, weight: cWeight, pct: pct(cWeight) },
    fernando: { own: fernando, weight: fWeight, pct: pct(fWeight) },
    nobody: { own: nobody, weight: nobody, pct: pct(nobody) },
  };
}

function rpDonut(stats) {
  const r = 62;
  const c = 2 * Math.PI * r;
  const cLen = (stats.cristina.pct / 100) * c;
  const fLen = (stats.fernando.pct / 100) * c;
  const uLen = (stats.nobody.pct / 100) * c;
  const nobody = RP_OWNERS[stats.nobodyKey];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 160 160');
  svg.setAttribute('class', 'rp-donut');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label',
    `Cristina ${Math.round(stats.cristina.pct)} %, Fernando ${Math.round(stats.fernando.pct)} %` +
    (stats.nobody.own ? `, ${nobody.label.toLowerCase()} ${Math.round(stats.nobody.pct)} %` : ''));
  svg.innerHTML = `
    <circle cx="80" cy="80" r="${r}" fill="none" stroke="#eeeef2" stroke-width="20"></circle>
    <circle cx="80" cy="80" r="${r}" fill="none" stroke="${RP_OWNERS.cristina.color}" stroke-width="20"
            stroke-dasharray="${cLen} ${c}" stroke-dashoffset="0"
            transform="rotate(-90 80 80)" stroke-linecap="butt"></circle>
    <circle cx="80" cy="80" r="${r}" fill="none" stroke="${RP_OWNERS.fernando.color}" stroke-width="20"
            stroke-dasharray="${fLen} ${c}" stroke-dashoffset="${-cLen}"
            transform="rotate(-90 80 80)" stroke-linecap="butt"></circle>
    <circle cx="80" cy="80" r="${r}" fill="none" stroke="${nobody.color}" stroke-width="20"
            stroke-dasharray="${uLen} ${c}" stroke-dashoffset="${-(cLen + fLen)}"
            transform="rotate(-90 80 80)" stroke-linecap="butt"></circle>
    <text x="80" y="75" text-anchor="middle" class="rp-donut-total">${stats.total}</text>
    <text x="80" y="93" text-anchor="middle" class="rp-donut-label">${stats.total === 1 ? 'tarea' : 'tareas'}</text>
  `;
  return svg;
}

function rpSummaryLegendRow(key, data) {
  const meta = RP_OWNERS[key];
  const item = document.createElement('div');
  item.className = 'rp-legend-item';

  const dot = document.createElement('span');
  dot.className = 'rp-legend-dot';
  dot.style.background = meta.color;

  const text = document.createElement('div');
  const name = document.createElement('p');
  name.className = 'rp-legend-name';
  name.textContent = meta.label;
  const detail = document.createElement('p');
  detail.className = 'rp-legend-detail';
  detail.textContent = `${data.own} ${data.own === 1 ? 'tarea' : 'tareas'}`;
  text.append(name, detail);

  const pct = document.createElement('span');
  pct.className = 'rp-legend-pct';
  pct.textContent = `${Math.round(data.pct)} %`;

  item.append(dot, text, pct);
  return item;
}

// Sin 'tab' resume todas las pestañas (General); con 'tab' solo las filas de
// esa pestaña, y si está vacía no se muestra nada (ya sale la tarjeta vacía).
function renderRepartoSummary(tab = null) {
  if (!rpSummary) return;
  rpSummary.innerHTML = '';
  const rows = tab ? rpTabRows(tab) : repartoRows;
  rpSummary.hidden = Boolean(tab) && !rows.length;

  if (!rows.length) {
    if (tab) return;
    const empty = document.createElement('div');
    empty.className = 'rp-card rp-empty';
    empty.innerHTML = `
      <p class="rp-empty-title">Todavía no hay nada que repartir</p>
      <p class="rp-empty-text">Cuando añadas tareas en las otras pestañas, aquí verás cómo se reparten.</p>`;
    rpSummary.appendChild(empty);
    return;
  }

  // Mismo widget dos veces: lo asignado (responsable) y lo que de verdad hace
  // cada uno (autor).
  rpSummary.appendChild(rpDistributionCard(rows, tab, {
    field: 'responsable',
    title: 'Reparto de tareas',
    ambosNote: n => `${n} ${n === 1 ? 'tarea asignada' : 'tareas asignadas'} a Ambos, repartidas a medias entre los dos.`,
    collapseKey: RP_SUMMARY_COLLAPSED_KEY,
  }));
  rpSummary.appendChild(rpDistributionCard(rows, tab, {
    field: 'autor',
    title: 'Responsabilidad real',
    ambosNote: n => `${n} ${n === 1 ? 'tarea hecha' : 'tareas hechas'} por Ambos, repartidas a medias entre los dos.`,
    collapseKey: RP_REAL_COLLAPSED_KEY,
  }));

  if (!tab) rpSummary.appendChild(rpIncidentsCard(repartoRows));
}

function rpDistributionCard(rows, tab, { field, title, ambosNote, collapseKey }) {
  const stats = rpSummaryStats(rows, field);

  const card = document.createElement('div');
  card.className = 'rp-card rp-summary-card';

  const head = document.createElement('div');
  head.className = 'rp-summary-head';
  const h2 = document.createElement('h2');
  h2.textContent = title;
  const sub = document.createElement('p');
  const count = `${stats.total} ${stats.total === 1 ? 'tarea' : 'tareas'}`;
  sub.textContent = tab ? count : `Todas las pestañas, ${count} en total.`;
  head.append(h2, sub);

  const body = document.createElement('div');
  body.className = 'rp-summary-body';
  body.appendChild(rpDonut(stats));

  const legend = document.createElement('div');
  legend.className = 'rp-legend';
  legend.append(
    rpSummaryLegendRow('cristina', stats.cristina),
    rpSummaryLegendRow('fernando', stats.fernando),
  );
  if (stats.nobody.own) legend.appendChild(rpSummaryLegendRow(stats.nobodyKey, stats.nobody));

  if (stats.ambos) {
    const note = document.createElement('p');
    note.className = 'rp-legend-note';
    note.textContent = ambosNote(stats.ambos);
    legend.appendChild(note);
  }

  body.appendChild(legend);
  card.append(head, body);
  if (tab) rpMakeSummaryCollapsible(card, head, body, collapseKey);
  return card;
}

// --- Pestaña fija: incidencias (el autor no coincide con el responsable) ---

// [responsable, autor], en el orden en que se listan. Autor null = cualquiera:
// las filas sin responsable son incidencia las haga quien las haga.
const RP_INCIDENTS = [
  ['fernando', 'cristina'],
  ['ambos', 'cristina'],
  ['cristina', 'fernando'],
  ['ambos', 'fernando'],
  ['cristina', 'ambos'],
  ['fernando', 'ambos'],
  ['cristina', 'sin-atender'],
  ['fernando', 'sin-atender'],
  ['ambos', 'sin-atender'],
  ['sin-asignar', null],
];

function rpIncidentsCard(rows) {
  const counts = RP_INCIDENTS.map(([owner, author]) =>
    rows.filter(r => r.responsable === owner && (author === null || r.autor === author)).length);
  const total = counts.reduce((a, b) => a + b, 0);

  const card = document.createElement('div');
  card.className = 'rp-card rp-summary-card rp-incidents-card';

  const head = document.createElement('div');
  head.className = 'rp-summary-head';
  const h2 = document.createElement('h2');
  h2.textContent = 'Incidencias';
  const sub = document.createElement('p');
  sub.textContent = total
    ? `${total} ${total === 1 ? 'tarea' : 'tareas'} con incidencias en todas las pestañas.`
    : 'Ninguna incidencia: todas las tareas tienen responsable y las atiende quien toca.';
  head.append(h2, sub);

  const list = document.createElement('ul');
  list.className = 'rp-incidents';
  RP_INCIDENTS.forEach(([owner, author], i) => {
    if (!counts[i]) return; // solo se listan los tipos que tienen incidencias
    const item = document.createElement('li');
    item.className = 'rp-incident';

    const badges = document.createElement('span');
    badges.className = 'rp-incident-badges';
    const arrow = document.createElement('span');
    arrow.className = 'rp-incident-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '→';
    const text = document.createElement('span');
    text.className = 'rp-incident-text';
    if (author === null) {
      badges.appendChild(rpOwnerBadge(owner));
      text.textContent = 'Sin responsable asignado';
    } else {
      badges.append(rpOwnerBadge(owner), arrow, rpOwnerBadge(author));
      const doer = author === 'sin-atender' ? 'nadie las atiende'
        : author === 'ambos' ? 'las hacen ambos'
        : `las hace ${RP_OWNERS[author].label}`;
      const assignee = owner === 'ambos' ? 'ambos' : RP_OWNERS[owner].label;
      text.textContent = `Asignadas a ${assignee}, pero ${doer}`;
    }

    const count = document.createElement('span');
    count.className = 'rp-incident-count';
    count.textContent = counts[i];

    item.append(badges, text, count);
    list.appendChild(item);
  });

  card.appendChild(head);
  if (total) card.appendChild(list);
  return card;
}

// Solo en las pestañas: plegado se ve el título y el total. Empieza plegado;
// cada widget recuerda su estado, común a todas las pestañas y solo de este
// navegador.
const RP_SUMMARY_COLLAPSED_KEY = 'compra-rp-summary-collapsed';
const RP_REAL_COLLAPSED_KEY    = 'compra-rp-real-collapsed';

function rpSummaryCollapsed(key) {
  try { return localStorage.getItem(key) !== '0'; } catch { return true; }
}

function rpMakeSummaryCollapsible(card, head, body, key) {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'rp-summary-toggle';
  toggle.setAttribute('aria-label', 'Mostrar u ocultar el widget');
  toggle.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

  const text = document.createElement('div');
  text.append(...head.childNodes);
  head.append(text, toggle);
  head.classList.add('rp-summary-head--toggle');

  const apply = (collapsed) => {
    card.classList.toggle('rp-summary-card--collapsed', collapsed);
    body.hidden = collapsed;
    toggle.setAttribute('aria-expanded', String(!collapsed));
  };
  apply(rpSummaryCollapsed(key));

  head.addEventListener('click', () => {
    const collapsed = !card.classList.contains('rp-summary-card--collapsed');
    try { localStorage.setItem(key, collapsed ? '1' : '0'); } catch {}
    apply(collapsed);
  });
}

// --- Listados de la pestaña «Tareas» de cada sección del rail ---------------
// Cada sección del rail (menos General) tiene una pestaña «Tareas» que lista
// los títulos de las filas que el Reparto tiene en su pestaña. Es solo lectura:
// las tareas se crean y se editan en el Reparto. Los nombres de pestaña son los
// de RP_TABS.
const RP_RAIL_TASK_LISTS = {
  'tareas-lista-residuos':  'Gestión de residuos',
  'tareas-lista-lavanderia': 'Lavandería',
  'tareas-lista-limpieza':  'Limpieza',
  'tareas-lista-compras':   'Compras',
  'tareas-lista-cocina':    'Cocina',
};

// Pestaña del rail en la que se lista cada pestaña del Reparto. Sirve para
// saltar a una tarea desde otro formulario. Las filas de la pestaña de rescate
// («Sin clasificar») no están en ninguna: solo se ven en General › Reparto.
const RP_TAB_RAIL_TAB = {
  'Gestión de residuos': 'tareas-residuos',
  'Lavandería':          'tareas-lavanderia',
  'Limpieza':            'tareas-limpieza',
  'Compras':             'tareas-compras',
  'Cocina':              'tareas-cocina',
};

// Abre una tarea desde fuera: lleva a su pestaña «Tareas» y abre el panel desde
// su propia fila, que es la que le dice en qué sección colocarse.
function openTareaFromTab(row, tabId) {
  activateTab(tabId);
  const item = document.querySelector(`#${tabId} .tareas-list [data-id="${row.id}"]`);
  if (item) openTareaPanel(row, item);
}

// --- Panel lateral de tarea ---
// Mismo panel que Ingredientes: en escritorio, columna a la derecha de la
// lista; en móvil, a pantalla completa. Solo título e instrucciones, y se
// guarda solo, como Ingredientes: al salir de cada campo (y en Instrucciones,
// también mientras se escribe). Hay un único panel para las cinco pestañas
// «Tareas»: al abrirlo se mueve a la que se mira.
const tareaPanel      = document.getElementById('tareaPanel');
const tareaTitleInput = document.getElementById('tareaTitleInput');

// Instrucciones: tema bubble, sin barra fija ni marco; la barra de formato
// aparece flotando al seleccionar texto. Además de negrita, cursiva y listas
// numerada y de puntos, trae la lista de casillas.
const tareaInstrQuill = new Quill('#tareaInstrEditor', {
  theme: 'bubble',
  placeholder: 'Pasos, detalles, lo que haga falta…',
  modules: {
    toolbar: [
      ['bold', 'italic'],
      [{ list: 'ordered' }, { list: 'bullet' }, { list: 'check' }],
    ],
  },
});

// --- Menciones en Instrucciones ---
// Lo que ofrece «@» es lo del área de la tarea abierta: los consumibles que se
// ven en su pestaña «Consumibles» y, en Limpieza, también sus utensilios. En
// Compras la pestaña enseña todos los consumibles, así que ahí no se filtra.
const TAREA_MENTION_SCOPES = {
  'tareas-compras':    { category: '*',          utensils: false },
  'tareas-cocina':     { category: 'cocina',     utensils: false },
  'tareas-limpieza':   { category: 'limpieza',   utensils: true  },
  'tareas-lavanderia': { category: 'lavanderia', utensils: false },
  'tareas-residuos':   { category: 'residuos',   utensils: false },
};

let tareaMentionScope = null;

function tareaMentionOptions() {
  const scope = tareaMentionScope;
  if (!scope) return [];
  return mentionItems().filter((it) => (it.tipo === 'utensilio'
    ? scope.utensils
    : scope.category === '*' || it.category === scope.category));
}

// El menú cuelga del contenedor del editor: así viaja con él al modal de
// «Ampliar» y se coloca con las coordenadas que da Quill.
const tareaMentionMenu = document.createElement('div');
tareaMentionMenu.className = 'mention-menu';
tareaMentionMenu.hidden = true;
tareaInstrQuill.container.appendChild(tareaMentionMenu);

let tareaMentionAt      = null; // índice del «@» en el documento
let tareaMentionMatches = [];
let tareaMentionActive  = 0;

function closeTareaMentionMenu() {
  tareaMentionMenu.hidden = true;
  tareaMentionAt = null;
  tareaMentionMatches = [];
}

function renderTareaMentionMenu() {
  tareaMentionMenu.innerHTML = '';
  tareaMentionMatches.forEach((item, i) => {
    const opt = document.createElement('button');
    opt.type = 'button';
    opt.className = 'mention-option' + (i === tareaMentionActive ? ' mention-option--active' : '');

    const dot = document.createElement('span');
    dot.className = 'mention-option-dot';
    dot.style.setProperty('--mention-color', MENTION_TYPES[item.tipo]?.color);

    const name = document.createElement('span');
    name.className = 'mention-option-name';
    name.textContent = item.nombre;

    const type = document.createElement('span');
    type.className = 'mention-option-type';
    type.textContent = MENTION_TYPES[item.tipo]?.singular ?? '';

    opt.append(dot, name, type);
    // mousedown + preventDefault: el editor no pierde el foco ni la selección
    opt.addEventListener('mousedown', (e) => { e.preventDefault(); insertTareaMention(item); });
    tareaMentionMenu.appendChild(opt);
  });
}

function updateTareaMentionMenu() {
  const sel = tareaInstrQuill.getSelection();
  if (!sel || sel.length) { closeTareaMentionMenu(); return; }

  // Busca el «@» más cercano en la línea actual, al inicio o tras un espacio.
  const [line, offset] = tareaInstrQuill.getLine(sel.index);
  if (!line) { closeTareaMentionMenu(); return; }
  const lineStart = sel.index - offset;
  // getText omite los embeds; con un carácter de relleno los índices cuadran.
  const before = tareaInstrQuill.getContents(lineStart, offset).ops
    .map((op) => (typeof op.insert === 'string' ? op.insert : '￼')).join('');
  const at = before.lastIndexOf('@');
  if (at === -1 || (at > 0 && !/\s/.test(before[at - 1]))) { closeTareaMentionMenu(); return; }

  const query = mentionNormalize(before.slice(at + 1));
  if (query.length > 40) { closeTareaMentionMenu(); return; }

  const matches = tareaMentionOptions()
    .filter((m) => mentionNormalize(m.nombre).includes(query))
    .sort((a, b) => {
      const as = mentionNormalize(a.nombre).startsWith(query) ? 0 : 1;
      const bs = mentionNormalize(b.nombre).startsWith(query) ? 0 : 1;
      return as - bs || a.nombre.localeCompare(b.nombre, 'es');
    })
    .slice(0, 8);
  if (!matches.length) { closeTareaMentionMenu(); return; }

  const newAt = lineStart + at;
  if (newAt !== tareaMentionAt) tareaMentionActive = 0;
  tareaMentionAt = newAt;
  tareaMentionMatches = matches;
  tareaMentionActive = Math.min(tareaMentionActive, matches.length - 1);
  renderTareaMentionMenu();

  const bounds = tareaInstrQuill.getBounds(tareaMentionAt);
  tareaMentionMenu.style.top  = `${bounds.bottom + 4}px`;
  tareaMentionMenu.style.left = `${Math.max(0, bounds.left)}px`;
  tareaMentionMenu.hidden = false;
}

function insertTareaMention(item) {
  if (tareaMentionAt === null || !item) return;
  const sel = tareaInstrQuill.getSelection(true);
  const at = tareaMentionAt;
  closeTareaMentionMenu();
  tareaInstrQuill.deleteText(at, sel.index - at, Quill.sources.USER);
  tareaInstrQuill.insertEmbed(at, 'mention', { id: item.id, nombre: item.nombre, tipo: item.tipo }, Quill.sources.USER);
  tareaInstrQuill.insertText(at + 1, ' ', Quill.sources.USER);
  tareaInstrQuill.setSelection(at + 2, 0, Quill.sources.USER);
}

// Solo reacciona a lo que hace la usuaria, no a los pegados programáticos
// (en text-change y selection-change el origen es el tercer argumento).
tareaInstrQuill.on('editor-change', (eventName, _a, _b, source) => {
  if (source !== Quill.sources.USER) { closeTareaMentionMenu(); return; }
  updateTareaMentionMenu();
});

// Captura: se adelanta al módulo de teclado de Quill (Enter, flechas) y al
// Escape que cierra el modal de «Ampliar».
tareaInstrQuill.root.addEventListener('keydown', (e) => {
  if (tareaMentionMenu.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const step = e.key === 'ArrowDown' ? 1 : -1;
    tareaMentionActive = (tareaMentionActive + step + tareaMentionMatches.length) % tareaMentionMatches.length;
    renderTareaMentionMenu();
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    insertTareaMention(tareaMentionMatches[tareaMentionActive]);
  } else if (e.key === 'Escape') {
    closeTareaMentionMenu();
  } else {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
}, true);

tareaInstrQuill.root.addEventListener('blur', closeTareaMentionMenu);

// --- Utensilios y consumibles mencionados ---
// Las dos secciones que van encima de Instrucciones: se rellenan solas con lo
// que se haya mencionado en el texto, sin repetir y en el orden en que aparece.
// Si no hay nada de ese tipo, la sección se queda vacía y no se ve, como
// «Usado en» en Editar ingrediente.
const TAREA_USED_ICONS = {
  utensilio: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 7.5H20L18.4 19.7C18.33 20.2 17.91 20.5 17.4 20.5H6.6C6.09 20.5 5.67 20.2 5.6 19.7L4 7.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M8 7.5C8 5.3 9.79 3.5 12 3.5C14.21 3.5 16 5.3 16 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`,
  consumible: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="14.5" y="4.5" width="4" height="4" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M18.5 8.5L20.5 10.5V20.5C20.5 21.0523 20.0523 21.5 19.5 21.5H13.5C12.9477 21.5 12.5 21.0523 12.5 20.5V10.5L14.5 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M12.5 13.5L20.5 11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M12.5 18.5L20.5 16.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M3.5 7.5H3.51" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M7.5 9.5H7.51" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M3.5 11.5H3.51" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
};

const TAREA_USED_SECTIONS = [
  { hostId: 'tareaUtensiliosUsed',  tipo: 'utensilio',  label: 'Utensilios' },
  { hostId: 'tareaConsumiblesUsed', tipo: 'consumible', label: 'Consumibles' },
];

// Menciones que hay ahora mismo en el editor, en orden y sin repetir.
function tareaMentionsInText() {
  const seen = new Set();
  const list = [];
  tareaInstrQuill.getContents().ops.forEach((op) => {
    const m = op.insert?.mention;
    if (!m || !m.id || seen.has(m.id)) return;
    seen.add(m.id);
    list.push(m);
  });
  return list;
}

// Lo pintado la última vez: con cada tecla se comprueba y, si las menciones no
// han cambiado, no se repinta nada.
let tareaUsedSignature = null;

function renderTareaUsedSections(force = false) {
  const mentions = tareaMentionsInText();
  const signature = mentions.map((m) => `${m.tipo}:${m.id}`).join('|');
  if (!force && signature === tareaUsedSignature) return;
  tareaUsedSignature = signature;

  const items = mentionItems();

  TAREA_USED_SECTIONS.forEach(({ hostId, tipo, label }) => {
    const host = document.getElementById(hostId);
    if (!host) return;

    host.innerHTML = '';
    const rows = mentions.filter((m) => m.tipo === tipo);
    if (!rows.length) return;

    // Solo el texto: el icono va en cada fila, no en el título de la sección.
    const title = document.createElement('p');
    title.className = 'field-label-small';
    title.textContent = label;
    host.appendChild(title);

    const ul = document.createElement('ul');
    ul.className = 'tarea-used-list';

    rows.forEach((m) => {
      const item = items.find((it) => it.id === m.id);

      const li = document.createElement('li');
      li.className = 'tarea-used-row';
      // Si el material ya no existe se enseña tachado, igual que la píldora.
      if (!item) li.classList.add('tarea-used-row--missing');

      li.innerHTML = TAREA_USED_ICONS[tipo];
      li.firstElementChild?.classList.add('tarea-used-icon');

      const name = document.createElement('span');
      name.textContent = item?.nombre || m.nombre || '';
      li.appendChild(name);

      ul.appendChild(li);
    });

    host.appendChild(ul);
  });
}

let tareaPanelRowId = null;
// Instrucciones tal y como se cargaron, ya pasadas por el filtro del editor.
// Si al salir siguen igual no se guarda nada: abrir y cerrar una tarea no debe
// reescribir sus instrucciones.
let tareaPanelLoadedInstr = '';
let tareaInstrSaveTimer = null;

// HTML tal y como lo deja Quill, o cadena vacía si no hay texto: así vuelve el
// placeholder en lugar de guardarse un '<p><br></p>'.
function tareaInstrHtml() {
  const html = tareaInstrQuill.root.innerHTML;
  return rpHasInstructions(html) ? html : '';
}

function markSelectedTarea() {
  // Filas de la tabla (escritorio) o de la lista (móvil).
  document.querySelectorAll('.tareas-list [data-id]').forEach(el => {
    el.classList.toggle('is-selected', el.dataset.id === tareaPanelRowId);
  });
}

function openTareaPanel(row, item) {
  if (!tareaPanel) return;
  closeTareaInstrModal(); // el editor tiene que estar en el panel, no en el modal
  closeTareaMentionMenu();
  saveTareaPanel(); // por si quedaba otra tarea abierta con cambios

  const section = item.closest('.tareas-tab');
  if (section && tareaPanel.parentElement !== section) section.appendChild(tareaPanel);

  // Las menciones que se ofrecen son las del área de esta pestaña.
  tareaMentionScope = TAREA_MENTION_SCOPES[section?.id] ?? null;

  tareaPanelRowId = row.id;
  tareaTitleInput.value = row.tarea;
  // El pegado dispara 'text-change': se descarta el guardado que programa, que
  // es de la tarea anterior.
  tareaInstrQuill.clipboard.dangerouslyPasteHTML(row.instrucciones || '');
  clearTimeout(tareaInstrSaveTimer);
  tareaPanelLoadedInstr = tareaInstrHtml();
  renderTareaUsedSections(true); // los nombres pueden haber cambiado

  markSelectedTarea();
  tareaPanel.classList.add('is-open');
}

function closeTareaPanel() {
  closeTareaInstrModal();
  closeTareaMentionMenu();
  saveTareaPanel();
  tareaPanel?.classList.remove('is-open');
  tareaPanelRowId = null;
  tareaMentionScope = null;
  markSelectedTarea();
}

function saveTareaPanel() {
  if (!tareaPanelRowId) return;
  const row = repartoRows.find(r => r.id === tareaPanelRowId);
  if (!row) return;

  // El título no puede quedar vacío (en el Reparto tampoco): se repone.
  const tarea = tareaTitleInput.value.trim();
  if (!tarea) tareaTitleInput.value = row.tarea;
  const instrucciones = tareaInstrHtml();

  const titleChanged = !!tarea && tarea !== row.tarea;
  const instrChanged = instrucciones !== tareaPanelLoadedInstr;
  if (!titleChanged && !instrChanged) return;

  if (titleChanged) row.tarea = tarea;
  if (instrChanged) {
    row.instrucciones = instrucciones;
    tareaPanelLoadedInstr = instrucciones;
  }
  renderReparto();
  saveReparto();
}

tareaTitleInput?.addEventListener('change', saveTareaPanel);
tareaTitleInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); tareaTitleInput.blur(); } // blur → change → guarda
});
// Quill no avisa de que se sale del campo: se guarda medio segundo después de
// la última tecla y, sin esperar, al salir del editor.
tareaInstrQuill.on('text-change', () => {
  clearTimeout(tareaInstrSaveTimer);
  tareaInstrSaveTimer = setTimeout(saveTareaPanel, 500);
  renderTareaUsedSections(); // las dos secciones siguen al texto
});
tareaInstrQuill.root.addEventListener('blur', () => {
  clearTimeout(tareaInstrSaveTimer);
  saveTareaPanel();
});
document.getElementById('closeTareaPanelBtn')?.addEventListener('click', closeTareaPanel);

// --- Instrucciones ampliadas (modal) ---
// Al modal se mueve el mismo editor, no una copia: así el autoguardado del
// panel sigue funcionando igual (al salir del editor se guarda, y moverlo de
// sitio es una salida más) sin duplicar contenido ni listeners.
const tareaInstrModal = document.getElementById('tareaInstrModal');

function openTareaInstrModal() {
  if (!tareaInstrModal || !tareaPanelRowId) return;
  closeTareaMentionMenu(); // al mover el editor su posición ya no vale
  document.getElementById('tareaInstrModalTitle').textContent = tareaTitleInput.value.trim() || 'Sin título';
  document.getElementById('tareaInstrModalSlot').appendChild(tareaInstrQuill.container);
  tareaInstrModal.hidden = false;
  document.body.classList.add('rp-modal-open');
  tareaInstrQuill.focus();
}

// Al cerrar, el editor vuelve a su sitio en el panel: si se quedara en el modal
// (oculto), el campo Instrucciones desaparecería del panel.
function closeTareaInstrModal() {
  if (!tareaInstrModal || tareaInstrModal.hidden) return;
  closeTareaMentionMenu();
  document.getElementById('tareaInstrHome').appendChild(tareaInstrQuill.container);
  tareaInstrModal.hidden = true;
  document.body.classList.remove('rp-modal-open');
}

document.getElementById('tareaInstrExpandBtn')?.addEventListener('click', openTareaInstrModal);
document.getElementById('tareaInstrModalClose')?.addEventListener('click', closeTareaInstrModal);
document.getElementById('tareaInstrModalBackdrop')?.addEventListener('click', closeTareaInstrModal);

// Clic en el margen del modal (fuera del texto): lleva el cursor al editor.
document.getElementById('tareaInstrModalSlot')?.addEventListener('mousedown', (e) => {
  if (e.target !== e.currentTarget) return;
  e.preventDefault();
  tareaInstrQuill.focus();
});

// Escape con el modal abierto: cierra solo el modal, no el panel de edición.
// Si está desplegado el menú de «@», el Escape es para cerrarlo a él: este
// oyente se aparta y lo atiende el del editor.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !tareaInstrModal || tareaInstrModal.hidden) return;
  if (!tareaMentionMenu.hidden) return;
  e.stopPropagation();
  closeTareaInstrModal();
}, true);

function renderRailTaskLists() {
  // Si la tarea abierta en el panel se ha borrado (desde el Reparto o desde
  // otro dispositivo), el panel se cierra sin intentar guardarla.
  if (tareaPanelRowId && !repartoRows.some(r => r.id === tareaPanelRowId)) {
    closeTareaInstrModal();
    tareaPanelRowId = null;
    tareaPanel?.classList.remove('is-open');
  }

  Object.entries(RP_RAIL_TASK_LISTS).forEach(([hostId, tab]) => {
    const host = document.getElementById(hostId);
    if (!host) return;
    host.innerHTML = '';

    const rows = rpTabRows(tab);
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'tareas-empty';
      empty.textContent = `Todavía no hay tareas en «${tab}». Se crean en General › Reparto.`;
      host.appendChild(empty);
      return;
    }

    // Por nombre, en el sentido que marque la cabecera. En escritorio, la misma
    // tabla que el resto de pestañas; en móvil, su lista.
    const sorted = [...rows].sort((a, b) => {
      const cmp = (a.tarea || '').localeCompare(b.tarea || '', 'es', { sensitivity: 'base' });
      return _tareaSort.dir === 'asc' ? cmp : -cmp;
    });

    if (window.innerWidth >= 768) {
      renderTareasTable(host, sorted);
    } else {
      renderTareasList(host, sorted);
    }
  });
}

// Al pulsar (o con Enter/Espacio) se abre el panel lateral: solo título e
// instrucciones. El `tr` no lleva role="button": dejaría de ser una fila para
// los lectores de pantalla.
function openTareaOnActivate(el, row, { asButton }) {
  const open = () => openTareaPanel(row, el);
  el.tabIndex = 0;
  if (asButton) el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `Editar ${row.tarea || 'tarea sin título'}`);
  el.style.cursor = 'pointer';
  el.addEventListener('click', open);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
}

function renderTareasTable(host, rows) {
  const table = document.createElement('table');
  table.className = 'ingredient-table';

  // Una sola columna, que ordena alfabéticamente en los dos sentidos.
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const th = document.createElement('th');
  th.className = 'ingredient-th-sortable is-active';
  th.innerHTML = `Nombre<span class="sort-arrow">${_tareaSort.dir === 'asc' ? '↑' : '↓'}</span>`;
  th.addEventListener('click', () => {
    _tareaSort.dir = _tareaSort.dir === 'asc' ? 'desc' : 'asc';
    renderRailTaskLists();
  });
  headerRow.appendChild(th);
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.dataset.id = row.id;
    if (row.id === tareaPanelRowId) tr.classList.add('is-selected');

    const td = document.createElement('td');
    td.textContent = row.tarea || 'Sin título';
    if (!row.tarea) td.classList.add('tareas-item--untitled');
    tr.appendChild(td);

    openTareaOnActivate(tr, row, { asButton: false });
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  host.appendChild(table);
}

function renderTareasList(host, rows) {
  const ul = document.createElement('ul');
  rows.forEach((row) => {
    const li = document.createElement('li');
    li.className = 'ingredient-row';
    li.dataset.id = row.id;
    if (row.id === tareaPanelRowId) li.classList.add('is-selected');

    const content = document.createElement('div');
    content.className = 'ingredient-row-content';

    const left = document.createElement('div');
    left.className = 'ingredient-row-left';
    const name = document.createElement('span');
    name.className = 'ingredient-row-name';
    name.textContent = row.tarea || 'Sin título';
    if (!row.tarea) name.classList.add('tareas-item--untitled');
    left.appendChild(name);

    content.appendChild(left);
    content.insertAdjacentHTML('beforeend', `
      <span class="recipe-row-icon" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    `);

    li.appendChild(content);
    openTareaOnActivate(li, row, { asButton: true });
    ul.appendChild(li);
  });
  host.appendChild(ul);
}

let _tareasWasDesktop = window.innerWidth >= 768;
window.addEventListener('resize', () => {
  const isDesktopNow = window.innerWidth >= 768;
  if (isDesktopNow !== _tareasWasDesktop) {
    _tareasWasDesktop = isDesktopNow;
    renderRailTaskLists();
  }
});

function renderReparto() {
  if (!rpGroups) return;
  rpEnsureActiveTab();
  renderRepartoTabs();
  renderRailTaskLists(); // las listas del rail se refrescan con cualquier cambio
  renderUtensils();      // y con ellas las columnas «Usado en» de Utensilios
  renderConsumables();   // y de Consumibles

  // La pestaña fija no tiene tablas ni botón de crear. La de rescate solo
  // existe para recolocar lo que ya hay, así que tampoco deja crear nada.
  const isSummary = rpActiveTab === RP_SUMMARY_TAB;
  const isOrphan = rpActiveTab === RP_ORPHAN_TAB;
  rpAddSectionBtn.hidden = isSummary || isOrphan;
  rpGroups.hidden = isSummary;
  if (isSummary) {
    rpEmptyCard.hidden = true;
    rpGroups.innerHTML = '';
    renderRepartoSummary();
    return;
  }

  renderRepartoSummary(rpActiveTab);

  const groups = rpGroupRows();
  rpGroups.innerHTML = '';

  groups.forEach(({ key, rows }, index) => {
    const node = rpGroupTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.section = key;

    node.querySelector('.rp-group-name').textContent = key || 'Sin sección';
    node.querySelector('.rp-group-count').textContent = rows.length;

    const addBtn = node.querySelector('.rp-group-add');
    if (isOrphan) addBtn.remove();
    else addBtn.addEventListener('click', () => rpOpenModal(null, key));

    const menuBtn = node.querySelector('.rp-group-menu');
    menuBtn.addEventListener('click', () => rpOpenSectionMenu(menuBtn, key, index, groups.length, !rows.length));

    const title = node.querySelector('.rp-group-title');
    title.addEventListener('dragstart', (e) => {
      rpDragGroup = node;
      rpDragDropped = false;
      node.classList.add('rp-group--dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', key);
      }
    });
    title.addEventListener('dragend', () => {
      node.classList.remove('rp-group--dragging');
      if (!rpDragDropped) renderReparto(); // cancelado: restaura el orden guardado
      rpDragGroup = null;
    });

    const tbody = node.querySelector('tbody');
    rows.forEach(row => tbody.appendChild(rpBuildRow(row)));
    if (!rows.length) {
      const tr = document.createElement('tr');
      tr.className = 'rp-row-empty';
      const td = document.createElement('td');
      td.colSpan = 8;
      td.textContent = isOrphan
        ? 'Sección vacía.'
        : 'Sección vacía. Pulsa + para añadir la primera fila.';
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    rpGroups.appendChild(node);
  });

  rpEmptyCard.hidden = groups.length > 0; // vacío = esta pestaña, no toda la vista
}

document.getElementById('rp-empty-add')?.addEventListener('click', () => rpOpenModal());
rpAddSectionBtn?.addEventListener('click', () => rpOpenSectionModal());

// Estreno de los datos: la primera vez, y solo si el nodo propio está vacío,
// se copia tal cual el reparto de la app Tareas. De ahí en adelante los dos
// nodos van por separado; esta app nunca escribe en el de Tareas.
function rpSeedFromTareas() {
  return db.ref(RP_FB_PATH).once('value').then((own) => {
    if (own.exists()) return;
    return db.ref(RP_SEED_PATH).once('value').then((seed) => {
      if (!seed.exists()) return;
      return db.ref(RP_FB_PATH).set(seed.val());
    });
  });
}

function startRepartoListener() {
  renderReparto(); // pinta el estado vacío mientras llega el primer snapshot
  rpSeedFromTareas()
    .catch((error) => {
      // Si la copia inicial falla, se sigue escuchando el nodo propio: la vista
      // saldrá vacía, pero editable, en vez de quedarse en blanco sin más.
      console.error('[reparto] Error copiando los datos iniciales:', error?.message ?? error);
    })
    .then(rpAttachRepartoListener);
}

function rpAttachRepartoListener() {
  db.ref(RP_FB_PATH).on('value', (snapshot) => {
    const { rows, sections, tabs } = rpParseSnapshot(snapshot.val());
    const before = JSON.stringify({ rows: repartoRows, sections: repartoSections });

    repartoRows = rows.map(rpNormalizeRow);
    repartoSections = sections;
    repartoLegacyTabs = tabs; // se devuelve tal cual al guardar; no se usa
    // La reconciliación va antes de comparar: así el nombre de pestaña queda
    // normalizado aunque el resto del estado no haya cambiado.
    const migrated = rpReconcileTabs();
    rpPruneSections();
    rpEnsureActiveTab();

    // Evita repintar (y perder el foco) cuando el eco de Firebase es lo ya escrito.
    if (JSON.stringify({ rows: repartoRows, sections: repartoSections }) === before) return;

    renderReparto();
    if (migrated) saveReparto(); // deja el estado normalizado también en Firebase
  }, (error) => {
    const msg = error?.message ?? String(error);
    console.error('[reparto] Error leyendo el reparto en Firebase:', msg);
    rpShowError(
      /permission/i.test(msg)
        ? `No se pueden leer los datos: el nodo «${RP_FB_PATH}» no tiene permisos en las reglas de Firebase.`
        : `No se pueden leer los datos: ${msg}`
    );
  });
}


