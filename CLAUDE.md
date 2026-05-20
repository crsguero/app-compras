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
| `.actions-dropdown` | Menú desplegable contextual con botones de acción (icono + texto). |
| `.text-input` | Campo de texto (`input[type="text"]`). Clase aplicada directamente al `<input>`. El label asociado se estiliza vía `label:has(+ .text-input)`. |
| `.number-input` | Campo numérico (`input[type="number"]`) con unidad a la derecha. Clase aplicada al `<input>` dentro de `.formato-wrapper`. La unidad se muestra en `.formato-unit`; si no hay unidad definida, muestra `-`. |
| `.cb` | Checkbox personalizado. Estructura: `<label class="cb"><input class="cb-input"><span class="cb-box"></span><span>Label</span></label>`. |
