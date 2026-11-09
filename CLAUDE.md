# App Tareas

## QA
No usar herramientas de preview (screenshot, snapshot, eval, DOM inspection) para verificar cambios.
La usuaria hace el QA manualmente. Tras implementar, informar de los cambios y esperar.

## Componentes CSS

Componentes reutilizables definidos en `styles.css`. Los estilos se aplican a todos sus usos cambiando solo el bloque del componente.

| Componente | Descripción |
|---|---|
| `.date-picker` | Campo de fecha con label incluida, placeholder personalizado e icono de calendario. |
| `.select-field` | Campo select con label incluida y chevron personalizado. |
| `.month-year-field` | Dos `.select-field` (mes y año) en la misma línea, bajo una sola label, que se estiliza vía `label:has(+ .month-year-field)`. Los selectores los rellena `populateExpirySelects(mesSelect, añoSelect, valor)` con los 12 meses y el año actual más los 9 siguientes; el valor se guarda como `YYYY-MM` con `expiryValue(año, mes)` y se muestra con `formatExpiry(valor)`. |
| `.actions-dropdown` | Menú desplegable contextual con botones de acción (icono + texto). |
| `.text-input` | Campo de texto (`input[type="text"]`). Clase aplicada directamente al `<input>`. El label asociado se estiliza vía `label:has(+ .text-input)`. |
| `.number-input` | Campo numérico (`input[type="number"]`) con unidad a la derecha. Clase aplicada al `<input>` dentro de `.formato-wrapper`. La unidad se muestra en `.formato-unit`; si no hay unidad definida, muestra `-`. |
| `.cb` | Checkbox personalizado. Estructura: `<label class="cb"><input class="cb-input"><span class="cb-box"></span><span>Label</span></label>`. |
| `.week-table` | Tabla semanal de 7 columnas (los días). Va dentro de `.week-table-wrapper`, que la desplaza en horizontal cuando no cabe. Cada celda se titula con un `.week-cell-header` (`.week-cell-title` + un `.week-cell-add-btn` opcional en la misma línea, que solo se ve al pasar por la celda) y lista su contenido en `.week-cell-list` > `.week-cell-entry`. Los textos derivados de la receta van en `.week-cell-notes` > `.week-cell-note`, que lleva su `data-tooltip` con el nombre de la receta de la que salen. |
| `.tooltip` | Globo de texto al pasar por encima. No se escribe en el HTML: basta poner `data-tooltip="texto"` en cualquier elemento. `showTooltip()` usa un único globo colgado de `<body>` y lo coloca con `position: fixed` (encima del elemento, o debajo si no cabe, y sin salirse por los lados), para que no lo recorte el `overflow` de ningún contenedor. Solo hover: en táctil no aparece. |
| `.rich-text` | Editor de texto con formato (negrita, cursiva, listas). El HTML solo lleva `.rich-text` > `.rich-text-editor[contenteditable]` con `data-placeholder`; `initRichText(root, onChange)` le inserta la barra (`.rich-text-toolbar`) a partir de `RICH_TEXT_COMMANDS`. Se lee/escribe con `getRichTextValue(editor)` / `setRichTextValue(editor, html)`. Para mostrar un texto ya guardado fuera de un editor, usar `.rich-text-content`: comparte los estilos de listas y párrafos, y hereda el tamaño de letra del contenedor. |
