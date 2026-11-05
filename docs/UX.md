# Experiencia: registro de vueltas

Cada vuelta: banco de pruebas (`tools/ux`) → mirar capturas e informe →
arreglar lo peor → volver a pasar el banco. Las cifras son de la visita
completa (6 visitas, Chromium, 1440×900 / 1280×720 / 390×844).

## Cifras

| Cifra | Base (05-11) | Vuelta 6 |
|---|---|---|
| Paneles que se pisan | 14 | 0 |
| Scroll horizontal | 11 pasos | 0 |
| CV o «Contactar» sin poder pulsar | 12 pasos* | 0 |
| Fallos serios de accesibilidad (axe) | 2 | 0 |
| Foco de teclado sin anillo | 8* | 0 |
| Mandos en más de 2 filas | — | 0 |
| Centro de la escena tapado en recorridos | 2–36 % | 0 % |
| Errores de JavaScript | 0 | 0 |

\* Falsos positivos del propio banco, corregidos en la vuelta 1 (cogía el botón
de CV oculto de la portada clásica y no veía el anillo de foco hecho con borde).

## Vueltas

1. **Base.** Lo peor que salió de verdad: la barra de arriba se salía de la
   pantalla a 1440 y 1280 px (el cambio de idioma y el sonido no se veían) y
   la página se podía mover 80 px de lado; Hermes pisaba los mandos; los
   avisos de logro tapaban mandos y el panel del detective; la hoja abierta
   pisaba mandos y contador; contraste del distintivo «en curso» sobre papel
   (1,6:1); bloques de código con scroll sin teclado.
2. **Barra y medidas.** Sin números de zona por debajo de 1680 px; Hermes y
   el texto de los recorridos se colocan midiendo los mandos de verdad (y se
   vuelven a medir con `ResizeObserver`); avisos de logro abajo a la derecha;
   colores de aviso oscuros sobre papel; `tabindex` en los bloques de código.
3. **La pista de entrada no se veía** (quedaba debajo de los mandos): ahora va
   encima y más grande, y en la primera visita lo que se puede tocar brilla
   unos segundos.
4. **Recorridos.** Al subir el texto quedó en mitad de la escena (34 % del
   centro tapado): ahora va en la esquina y la cámara corre la escena a la
   derecha mientras se ve.
5. **Lo que busca RR. HH.** A qué me dedico vuelve debajo del nombre; «Recorrido»
   (la visita guiada) se confundía con «Recorridos»: ahora «Visita guiada»;
   en pantallas anchas los mandos van en una fila (más sala a la vista).
6. **Con hoja abierta** los mandos se partían en 3 filas: fuera el zoom y la
   visita guiada mientras hay hoja (y el banco ya lo vigila).

## Pendiente para próximas vueltas

- Probar el banco en Firefox (el navegador del dueño) y con GPU real (fps).
- El 3D no se recorre con teclado (todo su contenido sí, por el menú de arriba).
- Medir con visitas reales de forma anónima (entrar, tocar, CV, contacto).
