# Cambios

Formato: [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Versiones: [SemVer](https://semver.org/lang/es/).

## [Sin publicar]

### Añadido
- **Linux: la estantería sustituye al escritorio.** Mientras está abierta se apagan los iconos del escritorio de GNOME/Ubuntu, XFCE, Cinnamon y MATE, y al cerrarla se restauran (también tras un cierre brusco). En KDE se indica cómo hacerlo a mano. Se activa en la bandeja, en «Sustituir el escritorio».
- **Linux: apps instaladas en las baldas.** Clic derecho → Nuevo → Aplicación… abre un buscador con todas las apps del sistema, incluidas Flatpak y Snap. No crea nada en el Escritorio, y quitar una app de la estantería no la desinstala.
- Soltar archivos desde el gestor de archivos sobre una balda los mueve al Escritorio (con Ctrl, los copia) y la botella aparece donde se sueltan.
- Con los iconos del sistema ocultos, los archivos sueltos del Escritorio también salen como botellas.
- La botella da un saltito al abrirla.
- **Linux**: AppImage y paquete `.deb`. Fondo de escritorio de verdad (ventana de tipo escritorio en X11 y XWayland), arranque al iniciar sesión (`~/.config/autostart`), papelera del sistema, lanzadores `.desktop` y enlaces simbólicos como botellas, y los ajustes de pantalla, fondo y terminal de GNOME, KDE, XFCE, Cinnamon y MATE.
- Las actions construyen también la versión de Linux.

### Cambiado
- La estantería ocupa toda la pantalla sea cual sea la resolución o la proporción (16:9, 16:10, 4:3, 21:9, 32:9): la pared se recorta sin deformarse y las baldas se adaptan a lo ancho, sin cortar nunca el suelo.
- Las botellas se pueden arrastrar de una balda a otra sin entrar en el modo edición. Un clic o doble clic sigue abriendo la carpeta; solo se mueven al arrastrar más de unos píxeles.

### Corregido
- En Linux, abrir una botella tardaba mucho: las apps heredaban el entorno que modifica Electron (escritorio «Unity», X11 forzado). Ahora se restaura el entorno de la sesión y el programa se lanza directamente; a partir de la segunda vez, abrir tarda alrededor de 1 ms.
- El panel de una botella mostraba también el giro y el grosor, que son solo de pósters y libros.
- Con resoluciones por encima de 1080p (y escalado de pantalla) el fondo salía a medio tamaño en una esquina en Windows. Ahora el tamaño se pide a Windows en píxeles reales.
- Con escalado de pantalla, los clics prestados en la capa «Detrás de los iconos» miraban otro punto de la pantalla.
- Al encender el ordenador ya no se abre el modo edición: se ignoran las copias que lanza Windows al iniciar sesión, «Como ventana» ya no se queda guardada, y mientras espera al Explorador no se pone delante de las demás ventanas.
- La capa «Suelta, sin anclar» se perdía al reiniciar y volvía a «Sobre los iconos».
- El arranque automático de la versión portable apuntaba a una carpeta temporal.
- El estado y los ajustes se guardan de forma segura (sin JSON a medias tras un corte) y con copia `.bak`.
- Con los iconos de Windows ocultos, los clics en la capa «Detrás de los iconos» no llegaban.
- Doble clic en una botella recién renombrada no hacía nada.
- Las botellas guardadas en el cajón seguían ocupando sitio en su balda.
- Un dibujo que ya no existe en el pack se sustituye por uno sugerido en vez de salir siempre el primero.
- Dos carpetas con nombres parecidos podían compartir máscara SVG y verse con las imágenes cruzadas.
- Nombres de distribución con `<`, `&` o comillas rompían el selector.
- Dejar el nombre en blanco en el editor renombraba la carpeta a «Sin nombre».
- El deslizador de grosor no hacía nada en libros sin dibujo guardado.
- Cortar y pegar en el propio escritorio renombraba el elemento; pegar una carpeta que contiene el escritorio se colgaba.
- El aviso de «escritorio vacío» no aparecía nunca.
- Los cambios de los últimos 250 ms se perdían al recargar.

### Eliminado
- `estanteria.zip` (copia duplicada del proyecto) y `gen_icono.py` (el icono ya está generado).

## [1.0.0] - 2026-09-23

- Primera versión pública.
