# Cambios

Formato: [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Versiones: [SemVer](https://semver.org/lang/es/).

## [Sin publicar]

### Cambiado
- Las botellas se pueden arrastrar de una balda a otra sin entrar en el modo edición. Un clic o doble clic sigue abriendo la carpeta; solo se mueven al arrastrar más de unos píxeles.

### Corregido
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
