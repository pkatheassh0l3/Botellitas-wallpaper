# Estantería

Un fondo de escritorio vivo. La estantería de la pared, las botellitas del pack
encima, y el nombre apareciendo solo cuando pasas el ratón por encima. Cada
botella puede abrir una carpeta de tu ordenador.

## Requisitos

Node.js 18 o superior. Windows 10 u 11 para el anclaje al escritorio; en macOS y
Linux funciona con limitaciones (ver *Cómo se pega al escritorio*).

## Empezar

Instala las dependencias una sola vez y pruébala como ventana normal:

```bash
npm install
npm run ventana
```

Cuando te convenza, `npm start` la deja pegada al escritorio. Nada más abrirla
verás una botella por cada carpeta y acceso directo de tu escritorio. Si arranca
bloqueada, **Ctrl+Alt+E** o el icono de la bandeja la desbloquean.

Lo primero que conviene mirar es dónde se coloca: hay cuatro capas posibles y
cambian bastante cómo se usa. Está en *Cómo se pega al escritorio*.

## Instalarla

Tres formas, de menos a más definitiva:

```bash
npm run carpeta      # deja dist/win-unpacked/ con la app lista para ejecutar
npm run portable     # un unico .exe que funciona sin instalar
npm run build        # instalador completo + version portable
```

**Si el instalador no llega a abrirse**, prueba por este orden:

1. **SmartScreen.** Windows bloquea los ejecutables sin firma digital. Aparece
   *Windows protegió tu PC*: pulsa **Más información → Ejecutar de todos modos**.
   A veces bloquea sin avisar; entonces, clic derecho en el `.exe` →
   *Propiedades* → marca **Desbloquear** abajo → *Aceptar*.
2. **El antivirus.** Un ejecutable recién creado y sin firma es sospechoso para
   Defender y compañía, y a veces lo borra en silencio. Mira la cuarentena y
   añade la carpeta `dist` a las exclusiones.
3. **Sáltatelo.** `npm run carpeta` no genera instalador: te deja la app montada
   en `dist/win-unpacked/`, y se abre haciendo doble clic en `Estanteria.exe`.
   Funciona igual, incluido el anclaje al escritorio. Lo único que pierdes es la
   entrada en el menú Inicio y el desinstalador.

Se instala **para tu usuario**, sin pedir administrador, y así tiene que ser: un
proceso elevado no puede colgarse del Explorador de Windows y el anclaje al
escritorio dejaría de funcionar.

Los nombres de archivo van sin tilde (`Estanteria.exe`) a propósito: NSIS y
algunos antivirus se atragantan con caracteres no ingleses en las rutas. El
acceso directo sí se llama «Estantería».

## El pack

En `assets/pack/` hay 334 botellas convertidas del pack *Botellitas*: una por
aplicación y juego (Spotify, Discord, Minecraft, Photoshop, Steam…), la papelera,
descargas, y las **lisas** — las 39 «básicas», de color y sin dibujo. Esas son las pensadas
para pegarles tu propia imagen encima, así que el editor las enseña primero. La
lista viene marcada al convertir el pack (`assets/pack/lisas.json`), que es más
fiable que adivinarlo por el nombre.

Si añades más botellas al pack en `.ico`:

```bash
python3 gen_pack.py ruta/a/la/carpeta/con/los/ico
```

Coge el fotograma de 256 px, recorta el transparente sobrante y actualiza
`assets/pack/nombres.json`, que es de donde sale el nombre bonito de cada una.
También puedes dejar PNG recortados ahí a mano.

## Se sincroniza con tu escritorio

Las botellas **son** lo que tienes en el escritorio: carpetas y accesos
directos. No se crean a mano: la app lee `Escritorio`, pone una botella por cada
cosa y se entera sola cuando creas, borras o renombras algo — desde la app o
desde el Explorador, da igual.

La lista se refresca sola: además de vigilar la carpeta, se repasa cada tres
segundos, porque en Windows `fs.watch` se pierde algún renombrado cuando el
cambio viene de otro programa. Solo se avisa cuando algo ha cambiado de verdad.

A cada carpeta nueva le busca una botella del pack por el nombre: `Minecraft`
encuentra la de Minecraft, `Spotify` la de Spotify. Si no hay ninguna parecida,
le toca una lisa de color, siempre la misma para ese nombre. Después se cambia
por la que quieras, y esa elección se guarda por carpeta.

Si renombras una carpeta, la app lo detecta y le pasa su dibujo y su sitio, para
que no salte de balda solo por cambiarle el nombre.

Se leen carpetas y accesos directos (`.lnk`, `.url`). Los archivos sueltos no
salen: para eso está el escritorio de siempre.

## El menú del botón derecho

Clic derecho en cualquier parte, esté bloqueada o no. Lleva las opciones del
escritorio de Windows que tienen sentido aquí, más las suyas:

**Sobre el fondo** — *Ver* (botellas grandes, medianas o pequeñas, y ajustar
baldas), *Ordenar por* (nombre, altura, repartir), *Actualizar*, *Pegar*,
*Nuevo* (carpeta, acceso directo, documento de texto, póster), *Distribución*,
bloquear o desbloquear, *Configuración de pantalla*, *Personalizar*, *Abrir en
Terminal* y abrir el escritorio.

**Sobre una botella** — abrir, copiar, cortar, renombrar, cambiar el gráfico,
*Capas*, quitarla de la distribución o enviarla a la papelera.

**Sobre un póster** — editarlo, quitarlo o eliminarlo.

Si eliges algo que requiere escribir, la estantería se desbloquea sola.

Un aviso: *Configuración de pantalla* y *Personalizar* abren los ajustes de
Windows de verdad, pero el menú es el de la app, no el del sistema. Electron no
puede invocar el menú nativo del escritorio, así que están reproducidas las
entradas útiles, no todas — las de otros programas (PowerRename y compañía) no
aparecen. Si necesitas el menú de Windows entero, cierra la estantería desde la
bandeja o cámbiala a la capa *detrás de los iconos*.

## Nuevo → Acceso directo

Pide el `.exe` del programa y crea un `.lnk` de verdad en tu escritorio, con
`shell.writeShortcutLink`. A partir de ahí es una botella más: doble clic lo
lanza. Fuera de Windows se crea un enlace simbólico.

## Copiar, cortar y pegar

Con `Ctrl+C`, `Ctrl+X` y `Ctrl+V`, o desde el menú. Pegar deja la copia en tu
escritorio, así que **copiar de otra carpeta y pegar aquí mueve o copia el
archivo de verdad**. Si pegas algo que ya estaba en el escritorio, se crea
`nombre - copia` en vez de pisarlo.

La app lleva su propio portapapeles, porque Windows no deja escribir una lista
de archivos en el del sistema desde Electron. Al pegar mira primero el suyo y,
si está vacío, lo que haya dejado el Explorador — de ahí solo se lee un elemento
cada vez.

## La papelera

Es la papelera de reciclaje del sistema, con su botella del pack: sale llena o
vacía según lo que tenga dentro, y se entera sola cuando cambia. Va colocada al
final del suelo, pero se mueve como cualquier otra.

- **Arrastra una botella encima** y su carpeta se va a la papelera, previa
  confirmación. La papelera se ilumina al pasarle algo por encima.
- **Doble clic** la abre en el Explorador.
- **Clic derecho** para abrirla o vaciarla del todo.

No se puede renombrar ni eliminar, pero sí quitarla de una distribución
concreta si en esa no la quieres.

## Capas

Las botellas pueden solaparse a propósito: al moverlas a mano ya no se empujan
entre ellas, solo se limitan a la madera de su balda. Para ordenar el
amontonamiento, en el menú → *Capas*: traer al frente, adelante, atrás o al
fondo. En el panel de selección tienes los dos botones de andar por casa, y con
`Re Pág` y `Av Pág` se mueve la seleccionada.

Entre baldas manda siempre la altura: una botella de una balda de arriba nunca
tapará a una de abajo, por mucho que la adelantes. *Repartir* y *Ordenar por*
siguen dejándolo todo en fila, sin solapes.

## Botella o libro

En el editor, arriba del buscador, se elige entre **Botella** y **Libro**. Los
libros son diez lomos que se posan en la balda como cualquier otra cosa: se
arrastran, se apilan por capas y se tiñen con el tema igual.

Un lomo lleva además **texto vertical**, en **Cinzel**, una tipografía de
capitales romanas que es lo que llevan los lomos de verdad. Va empaquetada con
la app, así que funciona sin conexión. Las etiquetas que salen al pasar el ratón
usan Libre Baskerville, para que todo hable el mismo idioma.

Si no escribes nada, el lomo pone el nombre de la carpeta; el campo *Texto del
lomo* sirve para poner otra cosa. El color no se elige: cada libro trae
calculado el que se lee bien sobre él —oscuro del mismo tono en los claros,
claro en los oscuros—. Y el texto no se pega encima, se **funde** con el lomo:
oscuro sobre claro multiplica, claro sobre oscuro aclara, de modo que los
adornos del libro se transparentan a través de las letras, como impresas.

El **grosor** se cambia con el mando del panel de selección, de la mitad a algo
más del doble. Ensancha el lienzo y estira **solo la imagen** del libro, que es
un rectángulo plano y lo aguanta bien. El texto no se entera: mantiene su
tamaño, sus proporciones y su sitio centrado en el lomo, y solo crece cuando
creces el libro entero con el mando de tamaño. En una primera versión se
estiraba todo el dibujo a la vez y las letras salían achatadas.

El tamaño de letra sale del ancho del lomo, pero se reduce si el texto no
cabría a lo largo: mejor letra pequeña que un nombre cortado. «TFG» sale grande,
«Copias de seguridad» sale fino y entero.

Los libros salen de un archivo de Illustrator, separados por manchas conexas y
recortados uno a uno. Para añadir más, deja PNG recortados en `assets/libros/` y
apúntalos en su `nombres.json` con el color de lomo y el de texto.

## El gráfico de cada botella

Doble clic en modo edición, o clic derecho → *Cambiar gráfico…*:

- **Nombre** — es el de la carpeta, así que cambiarlo la renombra en el disco.
- **Botella** — la rejilla del pack, con buscador. *Solo lisas* filtra las de
  color sin dibujo; en cuanto escribes, busca en las 258.
- **Imágenes encima** — arrastra un archivo sobre la botella o usa *Añadir
  imagen…*. Se recorta al contorno usando la transparencia del PNG como
  máscara, así que un rectángulo cualquiera queda pegado al cristal. Arrastra
  para colocarlo, rueda o *Tamaño* para escalarlo, *Giro* para inclinarlo,
  *Opacidad* para que se vea el líquido debajo, y *Delante / Atrás* con varias.

El editor trabaja sobre una copia: *Cancelar* no toca nada.

Las imágenes que pegas se copian a la carpeta de datos de la app, así que puedes
mover o borrar el archivo original sin romper la botella.

## Colocar

- **Ctrl+Alt+E** (o el icono de la bandeja) alterna entre estantería bloqueada y
  modo edición. **Esc** deselecciona; otra vez, bloquea.
- **Sin desbloquear** también puedes arrastrar una botella a otra balda o a la
  papelera. Un clic o doble clic la abre como siempre: solo se mueve si la
  arrastras. Para tamaños, capas, pósters y baldas sí hace falta el modo edición.
- **Clic** selecciona. Lo seleccionado sale con borde discontinuo, un asa para
  el tamaño y un panel abajo a la izquierda.
- Al pasar el ratón, la botella se ilumina y sube un poco, además de enseñar su
  nombre.
- **Arrastra** para mover. Las botellas se imantan al tramo de balda más
  cercano y empujan a las vecinas; los pósters van donde los sueltes.
- Arrastra al **cajón** de abajo para quitar algo de esta distribución sin
  borrarlo. Vuelve a sacarlo cuando quieras, y ahí se queda entre reinicios:
  guardar algo no borra su ficha, la deja marcada, para que la app pueda
  distinguir entre *nunca se ha colocado* y *la quitaste tú*.
- **Repartir** y **Ordenar por** recolocan lo que está en las baldas; no vacían
  el cajón.
- **Por nombre / Por altura / Repartir** recolocan las botellas llenando tramo a
  tramo, de arriba abajo y de izquierda a derecha.
- Si tienes más carpetas que sitio, las que no caben esperan en el cajón.

### Tamaño

Tres formas, la que te venga mejor:

- **Tira del asa**: el cuadradito de la esquina. En una botella crece hacia
  arriba desde la balda; en un póster escala desde el centro.
- **Rueda del ratón** por encima.
- **Control deslizante** del panel de selección, con el porcentaje al lado.
  También valen las teclas `+` y `-`, y con Mayús se mueve a saltos mayores.

Las botellas tienen un tope: no pueden ser más altas que el hueco de su balda,
así que si una parece que no crece, es que ya llega al estante de arriba. Al
bajarla a una balda con más hueco vuelve a poder crecer. Los pósters no tienen
ese límite porque van en la pared.

Las flechas mueven lo seleccionado, `F2` renombra, `Supr` lo manda al cajón y
`Re Pág` / `Av Pág` cambian su capa.

## Distribuciones

Modo juego, modo estudio, modo vacaciones. Son escenarios distintos con **las
mismas carpetas y pósters**: lo que cambia es dónde está cada cosa y qué está
guardado en el cajón. Cambiar el gráfico de una carpeta la cambia en todas;
moverla solo afecta a la distribución en la que estés. Así puedes tener las
carpetas de clase a la vista en modo estudio y guardadas en modo juego, sin
tocar el escritorio de verdad.

El desplegable de la barra cambia de una a otra. Al lado:

- **+** crea una nueva, partiendo de una copia de la actual, que casi siempre es
  lo que quieres: quitar cuatro cosas es más rápido que colocarlas todas.
- **✎** la renombra y **🗑** la borra (la última no se puede borrar).

Para cambiar de distribución sin desbloquear nada, están todas en el menú de la
bandeja, en **Distribución**.

## Pósters

**Nuevo póster** pide una imagen y la pega en la pared. Van por detrás de las
botellas, así que puedes colocar uno tras un estante y asoma por encima.

Se mueven libremente, sin imantarse a nada. Tienen asa de tamaño en la esquina y
otra de giro arriba, para dejarlos ligeramente torcidos. En su editor (doble
clic o clic derecho) eliges el **marco**: sin marco, marco de madera, polaroid o
con celo, y puedes cambiar la lámina sin perder la posición. Como las botellas,
un póster también puede abrir una carpeta.

## El color de la pared

**Color**, en la barra de edición, o clic derecho → *Ver* → *Color del fondo…*.
Siete paredes de serie —amarillo, rosa, lila, celeste, verde, azul y morado— y
un selector libre para cualquier otro color.

El fondo son **dos capas**: la pared, que existe en cada color, y las
estanterías sueltas sobre transparencia, encima. Cambiar de color es cambiar de
imagen, sin filtros ni recoloreados de por medio.

Antes esto se hacía sustituyendo colores píxel a píxel sobre una sola imagen, y
traía tres problemas que ya no existen: el degradado de las sombras bajo las
baldas se partía en bandas, el conjunto se apagaba, y un logotipo pintado con el
mismo amarillo que el fondo perdía su color.

### Un color cualquiera

La primera versión buscaba el filtro CSS que más se acercara al color pedido,
probando los 360 giros de tono. Se quedaba corta con los colores vivos, porque
`saturate` no puede llevar un amarillo claro hasta un azul intenso: un `#0069ac`
se iba a 97 de distancia sobre 441.

Lo que hace ahora es otra cosa: pone una capa del color elegido con mezcla
`color`, que toma de arriba el tono y la saturación y de abajo la luminosidad, y
ajusta el brillo de la pared para que esa luminosidad sea la del color pedido.
El resultado cae a **1 de distancia**, y de paso conserva el ladrillo, porque la
textura vive precisamente en esas diferencias de luminosidad.

### Que todo acompañe

Con *Que las botellas acompañen*, el pack **y las estanterías** reciben una
atenuación suave: un empujón del 18 % de su tono hacia el de la pared y una
pizca menos de saturación. No se les toca el brillo, a propósito, que era de
donde venía que los colores se vieran oscuros.

## Cambiar el fondo

Las paredes están en `assets/fondos/` y la madera en `assets/estanterias.png`,
todas del mismo tamaño y superpuestas. Para añadir un color más, deja su PNG en
`assets/fondos/` y apúntalo en el `nombres.json` de esa carpeta. Si cambias el
dibujo de la madera, ajusta después las baldas.

## Dónde se guarda todo

En la carpeta de datos de la app: `estanteria.json` con el dibujo y la posición
de cada carpeta, `etiquetas/` con las imágenes que has pegado, `ajustes.json`
con la capa del escritorio y `errores.log` si algo ha fallado. Tus carpetas no se tocan: la app solo las lee, salvo
cuando tú creas, renombras o mandas una a la papelera.

- macOS: `~/Library/Application Support/estanteria-wallpaper`
- Windows: `%APPDATA%\estanteria-wallpaper`
- Linux: `~/.config/estanteria-wallpaper`

## Cómo se pega al escritorio

Esta es la parte que depende del sistema, y conviene entenderla antes de nada.
Elige la capa en el menú de la bandeja, en **Dónde va la estantería**:

| Capa | Qué es | Ratón |
|---|---|---|
| **Detrás de los iconos** (por defecto) | Es literalmente el fondo de pantalla. Ni ventana, ni barra de tareas, ni Alt+Tab. | La app se lo presta: nombres al pasar, doble clic para abrir, clic derecho con menú del sistema y **arrastrar botellas**, todo sin desbloquear. |
| **Sobre los iconos** | Dentro del escritorio, encima de los iconos. | Ratón normal, pero en algunos equipos Chromium deja de pintar y se queda como una foto. |
| **Suelta, sin anclar** | Ventana normal empujada al fondo del orden. | Todo, seguro. A cambio puede colarse por delante de otras ventanas. |
| **Como ventana** | Aplicación normal. | Todo, para desarrollo. |

### El ratón prestado

Una ventana que hace de fondo de pantalla no recibe ratón: se lo queda la capa
de iconos, que la tapa entera. Eso no se puede cambiar, así que la app se lo
presta desde el proceso principal, 25 veces por segundo:

- La posición del cursor sale de `screen.getCursorScreenPoint()`, sin permisos.
- El estado de los botones se consulta con `GetAsyncKeyState`, que es una
  pregunta suelta al sistema — no se instala ningún hook ni se registra nada.
- Para saber si el clic es para nosotros se mira **qué ventana hay justo bajo el
  cursor** (`WindowFromPoint`): si es el escritorio o la nuestra, cuenta; si es
  otro programa, se ignora. Mirar solo la ventana en primer plano no valía: con
  cualquier app abierta detrás se descartaban todos los clics. El soltar sí se
  atiende siempre, o un arrastre que acabara fuera se quedaría pegado.

Con eso se reconstruye el arrastre: pulsar, las posiciones que van llegando y
soltar. Hace falta mover cinco píxeles para que empiece, así que un clic suelto
no descoloca nada. **Solo las botellas**: un póster movido a ciegas es fácil de
perder de vista, y para eso está el modo edición.

Se puede arrastrar a la papelera igual que en modo edición.

El menú del botón derecho, en esta capa, es un **menú nativo de Windows**: uno
dibujado dentro de la ventana no se podría pulsar, porque los clics no llegan.
Lleva las mismas opciones.

### Ocultar los iconos de Windows

En la bandeja. Los iconos del escritorio viven en una ventana del tamaño de la
pantalla que es casi toda transparente; si el shell la sube por delante de la
estantería, se sigue viendo el dibujo pero los clics se los queda ella. Al
ocultarla desaparece el problema de raíz, y además es lo que se busca: las
botellas sustituyen a los iconos.

La app la devuelve a su sitio al salir. Si algo va mal y no aparecen, se
recuperan a mano: clic derecho en el escritorio → *Ver* → *Mostrar iconos del
escritorio*.

### Por sistema

**Windows** — las dos capas salen del mismo sitio: el explorador dibuja el
escritorio en una ventana `Progman` con los iconos dentro (`SHELLDLL_DefView`).
*Sobre los iconos* hace la ventana hija de Progman y la sube por encima de esa
lista; *detrás* usa el mensaje no documentado `0x052C` para que Progman cree una
`WorkerW` extra por debajo y se cuelga de ella — el truco de Wallpaper Engine.
Está en `win-wallpaper.js` con `koffi`. Al depender de detalles internos del
explorador, si falla la app avisa por consola y se queda como ventana normal.

**macOS** — poner una ventana por debajo de los iconos necesita código nativo
(`NSWindow` en `kCGDesktopWindowLevel`), que Electron no expone, así que *detrás
de los iconos* está desactivada. Queda *sobre los iconos*: ventana sin marco a
pantalla completa, sin Dock, visible en todos los escritorios y que no se trae
al frente. Cualquier app la tapa al usarla, que es el comportamiento buscado.

**Linux** — *detrás* usa `_NET_WM_WINDOW_TYPE_DESKTOP`, que respetan casi todos
los gestores de X11; *sobre los iconos* pide `_NET_WM_STATE_BELOW` con `wmctrl`
(instálalo o la ventana no se mantendrá al fondo). El tipo de ventana se fija al
crearla, así que al cambiar de capa la app te pide reiniciarla. En Wayland no
hay equivalente directo: harían falta `wlr-layer-shell` o una extensión del
escritorio.

### Que arranque sola

En la bandeja, **Abrir al iniciar sesión**. Usa `app.setLoginItemSettings`, así
que crea la entrada de inicio del sistema; se puede quitar desde ahí mismo.

## Mostrar escritorio

La esquina de la barra de tareas y `Win+D` mandan minimizar a todas las
ventanas. Anclada de verdad, la estantería no es una ventana más — es el
escritorio —, así que esa esquina te lleva a las botellas.

Si te llevara al escritorio de Windows normal, es que **no llegó a anclarse** y
sigue siendo una ventana corriente. Míralo en la bandeja → *Comprobar el
estado…*.

### Windows 10 y Windows 11 no se organizan igual

Dónde vive el fondo de pantalla cambia entre versiones, y por eso el anclaje
podía fallar sin parar en Windows 11:

```
Windows 10   Progman -> WorkerW(A) -> SHELLDLL_DefView   (los iconos)
                        WorkerW(B)                        <- aquí va el fondo

Windows 11   Progman -> SHELLDLL_DefView                  (los iconos)
                        WorkerW                           <- aquí va el fondo
```

La app prueba los dos casos, y también las tres variantes del mensaje `0x052C`,
porque no todas las compilaciones responden a la misma. Si aun así no aparece
ninguna `WorkerW`, se cuelga de `Progman` y se queda abajo del todo, que deja la
ventana igualmente por debajo de los iconos.

En *Comprobar el estado…* se ve qué ha encontrado: cuántas `WorkerW` hay y si
los iconos cuelgan de Progman, que es lo que distingue una versión de otra.

### Cuando el escritorio aún no existe

Arrancando al iniciar sesión sin retardo salimos **antes que el Explorador**, y
entonces `Progman` todavía no está: el anclaje falla y la app se queda como
ventana normal, con lo que se minimiza al mostrar el escritorio y no se le
prestan los clics. Por eso reintenta cada dos segundos hasta treinta veces, y en
cuanto el escritorio aparece se coloca en su sitio.

## Comprobar el estado

Bandeja → **Comprobar el estado…**. Dice si está anclada, cuál fue el último
fallo, si el ayudante de Windows cargó y qué partes del ratón prestado están
disponibles. El botón *Copiar* deja todo en el portapapeles.

## Si algo va raro

Por orden de probabilidad:

0. **Sigue comportándose como antes tras actualizar.** Los ajustes guardados
   llevan número de versión: al subirlo, la capa vuelve sola a la recomendada.
   Si aun así te aparece en otra, cámbiala en la bandeja.
0. **Se queda como una foto y no responde.** Es la capa *Dentro del escritorio*:
   Chromium da la ventana por tapada y deja de pintar. Cambia en la bandeja a
   **Sobre el fondo**, que no tiene ese problema.
0. **Se ve, se mueve, pero no responde al ratón.** La capa de iconos de Windows
   se ha puesto por delante. Bandeja → *Ocultar los iconos de Windows*.
1. **Ya estaba abierta.** La app solo admite una instancia; la segunda se cierra
   al arrancar. Como no sale en la barra de tareas, es fácil no verla: busca su
   icono en la bandeja, junto al reloj, y sal desde ahí.
2. **No se cierra, se esconde.** Con `npm start` se ancla al escritorio y deja
   de comportarse como una ventana normal. Prueba `npm run ventana`: si así se
   queda, era eso.
3. **Se ha caído de verdad.** El motivo queda en la terminal y también en
   `errores.log`, dentro de la carpeta de datos de la app.

Para verlo todo con las herramientas de desarrollo abiertas:

```bash
npm run depurar
```

## Arranque con el sistema

Una vez instalada viene activado: aparece sola al encender el ordenador. Se
desactiva desde la bandeja, en **Abrir al iniciar sesión**.

No usa la clave de Ejecutar del registro, que es la vía habitual pero la última
en dispararse: Windows la retrasa a propósito unos segundos para que el
escritorio termine de cargar, y en una app que *hace* de escritorio eso se nota.
En su lugar se registra una **tarea programada al iniciar sesión con retardo
cero** (`schtasks /SC ONLOGON /DELAY 0000:00`), que sale mucho antes. Se crea
con permisos limitados a propósito: elevada no podría anclarse al escritorio.

Si la tarea no se puede crear, se vuelve sola a la clave del registro y lo avisa
por consola. Para verla: Programador de tareas → biblioteca → `Estanteria`.

## Prioridad

Arranca en **prioridad alta**, como se pidió: al hacer de escritorio conviene
que responda antes que el resto. Si notas el equipo más lento con juegos o
programas pesados, en la bandeja → **Prioridad** puedes bajarla a *por encima de
lo normal*, que suele ser suficiente y molesta bastante menos.

Además se desactiva el ahorro de energía de Chromium para esta ventana
(`backgroundThrottling: false`): como está siempre de fondo, el navegador la
consideraría inactiva y tardaría en reaccionar al ratón.

## Publicar una versión

El repositorio está preparado para que GitHub compile y publique cada versión
solo. Con los cambios ya guardados en un commit:

```bash
npm run version:patch   # 1.0.0 -> 1.0.1  (arreglos)
npm run version:minor   # 1.0.0 -> 1.1.0  (novedades)
npm run version:major   # 1.0.0 -> 2.0.0  (cambios grandes)
```

Cada uno sube el número en `package.json`, crea el commit y la etiqueta `vX.Y.Z`
y lo empuja a GitHub. La etiqueta dispara `.github/workflows/release.yml`, que
construye en Windows el instalador y la versión portable y los cuelga en
**Releases**. Tarda unos minutos; se sigue en la pestaña **Actions**.

Anota lo que cambia en `CHANGELOG.md` antes de lanzar la versión.

## Estructura

```
main.js               capas, carpetas del escritorio, cursor, bandeja y diálogos
preload.js            puente IPC (contextIsolation activado)
win-wallpaper.js      anclaje a Progman / WorkerW en Windows
renderer/botellas.js  botellas y lomos de libro, como SVG, con el texto vertical
renderer/carteles.js  pósters y estilos de marco
renderer/editor.js    editor de botellas y de pósters
renderer/app.js       sincronía con el escritorio, distribuciones, arrastre y menú
renderer/style.css    estilos
gen_pack.py           herramienta: convierte un pack de .ico a PNG (no hace falta para usar la app)
build/icon.ico        icono del instalador y del ejecutable
assets/pack/          las 334 botellas, con lisas.json marcando las basicas
assets/libros/        los 10 lomos, con su color de lomo y de texto
assets/fondos/        las 7 paredes de color
assets/estanterias.png  la madera, en capa aparte
assets/fuentes/       Cinzel y Libre Baskerville (SIL OFL)
```

## Ideas para seguir

- Una estantería por monitor, leyendo `screen.getAllDisplays()`.
- Que los archivos sueltos del escritorio salgan también, como frascos pequeños.
- Sacar el icono real del programa al crear un acceso directo y usarlo de
  etiqueta pegada en la botella.
- Cambiar de distribución sola según la hora o la app que tengas delante.
- Contar los archivos de la carpeta vinculada y enseñarlo en el cartelito.
- Reflejo de la botella sobre la madera con el SVG volteado y difuminado.
