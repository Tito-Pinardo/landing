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

12. **La sala con el teclado.** Antes, con teclado solo se llegaba a la
    sala por el menú y la lista escondida del rack: el modo detective y los
    objetos de la sala no se podían usar. Ahora la vista es una parada de
    Tab con anillo y una ayuda abajo («flechas para elegir, Intro para
    abrir, Esc para volver»); las flechas recorren notas, foto, CV, mesa,
    teléfono, PC, ventana, puerta y unidades (brillan, sale su nombre y el
    lector de pantalla lo dice) e Intro hace lo mismo que un clic, también
    en el detective. Si lo elegido no se ve, la cámara vuelve a la sala; si
    está arriba, la etiqueta sale debajo para no quedar bajo la tarjeta del
    nombre. Al cerrar una hoja, el foco vuelve a quien la abrió. El banco lo
    comprueba (flechas, Intro abre, Esc vuelve a la sala con el foco) y ya
    ve los anillos pintados en `::after`.

13. **Enanitos en primer plano.** Con la GPU de verdad se vio que, en los
    recorridos de cerca, un enanito podía quedar pegado a la cámara (una
    cabeza enorme junto a Hermes). Ahora se esconden mientras la cámara está
    a menos de 1,1 m de ellos; en la sala se siguen viendo.

14. **Inglés, tema claro y tableta** (nuevas opciones `--lang en` y
    `--tema light`, y visita `tableta` en vertical y horizontal). Inglés y
    tema claro, a 0 (contraste incluido). La tableta sí tenía fallos: con
    una hoja abierta la pantalla se partía en dos y a la sala le quedaba una
    columna en la que el nombre salía palabra a palabra, el botón del CV
    pisaba la profesión y los mandos ocupaban 4 filas; el dibujo de la
    cabecera del laboratorio tapaba el subtítulo. Ahora, por debajo de
    1100 px, la hoja ocupa la sala con el nombre, el CV y el contacto en una
    fila encima; con poco ancho, detective y misión no salen con una hoja
    abierta (la cierran al empezar), y las hojas no llevan ese dibujo.

15. **La página del móvil, más corta.** Medía 29,7 pantallas: solo las
    misiones (10 proyectos) eran 6 y los recorridos del laboratorio (29
    botones) 3, y quien llega con prisa no bajaba hasta el contacto. Ahora
    salen las tres primeras misiones y «Ver los otros 7 proyectos» (se
    abren solas al filtrar por una habilidad o al llegar con un enlace a una
    escondida) y el laboratorio empieza en la primera categoría, con las
    demás a un toque en sus pestañas. 24 pantallas, el resto a 0.

## Pendiente para próximas vueltas

- Mirar el embudo de visitas reales dentro de una o dos semanas y atacar el paso donde más gente se va.
