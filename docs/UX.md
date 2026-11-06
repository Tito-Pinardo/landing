# Experiencia: registro de vueltas

Cada vuelta: banco de pruebas (`tools/ux`, Chromium y Firefox) → mirar capturas e informe →
arreglar lo peor → volver a pasar el banco. Las cifras son de la visita
completa (6 visitas, Chromium, 1440×900 / 1280×720 / 390×844).

## Cifras

| Cifra | Base (05-11) | Vuelta 6 | Vuelta 9 |
|---|---|---|---|
| Paneles que se pisan | 14 | 0 | 0 |
| Scroll horizontal | 11 pasos | 0 | 0 |
| CV o «Contactar» sin poder pulsar | 12 pasos* | 0 | 0 |
| Fallos serios de accesibilidad (axe) | 2 | 0 | 0 |
| Foco de teclado sin anillo | 8* | 0 | 0 |
| Mandos en más de 2 filas | — | 0 | 0 |
| Centro de la escena tapado en recorridos | 2–36 % | 0 % | 0 % |
| Errores de JavaScript | 0 | 0 | 0 |
| Elementos cortados a la derecha sin WebGL | 78 (medido en la vuelta 7) | — | 0 |

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

7. **Sin WebGL** (nueva visita `sin3d`, y Firefox aquí, que no tiene GPU):
   la lista del rack se salía de su columna y quedaba cortada (78 elementos
   fuera de la pantalla). La lista ahora se compacta según su propio ancho
   (container query) y la columna no crece con el contenido; etiqueta única
   para el mapa de zonas.
8. **Firefox en el banco.** Necesita sus propias librerías delante y sin
   sandbox de contenido para leer las fuentes (si no, todo sale en cajas y
   las medidas son falsas). Con eso: 0 en todo salvo los avisos de WebGL.
9. **WebGL de verdad antes de bajar el 3D.** Antes bastaba con que existiera
   la API; sin GPU se bajaban 600 KB del 3D para fallar. Ahora se crea un
   contexto de prueba primero. El banco ya solo exige el CV y el contacto a
   mano dentro de la sala o al entrar (bajando por la página es normal no
   verlos).

10. **Con GPU de verdad** (RTX, Chrome y Firefox 159 del sistema). Chrome:
    todo a 0, la sala en 1 s y el recorrido a 60 fps (p95 16,8 ms).
    Firefox: sala en 1,1 s, 60 fps (p95 17 ms), 0 violaciones de CSP y 0
    errores. Encontró un fallo: sin WebGL, en la página, el 3D se seguía
    bajando al acercarse al rack (el arreglo de la vuelta 9 solo cubría la
    sala). Ahora sin WebGL no se pide (0 peticiones, comprobado en Firefox).
11. **Medida anónima de visitas** puesta: a partir de aquí las vueltas se
    guían por dónde se va la gente de verdad (`tools/visitas.sh`).

## Pendiente para próximas vueltas

- El 3D no se recorre con teclado (todo su contenido sí, por el menú de arriba).
- Mirar el embudo de visitas reales dentro de una o dos semanas y atacar el paso donde más gente se va.
