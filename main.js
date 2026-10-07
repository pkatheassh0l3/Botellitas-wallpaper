'use strict';

const {
  app, BrowserWindow, ipcMain, screen, Tray, Menu,
  globalShortcut, nativeImage, shell, dialog,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const { clipboard } = require('electron');
const os = require('os');

// --- Interruptores de Chromium ------------------------------------------

/**
 * Esto va antes que nada y es lo que hace que la estantería siga viva al
 * anclarla al escritorio.
 *
 * Al convertirla en ventana hija del escritorio, Windows deja de considerarla
 * una ventana visible normal. Chromium tiene un detector de ventanas tapadas
 * (CalculateNativeWinOcclusion) que entonces la da por oculta, y para ahorrar
 * energía DEJA DE PINTAR: en pantalla se queda el último fotograma, como una
 * foto, y nada responde. Apagando ese detector sigue dibujando y atendiendo al
 * ratón con normalidad.
 *
 * Los otros tres evitan que, por estar de fondo, se le baje el ritmo al
 * renderizador y a sus temporizadores.
 */
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

/* En Linux, Wayland no deja a una aplicación colocarse como fondo de escritorio
   ni por debajo de otras ventanas. Por XWayland (X11) sí: la ventana de tipo
   'desktop' y el "siempre al fondo" funcionan también en GNOME y KDE con
   Wayland. Quien quiera probar Wayland puede lanzar con --ozone-platform=wayland. */
if (process.platform === 'linux' && !process.argv.some((a) => a.startsWith('--ozone-platform'))) {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}

// --- Linux ----------------------------------------------------------------

const ES_LINUX = process.platform === 'linux';
const linux = ES_LINUX ? require('./linux-lanzar') : null;
const linuxEscritorio = ES_LINUX ? require('./linux-escritorio') : null;
const entornoHijos = () => (linux ? linux.entornoLimpio() : process.env);

/** Lanza el primer programa de la lista que exista. Devuelve si alguno arrancó. */
function lanzarPrimero(opciones, cwd) {
  return new Promise((res) => {
    const probar = (i) => {
      if (i >= opciones.length) { res(false); return; }
      const [cmd, ...args] = opciones[i];
      let hijo;
      try {
        hijo = spawn(cmd, args, { cwd, detached: true, stdio: 'ignore', env: entornoHijos() });
      } catch (_) { probar(i + 1); return; }
      hijo.once('error', () => probar(i + 1));
      hijo.once('spawn', () => { hijo.unref(); res(true); });
    };
    probar(0);
  });
}

/** Ejecuta un programa y dice si terminó bien (sin mirar su salida). */
function ejecutar(cmd, args, timeout = 8000) {
  return new Promise((res) => {
    execFile(cmd, args, { timeout, env: entornoHijos() }, (err) => res(!err));
  });
}

// --- Rutas -------------------------------------------------------------

const DIR_ASSETS = path.join(__dirname, 'assets');
const DIR_PACK = path.join(DIR_ASSETS, 'pack');
const DIR_LIBROS = path.join(DIR_ASSETS, 'libros');
const DIR_FONDOS = path.join(DIR_ASSETS, 'fondos');

const dirEscritorio = () => app.getPath('desktop');

const ficheroEstado = () => path.join(app.getPath('userData'), 'estanteria.json');
const ficheroAjustes = () => path.join(app.getPath('userData'), 'ajustes.json');
const dirEtiquetas = () => path.join(app.getPath('userData'), 'etiquetas');

// --- Errores ------------------------------------------------------------

const DEPURAR = process.argv.includes('--depurar');
// La lanza Windows al iniciar sesión (tarea programada o clave del registro).
const ARG_ARRANQUE = '--arranque';
const INICIO = Date.now();

function contarError(donde, err) {
  const texto = `${donde}: ${err && err.stack ? err.stack : err}`;
  console.error('[estanteria]', texto);
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.appendFileSync(path.join(app.getPath('userData'), 'errores.log'),
      `\n[${new Date().toISOString()}] ${texto}\n`, 'utf8');
  } catch (_) { /* si ni esto se puede, queda la consola */ }
  return texto;
}

// Sin esto, cualquier fallo suelto tumba la app sin dejar rastro en pantalla.
process.on('uncaughtException', (err) => {
  const texto = contarError('Error no controlado', err);
  if (app.isReady()) {
    dialog.showErrorBox('La estantería ha tenido un problema',
      `${texto}\n\nSigue abierta. Cuéntamelo con este texto para arreglarlo.`);
  }
});
process.on('unhandledRejection', (err) => contarError('Promesa rechazada', err));

// --- Ajustes ------------------------------------------------------------

/**
 * anclaje:
 *   'detras'  literalmente el fondo de pantalla: hija de la WorkerW que va bajo
 *             los iconos. Sin ventana, sin barra de tareas, sin Alt+Tab. No
 *             recibe ratón, así que se lo prestamos desde aquí.
 *   'encima'  hija de Progman, por encima de los iconos. Ratón normal, pero en
 *             algunos equipos Windows deja de tratarla como ventana visible y
 *             Chromium se congela.
 *   'suelta'  ventana normal empujada al fondo del orden. Funciona siempre; a
 *             cambio puede colarse por delante de otras al cambiar de app.
 *   'ventana' aplicación corriente, para desarrollo.
 */
// Al subir este número, los ajustes guardados vuelven a la capa recomendada.
// Sirve para sacar a la gente de una capa que resultó no funcionar.
const AJUSTES_VERSION = 2;

const AJUSTES_POR_DEFECTO = {
  version: AJUSTES_VERSION,
  // 'detras' es la que de verdad hace de fondo de pantalla: sin ventana, en el
  // sitio del escritorio. No recibe ratón, así que se lo prestamos nosotros.
  anclaje: 'detras',
  // En Linux, la estantería sustituye al escritorio: se apagan sus iconos
  // mientras está abierta. En Windows es opcional (bandeja).
  ocultarIconos: process.platform === 'linux',
  // Al instalarla, lo normal es querer que aparezca sola al encender.
  arranque: app.isPackaged,
  prioridad: 'alta',
};

let ajustes = { ...AJUSTES_POR_DEFECTO };
let anclajeReal = AJUSTES_POR_DEFECTO.anclaje;   // la última capa que no es 'ventana'

function leerAjustes() {
  try {
    ajustes = { ...AJUSTES_POR_DEFECTO, ...JSON.parse(fs.readFileSync(ficheroAjustes(), 'utf8')) };
  } catch (_) {
    ajustes = { ...AJUSTES_POR_DEFECTO };
  }

  if ((ajustes.version || 0) < AJUSTES_VERSION) {
    console.log(`[estanteria] Ajustes de una version anterior: se vuelve a la capa "${AJUSTES_POR_DEFECTO.anclaje}".`);
    ajustes.anclaje = AJUSTES_POR_DEFECTO.anclaje;
    ajustes.version = AJUSTES_VERSION;
    guardarAjustes();
  }
  // Ajustes de versiones anteriores que sí guardaban 'ventana'.
  if (ajustes.anclaje === 'ventana') {
    ajustes.anclaje = AJUSTES_POR_DEFECTO.anclaje;
    guardarAjustes();
  }
  anclajeReal = ajustes.anclaje;
  if (process.argv.includes('--ventana')) ajustes.anclaje = 'ventana';
  if (!['detras', 'encima', 'suelta', 'ventana'].includes(ajustes.anclaje)) {
    ajustes.anclaje = AJUSTES_POR_DEFECTO.anclaje;
  }
  // macOS no deja poner una ventana bajo los iconos sin código nativo.
  if (process.platform === 'darwin' && ajustes.anclaje === 'detras') ajustes.anclaje = 'encima';
  return ajustes;
}

function guardarAjustes() {
  try {
    // 'Como ventana' es para probar: si se guardara, la próxima vez que
    // enciendas el ordenador se abriría en modo edición. Se guarda la capa real.
    const aGuardar = { ...ajustes };
    if (aGuardar.anclaje === 'ventana') aGuardar.anclaje = anclajeReal;
    escribirSeguro(ficheroAjustes(), JSON.stringify(aGuardar, null, 2));
  } catch (err) {
    console.error('[estanteria] No se pudieron guardar los ajustes:', err.message);
  }
}

/**
 * Prioridad del proceso. Una estantería que hace de escritorio conviene que
 * responda antes que el resto, pero pasarse penaliza a todo lo demás: 'alta'
 * es lo que se pidió, 'normal' es lo prudente si notas el equipo más lento.
 */
function aplicarPrioridad() {
  const nivel = {
    alta: os.constants.priority.PRIORITY_HIGH,
    media: os.constants.priority.PRIORITY_ABOVE_NORMAL,
    normal: os.constants.priority.PRIORITY_NORMAL,
  }[ajustes.prioridad] ?? os.constants.priority.PRIORITY_HIGH;

  try {
    os.setPriority(process.pid, nivel);
    console.log(`[estanteria] Prioridad del proceso: ${ajustes.prioridad}.`);
  } catch (err) {
    console.warn('[estanteria] No se pudo cambiar la prioridad:', err.message);
  }
}

/* --- Arranque con el sistema -------------------------------------------

   La clave de Ejecutar del registro (lo que usa setLoginItemSettings) es la
   última en dispararse: Windows la retrasa a propósito unos segundos para que
   el escritorio termine de cargar. Para una app que HACE de escritorio eso se
   nota, así que en Windows registramos una tarea programada al iniciar sesión
   sin retardo, que arranca mucho antes. Si falla, se vuelve a la clave normal. */

const TAREA = 'Estanteria';

/**
 * Lo que hay que lanzar al iniciar sesión. La versión portable se descomprime
 * en una carpeta temporal distinta cada vez, así que process.execPath apunta a
 * algo que desaparece al cerrar: el .exe de verdad viene en esta variable.
 */
function ejecutableArranque() {
  // En Linux, el AppImage se monta en una carpeta temporal; el archivo de
  // verdad viene en APPIMAGE.
  return process.env.PORTABLE_EXECUTABLE_FILE || process.env.APPIMAGE || process.execPath;
}

/**
 * Linux no tiene clave de registro: el estándar (XDG) es dejar un .desktop en
 * ~/.config/autostart. Lo entienden GNOME, KDE, XFCE, Cinnamon, MATE…
 * setLoginItemSettings de Electron no hace nada en Linux.
 */
function arranqueLinux(activar) {
  const dir = path.join(app.getPath('appData'), 'autostart');
  const fichero = path.join(dir, 'estanteria.desktop');
  try {
    if (!activar) {
      fs.rmSync(fichero, { force: true });
      return false;
    }
    fs.mkdirSync(dir, { recursive: true });
    const exe = ejecutableArranque().replace(/(["`$\\])/g, '\\$1');
    fs.writeFileSync(fichero, [
      '[Desktop Entry]',
      'Type=Application',
      'Name=Estantería',
      'Comment=Un escritorio con forma de estantería',
      `Exec="${exe}" ${ARG_ARRANQUE}`,
      'X-GNOME-Autostart-enabled=true',
      'X-GNOME-Autostart-Delay=2',
      'Terminal=false',
      '',
    ].join('\n'), 'utf8');
    return true;
  } catch (err) {
    contarError('No se pudo configurar el arranque automático', err);
    return false;
  }
}

function schtasks(args) {
  return new Promise((res) => {
    execFile('schtasks.exe', args, { windowsHide: true, timeout: 10000 },
      (err) => res(!err));
  });
}

async function arranqueAutomatico(activar) {
  if (ES_LINUX) return arranqueLinux(activar);
  if (process.platform !== 'win32') {
    app.setLoginItemSettings({ openAtLogin: activar, args: [ARG_ARRANQUE] });
    return activar;
  }
  const clave = { openAtLogin: false, path: ejecutableArranque(), args: [ARG_ARRANQUE] };
  // Las versiones anteriores registraban la clave sin la marca: se quita,
  // porque si no al encender se abrían dos copias.
  app.setLoginItemSettings({ openAtLogin: false, path: ejecutableArranque(), args: [] });

  if (!activar) {
    await schtasks(['/Delete', '/TN', TAREA, '/F']);
    app.setLoginItemSettings(clave);
    return false;
  }

  const ok = await schtasks([
    '/Create', '/F',
    '/TN', TAREA,
    '/TR', `"${ejecutableArranque()}" ${ARG_ARRANQUE}`,
    '/SC', 'ONLOGON',
    '/DELAY', '0000:00',    // sin esperar: de los primeros en salir
    '/RL', 'LIMITED',       // sin privilegios: si no, no podría anclarse al escritorio
  ]);

  if (ok) {
    // Con la tarea puesta, la clave del registro sobra y abriría una segunda.
    app.setLoginItemSettings(clave);
    console.log('[estanteria] Arranque al iniciar sesion: tarea programada, sin retardo.');
  } else {
    app.setLoginItemSettings({ ...clave, openAtLogin: true });
    console.warn('[estanteria] No se pudo crear la tarea programada; '
      + 'se usa el arranque normal de Windows, que tarda unos segundos más.');
  }
  return true;
}

// --- Iconos del escritorio del sistema -----------------------------------

/**
 * Enseña u oculta los iconos que dibuja el propio sistema. En Windows es la
 * ventana SHELLDLL_DefView; en Linux, lo de cada entorno (linux-escritorio.js).
 * Devuelve true si se pudo, o un texto con cómo hacerlo a mano.
 */
function iconosDelSistema(visibles) {
  if (process.platform === 'win32') return conWinApi('iconosVisibles', visibles) === true;
  if (linuxEscritorio) {
    if (visibles) { linuxEscritorio.restaurarIconos(); return true; }
    const r = linuxEscritorio.ocultarIconos();
    if (r.ok) console.log(`[estanteria] Iconos del escritorio (${r.entorno}) apagados mientras la estanteria este abierta.`);
    return r.ok ? true : (r.detalle || false);
  }
  return false;
}

// --- Estado del proceso principal --------------------------------------

let win = null;
let tray = null;
let modo = 'fondo';        // 'fondo' | 'editar'
let anclada = false;
let winApi = null;         // helper nativo de Windows
const WIN_API_ESPERADA = 7;

/**
 * Carga el ayudante nativo una sola vez y comprueba que trae lo que esperamos.
 * Si la app se actualizó a medias y quedó un archivo viejo, más vale enterarse
 * aquí que reventar dentro de un temporizador.
 */
function cargarWinApi() {
  if (winApi) return winApi;
  if (process.platform !== 'win32') return null;
  try {
    const api = require('./win-wallpaper');
    if ((api.VERSION || 0) < WIN_API_ESPERADA) {
      console.warn('[estanteria] win-wallpaper.js esta desactualizado '
        + `(v${api.VERSION || 0}, se esperaba v${WIN_API_ESPERADA}). `
        + 'Vuelve a instalar: algunas funciones no estarán disponibles.');
    }
    winApi = api;
    return winApi;
  } catch (err) {
    contarError('No se pudo cargar el ayudante de Windows', err);
    return null;
  }
}

/** Llama a algo del ayudante solo si de verdad está ahí. */
function conWinApi(nombre, ...args) {
  const api = cargarWinApi();
  if (!api || typeof api[nombre] !== 'function') return undefined;
  try {
    return api[nombre](...args);
  } catch (err) {
    console.warn(`[estanteria] Fallo ${nombre}:`, err.message);
    return undefined;
  }
}
let reloj = null;          // seguimiento del cursor
let relojCapa = null;      // vigilancia del orden dentro del escritorio
let reintento = null;      // reintentos del anclaje
let intentos = 0;
let ultimoFalloAnclaje = '';
let escenas = { lista: [], actual: null };   // distribuciones, para la bandeja

// --- Ventana ------------------------------------------------------------

/** Caja de la pantalla principal en píxeles físicos, relativa al escritorio. */
function cajaFisica() {
  const d = screen.getPrimaryDisplay();
  const todas = screen.getAllDisplays();
  const vx = Math.min(...todas.map((o) => o.bounds.x));
  const vy = Math.min(...todas.map((o) => o.bounds.y));
  const s = d.scaleFactor || 1;
  return {
    x: Math.round((d.bounds.x - vx) * s),
    y: Math.round((d.bounds.y - vy) * s),
    w: Math.round(d.bounds.width * s),
    h: Math.round(d.bounds.height * s),
  };
}

function crearVentana() {
  const bounds = pantallaPrincipal();

  win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: true,
    show: false,
    backgroundColor: '#FFE58B',
    // En X11 esto coloca la ventana en la capa del escritorio ya al crearla.
    type: ES_LINUX && ajustes.anclaje === 'detras' ? 'desktop' : undefined,
    icon: ES_LINUX ? path.join(__dirname, 'build', 'icon.png') : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Es un fondo de escritorio: Chromium lo consideraría "en segundo plano"
      // y le bajaría el ritmo, con lo que los nombres tardarían en salir.
      backgroundThrottling: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (DEPURAR) win.webContents.openDevTools({ mode: 'detach' });

  win.webContents.on('render-process-gone', (_e, detalles) => {
    contarError('La ventana se ha cerrado sola', detalles.reason);
  });
  win.webContents.on('preload-error', (_e, ruta, err) => contarError(`Fallo en ${ruta}`, err));
  win.webContents.on('console-message', (_e, nivel, mensaje) => {
    if (nivel >= 2) console.error('[renderer]', mensaje);
  });

  win.once('ready-to-show', () => {
    win.show();
    aplicarModo(ajustes.anclaje === 'ventana' ? 'editar' : 'fondo');
  });

  // Nunca se cierra por accidente: solo desde la bandeja.
  win.on('close', (e) => {
    if (!app.saliendo) { e.preventDefault(); aplicarModo('fondo'); }
  });

  // Si el shell la tapa (cambio de resolución, reinicio del explorador…),
  // la reponemos en su sitio dentro del escritorio.
  win.on('show', () => { if (anclada) conWinApi('reponer', win, ajustes.anclaje); });

  // "Mostrar escritorio" (la esquina de la barra de tareas, o Win+D) manda
  // minimizar a todas las ventanas. La estantería no es una ventana más: es el
  // escritorio, así que vuelve enseguida a su sitio en vez de esconderse.
  win.on('minimize', () => {
    if (modo === 'editar') return;
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      win.restore();
      aplicarModo('fondo');
    }, 60);
  });
}

// --- Capas del sistema --------------------------------------------------

/*
 * Cuatro formas de estar en pantalla, en orden de "cuánto es un fondo de
 * pantalla de verdad":
 *
 *   detras   hija de la WorkerW que va bajo los iconos. Es literalmente el
 *            fondo de pantalla. No recibe ratón: se lo prestamos nosotros.
 *   encima   hija de Progman, por encima de los iconos. Ratón normal, pero en
 *            algunos equipos Chromium deja de pintar.
 *   suelta   ventana normal empujada al fondo del orden. Funciona siempre; a
 *            cambio puede colarse por delante de otras.
 *   ventana  aplicación corriente, para desarrollo.
 */

function alEscritorio() {
  if (ajustes.anclaje === 'ventana') return;

  if (process.platform === 'win32') {
    if (ajustes.anclaje === 'suelta') {
      if (anclada) { conWinApi('soltar', win); anclada = false; }
      conWinApi('noActivar', win, true);
      win.setAlwaysOnTop(false);
      win.showInactive();
      conWinApi('bajarAlFondo', win);
      vigilarCapa(true);
      despertar();
      console.log('[estanteria] Colocada al fondo del orden de ventanas.');
      return;
    }

    const api = cargarWinApi();
    if (api) {
      try {
        api.anclar(win, ajustes.anclaje, cajaFisica());
        anclada = true;
        intentos = 0;
        ultimoFalloAnclaje = '';
        clearTimeout(reintento);
        reintento = null;
        if (!win.isVisible()) win.show();
        if (ajustes.ocultarIconos) iconosDelSistema(false);
        vigilarCapa(true);
        despertar();
        console.log(`[estanteria] Anclada al escritorio (${ajustes.anclaje}).`);
        return;
      } catch (err) {
        // Con el arranque sin retardo es normal fallar las primeras veces: la
        // app sale antes que el Explorador y el escritorio aún no existe.
        anclada = false;
        ultimoFalloAnclaje = err.message;
        // Sin robar el foco ni ponerse delante: sigue siendo el fondo.
        win.showInactive();
        conWinApi('bajarAlFondo', win);
        programarReintento();
      }
    }
  } else if (ES_LINUX) {
    win.setBounds(pantallaPrincipal());
    win.showInactive();
    // 'detras' ya se creó como ventana de escritorio; 'encima' y 'suelta' son
    // una ventana normal que se pide al gestor de ventanas mantener al fondo.
    if (ajustes.anclaje !== 'detras') pedirAbajoX11();
  }

  // macOS y respaldo general: ventana normal que no se trae al frente.
  win.setAlwaysOnTop(false);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  win.blur();
  despertar();
}

/**
 * Reintenta el anclaje mientras el escritorio no esté listo. Pasa siempre al
 * iniciar sesión: la tarea programada nos saca antes que el Explorador, así que
 * Progman todavía no existe. Sin esto la estantería se queda como una ventana
 * normal y se comporta como tal: se minimiza con "Mostrar escritorio" y no se
 * le prestan los clics.
 */
function programarReintento() {
  clearTimeout(reintento);
  intentos += 1;

  if (intentos > 30) {
    contarError('No se pudo anclar al escritorio', new Error(ultimoFalloAnclaje));
    console.warn('[estanteria] Sigue como ventana normal. Prueba otra capa en la bandeja.');
    intentos = 0;
    return;
  }
  if (intentos === 1) console.log('[estanteria] El escritorio aun no esta listo; reintentando...');

  reintento = setTimeout(() => {
    if (modo === 'fondo' && !anclada) alEscritorio();
  }, 2000);
}

/**
 * El explorador vuelve a subir la capa de iconos cada vez que se toca el
 * escritorio. Si nos deja debajo, la estantería se ve pero no responde, así que
 * nos reponemos en nuestro sitio cada poco: es una sola llamada, sale barato.
 */
function vigilarCapa(activo) {
  clearInterval(relojCapa);
  relojCapa = null;
  if (!activo || process.platform !== 'win32') return;

  relojCapa = setInterval(() => {
    if (modo !== 'fondo') return;
    if (ajustes.anclaje === 'suelta') conWinApi('bajarAlFondo', win);
    else if (anclada) conWinApi('reponer', win, ajustes.anclaje);
  }, 1500);
}

/**
 * Fuerza un repintado. Tras cambiar de capa, Chromium a veces se queda con el
 * último fotograma; un cambio de tamaño de un píxel lo obliga a redibujar.
 */
function despertar() {
  if (!win || win.isDestroyed()) return;
  const avisarMedidas = () => win.webContents.send('estanteria:medir');

  // Anclada en Windows, las medidas se piden a Windows en píxeles físicos:
  // setBounds de Electron trabaja en píxeles lógicos y con escalado (lo normal
  // por encima de 1080p) dejaba la ventana a medio tamaño, en una esquina.
  if (anclada && process.platform === 'win32' && conWinApi('ajustar', win, true)) {
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      conWinApi('ajustar', win, false);
      win.webContents.invalidate?.();
      avisarMedidas();
      // Y se comprueba que de verdad ocupa la pantalla entera.
      clearTimeout(relojComprobar);
      relojComprobar = setTimeout(() => comprobarTamano(0), 500);
    }, 40);
    return;
  }

  const b = pantallaPrincipal();
  win.setBounds({ ...b, height: b.height - 1 });
  setTimeout(() => {
    if (win && !win.isDestroyed()) {
      win.setBounds(b);
      win.webContents.invalidate?.();
      avisarMedidas();
    }
  }, 40);
}

/* --- Comprobar que ocupa toda la pantalla (Windows) ---------------------

   Después de anclarla se mide de verdad: la ventana según Windows y lo que
   pinta Chromium dentro. Si no cuadran con la pantalla, se corrige sola. Las
   medidas quedan en errores.log, para poder saber qué pasó en cada equipo. */

let relojComprobar = null;
let ultimaMedida = null;

const cuadra = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(3, b * 0.01);

async function comprobarTamano(intento) {
  if (!win || win.isDestroyed() || !anclada || process.platform !== 'win32') return;

  const d = screen.getPrimaryDisplay();
  // Lo que mide la pantalla en píxeles reales según Electron (que es quien pinta).
  const pantalla = { w: Math.round(d.size.width * d.scaleFactor), h: Math.round(d.size.height * d.scaleFactor) };
  const real = conWinApi('medidaReal', win);
  let vista = null;
  try {
    const [w, h, dpr] = await win.webContents.executeJavaScript('[innerWidth, innerHeight, devicePixelRatio]');
    vista = { w: Math.round(w * dpr), h: Math.round(h * dpr), escala: dpr };
  } catch (_) { /* aún cargando */ }

  ultimaMedida = { pantalla, real, vista, escala: d.scaleFactor, intento, cuando: new Date().toISOString() };
  const texto = `pantalla ${pantalla.w}x${pantalla.h} (escala ${Math.round(d.scaleFactor * 100)} %), `
    + `ventana ${real ? `${real.w}x${real.h} en ${real.x},${real.y}` : '¿?'}, `
    + `contenido ${vista ? `${vista.w}x${vista.h}` : '¿?'}`;

  // 1) La ventana no mide lo que la pantalla: Windows nos dio medidas en otras
  //    unidades. Se fuerza el tamaño que conoce Electron.
  if (real && (!cuadra(real.w, pantalla.w) || !cuadra(real.h, pantalla.h))) {
    contarError('Tamaño corregido', new Error(texto));
    const actual = conWinApi('diagnosticoEscritorio')?.caja || { x: 0, y: 0, w: real.w, h: real.h };
    const k = actual.w ? pantalla.w / actual.w : 1;
    conWinApi('forzarCaja', win, {
      x: Math.round(actual.x * k), y: Math.round(actual.y * k), w: pantalla.w, h: pantalla.h,
    });
    if (intento < 2) relojComprobar = setTimeout(() => comprobarTamano(intento + 1), 500);
    return;
  }

  // 2) La ventana está bien pero Chromium sigue pintando al tamaño viejo: se
  //    le da un empujón para que se entere.
  if (vista && real && (!cuadra(vista.w, real.w) || !cuadra(vista.h, real.h))) {
    if (intento === 0) contarError('Contenido sin redimensionar', new Error(texto));
    if (intento < 3) {
      conWinApi('ajustar', win, true);
      setTimeout(() => {
        if (!win || win.isDestroyed()) return;
        conWinApi('ajustar', win, false);
        win.webContents.invalidate?.();
        win.webContents.send('estanteria:medir');
      }, 60);
      relojComprobar = setTimeout(() => comprobarTamano(intento + 1), 700);
    }
    return;
  }
  if (intento > 0) console.log(`[estanteria] Tamaño correcto tras corregir: ${texto}`);
}

/** La pantalla principal entera, en píxeles lógicos (lo que usa Electron). */
const pantallaPrincipal = () => ({ ...screen.getPrimaryDisplay().bounds });

function alFrente() {
  clearInterval(relojCapa);
  relojCapa = null;
  if (anclada) { conWinApi('soltar', win); anclada = false; }
  // Volvemos a permitir que tome el foco: si no, no se puede ni escribir.
  conWinApi('noActivar', win, false);
  win.setFocusable(true);
  win.setBounds(pantallaPrincipal());
  win.setAlwaysOnTop(true);
  win.show();
  win.focus();
  win.webContents.send('estanteria:medir');
}

/**
 * En X11, marcar la ventana como _NET_WM_STATE_BELOW (siempre al fondo) y que
 * no salga en el cambiador de ventanas. Se hace por su identificador, no por
 * el título, que con la tilde no siempre casaba.
 */
function pedirAbajoX11() {
  let id = null;
  try {
    const buf = win.getNativeWindowHandle();
    id = `0x${(buf.length >= 8 ? Number(buf.readBigUInt64LE()) : buf.readUInt32LE()).toString(16)}`;
  } catch (_) { /* sin identificador, por el título */ }
  const quien = id ? ['-i', '-r', id] : ['-r', 'Estantería'];
  execFile('wmctrl', [...quien, '-b', 'add,below,skip_pager,skip_taskbar'], (err) => {
    if (err) {
      console.warn('[estanteria] wmctrl no esta instalado: la ventana puede ponerse delante de otras. '
        + 'Instalalo (sudo apt install wmctrl) o usa la capa "Detras de los iconos".');
    }
  });
}

/**
 * 'editar' saca la ventana del escritorio para poder arrastrar botellas.
 * 'fondo' la devuelve a su capa.
 */
function aplicarModo(nuevo) {
  modo = nuevo;
  if (nuevo === 'editar') alFrente();
  else {
    // Ojo: NO se usa setFocusable(false). En Windows deja la ventana sin
    // eventos de ratón, y entonces la estantería se ve pero no responde.
    // De que no robe el foco ya se encarga WS_EX_NOACTIVATE en win-wallpaper.
    win.setAlwaysOnTop(false);
    alEscritorio();
  }
  win.webContents.send('estanteria:modo', modo);
  vigilarCursor(nuevo === 'fondo' && ajustes.anclaje === 'detras');
  actualizarMenuBandeja();
}

function cambiarAnclaje(nuevo) {
  if (ajustes.anclaje === nuevo) return;
  if (nuevo !== 'ventana') anclajeReal = nuevo;
  const reiniciar = process.platform === 'linux';  // el tipo de ventana no se cambia en caliente
  ajustes.anclaje = nuevo;
  guardarAjustes();

  if (reiniciar) {
    dialog.showMessageBox({
      type: 'info',
      message: 'Hay que reiniciar la estantería',
      detail: 'En Linux la capa se elige al abrir la ventana.',
      buttons: ['Reiniciar ahora', 'Más tarde'],
    }).then((r) => {
      if (r.response !== 0) return;
      app.saliendo = true;
      app.relaunch({ execPath: process.env.APPIMAGE || process.execPath });
      app.exit(0);
    });
    return;
  }
  if (anclada) { conWinApi('soltar', win); anclada = false; }
  aplicarModo(modo);
}

// --- Seguimiento del cursor ---------------------------------------------

/**
 * En la capa 'detras' la ventana no recibe ratón, así que los nombres no
 * aparecerían nunca. Aquí seguimos el cursor y le pasamos la posición al
 * renderer, que ya decide sobre qué botella está.
 */
function vigilarCursor(activo) {
  clearInterval(reloj);
  reloj = null;
  if (!activo || !win) return;

  // Si el ayudante no puede leer el ratón, nos quedamos solo con el cursor.
  const api = cargarWinApi();
  const prestaRaton = Boolean(api && typeof api.hayRaton === 'function' && api.hayRaton()
    && typeof api.pulsado === 'function' && typeof api.enElEscritorio === 'function');
  if (process.platform === 'win32' && !prestaRaton) {
    console.warn('[estanteria] Sin clics prestados: solo saldran los nombres al pasar el raton.');
  }

  let anterior = null;
  let izqAntes = false;
  let derAntes = false;
  let ultimoClic = 0;
  let ultimoSitio = { x: -99, y: -99 };

  reloj = setInterval(() => {
    const p = screen.getCursorScreenPoint();
    // Anclada, getBounds de una ventana hija no es fiable: la ventana ocupa
    // siempre la pantalla principal, así que medimos desde ahí.
    const b = anclada ? pantallaPrincipal() : win.getBounds();
    const local = { x: p.x - b.x, y: p.y - b.y };

    if (!anterior || p.x !== anterior.x || p.y !== anterior.y) {
      anterior = p;
      win.webContents.send('estanteria:cursor', local);
    }

    if (!prestaRaton) return;

    // Solo hacemos caso a los botones si de verdad estás sobre el escritorio.
    const izq = conWinApi('pulsado', 'izq');
    const der = conWinApi('pulsado', 'der');
    // Windows pregunta en píxeles físicos; el cursor de Electron viene en
    // lógicos. Sin convertir, con escalado se miraba otro punto de la pantalla.
    const fisico = process.platform === 'win32' ? screen.dipToScreenPoint(p) : p;
    const valido = conWinApi('enElEscritorio', fisico, win) === true;

    if (izq && !izqAntes && valido) {
      const ahora = Date.now();
      const cerca = Math.abs(p.x - ultimoSitio.x) < 6 && Math.abs(p.y - ultimoSitio.y) < 6;
      const doble = ahora - ultimoClic < 450 && cerca;
      ultimoClic = doble ? 0 : ahora;
      ultimoSitio = p;
      win.webContents.send('estanteria:clic', { ...local, boton: 'izq', tipo: 'abajo', doble });
    }
    // El soltar se manda siempre, aunque estés sobre otra ventana: si no, un
    // arrastre que acabe fuera del escritorio se quedaría pegado al cursor.
    if (!izq && izqAntes) {
      win.webContents.send('estanteria:clic', { ...local, boton: 'izq', tipo: 'arriba' });
    }
    if (der && !derAntes && valido) {
      win.webContents.send('estanteria:clic', { ...local, boton: 'der', tipo: 'abajo' });
    }
    izqAntes = izq;
    derAntes = der;
  }, 22);
}

// --- Carpetas del escritorio --------------------------------------------

const ACCESOS = ['.lnk', '.url', '.desktop', '.app'];

/**
 * Las botellas son lo que tienes en el escritorio: carpetas y accesos directos.
 * Aquí solo lo leemos y avisamos cuando cambia; el renderer decide el dibujo.
 */
function leerCarpetas() {
  const dir = dirEscritorio();
  let entradas = [];
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn('[estanteria] No se pudo leer el escritorio:', err.message);
    return [];
  }

  return entradas
    .filter((e) => !e.name.startsWith('.') && e.name.toLowerCase() !== 'desktop.ini')
    .map((e) => {
      const ext = path.extname(e.name).toLowerCase();
      const ruta = path.join(dir, e.name);
      // Los accesos directos en Linux y macOS suelen ser enlaces simbólicos.
      if (e.isSymbolicLink()) {
        try {
          const dest = fs.statSync(ruta);
          if (dest.isDirectory()) return { ruta, nombre: e.name, tipo: 'carpeta' };
          return { ruta, nombre: path.basename(e.name, ext), tipo: 'acceso' };
        } catch (_) {
          return null;   // enlace roto
        }
      }
      if (ext === '.desktop') return { ruta, nombre: nombreDesktop(ruta) || path.basename(e.name, ext), tipo: 'acceso' };
      if (e.isDirectory()) {
        return { ruta: path.join(dir, e.name), nombre: e.name, tipo: 'carpeta' };
      }
      if (ACCESOS.includes(ext)) {
        return { ruta: path.join(dir, e.name), nombre: path.basename(e.name, ext), tipo: 'acceso' };
      }
      // Sin los iconos del sistema, un archivo suelto no se vería en ningún
      // sitio: también sale en la estantería.
      if (ajustes.ocultarIconos && e.isFile()) {
        return { ruta, nombre: e.name, tipo: 'archivo' };
      }
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/**
 * El nombre visible de un lanzador .desktop está dentro del archivo (Name=),
 * en el idioma del sistema si lo trae: "firefox.desktop" se ve como "Firefox".
 */
function nombreDesktop(fichero) {
  try {
    const texto = fs.readFileSync(fichero, 'utf8');
    const seccion = texto.split(/^\[/m).find((s) => s.startsWith('Desktop Entry]')) || texto;
    const idioma = (app.getLocale() || 'es').replace('-', '_');
    const corto = idioma.split('_')[0];
    for (const clave of [`Name[${idioma}]`, `Name[${corto}]`, 'Name']) {
      const m = seccion.match(new RegExp(`^${clave.replace(/[[\]]/g, '\\$&')}=(.+)$`, 'm'));
      if (m) return m[1].trim();
    }
  } catch (_) { /* nada */ }
  return null;
}

let vigilante = null;
let avisoPendiente = null;
let repaso = null;
let ultimaLista = '';

/** Manda la lista al renderer solo si de verdad ha cambiado algo. */
function avisarCarpetas(forzar = false) {
  if (!win || win.isDestroyed()) return;
  const lista = leerCarpetas();
  const firma = JSON.stringify(lista);
  if (!forzar && firma === ultimaLista) return;
  ultimaLista = firma;
  win.webContents.send('estanteria:carpetas', lista);
}

function vigilarEscritorio() {
  try {
    vigilante = fs.watch(dirEscritorio(), { persistent: true }, () => {
      // El explorador toca el escritorio varias veces por operación: agrupamos.
      clearTimeout(avisoPendiente);
      avisoPendiente = setTimeout(() => { avisarCarpetas(); avisarPapelera(); }, 300);
    });
  } catch (err) {
    console.warn('[estanteria] No se pudo vigilar el escritorio:', err.message);
  }

  // fs.watch se pierde algún renombrado en Windows, sobre todo si el cambio
  // viene de otro programa. Un repaso periódico cierra el hueco: leer una
  // carpeta es barato y solo se avisa cuando la lista cambia de verdad.
  repaso = setInterval(() => avisarCarpetas(), 3000);
}

/** Un nombre que no choque con nada de lo que ya hay en el escritorio. */
function nombreLibreCarpeta(base, ext = '') {
  const dir = dirEscritorio();
  let intento = base + ext;
  let n = 2;
  while (fs.existsSync(path.join(dir, intento))) intento = `${base} (${n++})${ext}`;
  return intento;
}

const LIMPIA_NOMBRE = /[\\/:*?"<>|]/g;

// --- Pack de botellas ---------------------------------------------------

/** Tamaño de un PNG leyendo su cabecera IHDR: no hace falta decodificarlo. */
function medidasPNG(fichero) {
  const buf = Buffer.alloc(24);
  const fd = fs.openSync(fichero, 'r');
  try { fs.readSync(fd, buf, 0, 24, 0); } finally { fs.closeSync(fd); }
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// Las "básicas" del pack son las que no llevan dibujo: las pensadas para
// pegarles encima tu propia imagen, así que el editor las enseña primero.
// Vienen listadas al convertir el pack, que es más fiable que adivinar por
// el nombre.
function leerLisas() {
  const f = path.join(DIR_PACK, 'lisas.json');
  try { return new Set(JSON.parse(fs.readFileSync(f, 'utf8'))); } catch (_) { return new Set(); }
}

function nombreDesdeFichero(f) {
  const base = path.basename(f, path.extname(f)).replace(/[._-]+/g, ' ').trim();
  return base.replace(/^./, (c) => c.toUpperCase());
}

function leerPack() {
  if (!fs.existsSync(DIR_PACK)) return [];

  const lisas = leerLisas();
  let alias = {};
  const fAlias = path.join(DIR_PACK, 'nombres.json');
  if (fs.existsSync(fAlias)) {
    try { alias = JSON.parse(fs.readFileSync(fAlias, 'utf8')); } catch (_) { /* nada */ }
  }

  return fs.readdirSync(DIR_PACK)
    .filter((f) => path.extname(f).toLowerCase() === '.png')
    .sort((a, b) => a.localeCompare(b, 'es'))
    .map((f) => {
      const m = medidasPNG(path.join(DIR_PACK, f));
      if (!m) return null;
      return {
        id: f,
        nombre: alias[f] || nombreDesdeFichero(f),
        src: `../assets/pack/${encodeURIComponent(f)}`,
        w: m.w,
        h: m.h,
        lisa: lisas.has(f),
      };
    })
    .filter(Boolean);
}

/**
 * Los lomos de libro. Van aparte del pack de botellas porque se dibujan
 * distinto: llevan texto vertical, y cada uno trae ya calculado el color con
 * el que ese texto se lee bien sobre su lomo.
 */
function leerLibros() {
  if (!fs.existsSync(DIR_LIBROS)) return [];

  let indice = {};
  const fIndice = path.join(DIR_LIBROS, 'nombres.json');
  if (fs.existsSync(fIndice)) {
    try { indice = JSON.parse(fs.readFileSync(fIndice, 'utf8')); } catch (_) { /* nada */ }
  }

  return fs.readdirSync(DIR_LIBROS)
    .filter((f) => path.extname(f).toLowerCase() === '.png')
    .sort((a, b) => a.localeCompare(b, 'es'))
    .map((f) => {
      const m = medidasPNG(path.join(DIR_LIBROS, f));
      if (!m) return null;
      const info = indice[f] || {};
      return {
        id: f,
        familia: 'libro',
        nombre: info.nombre || nombreDesdeFichero(f),
        src: `../assets/libros/${encodeURIComponent(f)}`,
        w: m.w,
        h: m.h,
        lomo: info.lomo || '#888888',
        texto: info.texto || '#ffffff',
      };
    })
    .filter(Boolean);
}

/**
 * El fondo viene en dos capas: la pared, que existe en varios colores, y las
 * estanterías sueltas sobre transparencia. Cambiar de color es cambiar de
 * pared, sin filtros ni recoloreados de por medio.
 */
function leerFondos() {
  if (!fs.existsSync(DIR_FONDOS)) return [];

  let indice = {};
  const fIndice = path.join(DIR_FONDOS, 'nombres.json');
  if (fs.existsSync(fIndice)) {
    try { indice = JSON.parse(fs.readFileSync(fIndice, 'utf8')); } catch (_) { /* nada */ }
  }

  const orden = ['amarillo.png', 'rosa.png', 'lila.png', 'celeste.png', 'verde.png', 'azul.png', 'morado.png'];

  return fs.readdirSync(DIR_FONDOS)
    .filter((f) => path.extname(f).toLowerCase() === '.png')
    .sort((a, b) => {
      const ia = orden.indexOf(a);
      const ib = orden.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, 'es');
    })
    .map((f) => {
      const m = medidasPNG(path.join(DIR_FONDOS, f));
      if (!m) return null;
      const info = indice[f] || {};
      return {
        id: f,
        nombre: info.nombre || nombreDesdeFichero(f),
        src: `../assets/fondos/${encodeURIComponent(f)}`,
        color: info.color || '#ffe58b',
        w: m.w,
        h: m.h,
      };
    })
    .filter(Boolean);
}

const capaEstanterias = () => (fs.existsSync(path.join(DIR_ASSETS, 'estanterias.png'))
  ? '../assets/estanterias.png' : null);

// --- Imágenes pegadas en las botellas -----------------------------------

const MIMES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml',
};

const aDataURL = (fichero) => {
  const mime = MIMES[path.extname(fichero).toLowerCase()];
  if (!mime) return null;
  return `data:${mime};base64,${fs.readFileSync(fichero).toString('base64')}`;
};

function leerImagenes() {
  const dir = dirEtiquetas();
  if (!fs.existsSync(dir)) return {};
  const salida = {};
  for (const f of fs.readdirSync(dir)) {
    const datos = aDataURL(path.join(dir, f));
    if (datos) salida[f] = datos;
  }
  return salida;
}

function nombreLibre(nombre) {
  const dir = dirEtiquetas();
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(nombre).toLowerCase() || '.png';
  const base = path.basename(nombre, path.extname(nombre)).replace(/[^\w-]+/g, '-').slice(0, 40) || 'imagen';
  let intento = `${base}${ext}`;
  let n = 1;
  while (fs.existsSync(path.join(dir, intento))) intento = `${base}-${n++}${ext}`;
  return intento;
}

// --- Persistencia -------------------------------------------------------

function leerEstado() {
  // Si el principal se estropeó (un apagón a mitad de guardar), la copia anterior.
  for (const f of [ficheroEstado(), `${ficheroEstado()}.bak`]) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { /* siguiente */ }
  }
  return null;
}

/** Escribe en un temporal y lo cambia de sitio: nunca queda un JSON a medias. */
function escribirSeguro(fichero, texto) {
  fs.mkdirSync(path.dirname(fichero), { recursive: true });
  const tmp = `${fichero}.tmp`;
  fs.writeFileSync(tmp, texto, 'utf8');
  if (fs.existsSync(fichero)) {
    try { fs.copyFileSync(fichero, `${fichero}.bak`); } catch (_) { /* sin copia, sigue */ }
  }
  fs.renameSync(tmp, fichero);
}

function guardarEstado(estado) {
  if (!estado || typeof estado !== 'object') return false;
  try {
    escribirSeguro(ficheroEstado(), JSON.stringify(estado, null, 2));
    return true;
  } catch (err) {
    console.error('[estanteria] Error al guardar:', err.message);
    return false;
  }
}

// --- IPC ----------------------------------------------------------------

ipcMain.handle('estanteria:cargar', () => ({
  pack: leerPack(),
  libros: leerLibros(),
  carpetas: leerCarpetas(),
  escritorio: dirEscritorio(),
  papelera: false,   // se confirma enseguida por 'estanteria:papelera'
  fondos: leerFondos(),
  estanterias: capaEstanterias(),
  imagenes: leerImagenes(),
  estado: leerEstado(),
  modo,
  anclaje: ajustes.anclaje,
  anclada,
  plataforma: process.platform,
}));

ipcMain.handle('estanteria:guardar', (_e, estado) => guardarEstado(estado));

ipcMain.handle('estanteria:modo', (_e, nuevo) => {
  aplicarModo(nuevo === 'editar' ? 'editar' : 'fondo');
  return modo;
});

ipcMain.handle('estanteria:elegir-carpeta', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Elige la carpeta que abrirá esta botella',
    buttonLabel: 'Vincular',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return { ruta: r.filePaths[0], nombre: path.basename(r.filePaths[0]) };
});

ipcMain.handle('estanteria:importar-imagenes', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Elige las imágenes que quieres pegar en la botella',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'] }],
  });
  if (r.canceled) return [];

  return r.filePaths.map((origen) => {
    const id = nombreLibre(path.basename(origen));
    fs.copyFileSync(origen, path.join(dirEtiquetas(), id));
    return { id, datos: aDataURL(path.join(dirEtiquetas(), id)) };
  }).filter((x) => x.datos);
});

ipcMain.handle('estanteria:guardar-imagen', (_e, nombre, dataURL) => {
  const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(dataURL || '');
  if (!m) return null;
  const id = nombreLibre(nombre || 'imagen.png');
  fs.writeFileSync(path.join(dirEtiquetas(), id), Buffer.from(m[2], 'base64'));
  return { id, datos: dataURL };
});

/**
 * Devuelve una imagen de assets como data URL. Hace falta para poder
 * recolorearla en un lienzo: una imagen cargada por file:// "mancha" el lienzo
 * y el navegador se niega a dejar leer sus pixeles.
 */
ipcMain.handle('estanteria:imagen', (_e, relativa) => {
  const limpia = String(relativa || '').replace(/^\.\.\//, '');
  let destino;
  try {
    destino = path.resolve(DIR_ASSETS, decodeURIComponent(limpia.replace(/^assets\//, '')));
  } catch (_) {
    return null;   // URL mal codificada
  }
  if (!destino.startsWith(DIR_ASSETS + path.sep) || !fs.existsSync(destino)) return null;
  return aDataURL(destino);
});

ipcMain.handle('estanteria:abrir-ruta', async (_e, ruta) => {
  if (!ruta) return false;
  try { fs.lstatSync(ruta); } catch (_) { return false; }
  // En Linux, lanzador propio: directo y con el entorno de tu sesión (ver
  // linux-lanzar.js). shell.openPath pasaba por xdg-open con el entorno que
  // deja Electron, y eso era lo que hacía tardar tanto.
  if (linux) {
    try {
      if (await linux.abrir(ruta)) return true;
    } catch (err) {
      contarError('No se pudo abrir', err);
    }
  }
  const err = await shell.openPath(ruta);
  if (err) console.warn('[estanteria] No se pudo abrir:', ruta, err);
  return !err;
});

ipcMain.handle('estanteria:crear-carpeta', (_e, nombre) => {
  const limpio = String(nombre || 'Nueva carpeta').replace(LIMPIA_NOMBRE, '').trim() || 'Nueva carpeta';
  const final = nombreLibreCarpeta(limpio);
  const ruta = path.join(dirEscritorio(), final);
  try {
    fs.mkdirSync(ruta);
    return { ruta, nombre: final };
  } catch (err) {
    console.error('[estanteria] No se pudo crear la carpeta:', err.message);
    return null;
  }
});

ipcMain.handle('estanteria:renombrar-carpeta', (_e, ruta, nombre) => {
  const limpio = String(nombre || '').replace(LIMPIA_NOMBRE, '').trim();
  if (!limpio || !fs.existsSync(ruta)) return null;

  // Un acceso directo conserva su extensión: el nombre visible es el resto.
  const ext = fs.statSync(ruta).isDirectory() ? '' : path.extname(ruta);
  const actual = path.basename(ruta, ext);
  if (actual === limpio) return { ruta, nombre: limpio };

  const destino = path.join(path.dirname(ruta), nombreLibreCarpeta(limpio, ext));
  try {
    fs.renameSync(ruta, destino);
    setTimeout(() => avisarCarpetas(true), 60);
    return { ruta: destino, nombre: path.basename(destino, ext) };
  } catch (err) {
    console.error('[estanteria] No se pudo renombrar:', err.message);
    return null;
  }
});

// --- Accesos directos ---------------------------------------------------

ipcMain.handle('estanteria:crear-acceso', async () => {
  const filtros = process.platform === 'win32'
    ? [{ name: 'Programas', extensions: ['exe', 'bat', 'cmd', 'msi', 'lnk'] }, { name: 'Todo', extensions: ['*'] }]
    : [{ name: 'Todo', extensions: ['*'] }, { name: 'Lanzadores', extensions: ['desktop'] }];

  const r = await dialog.showOpenDialog(win, {
    title: 'Elige el programa al que apuntará el acceso directo',
    defaultPath: ES_LINUX && fs.existsSync('/usr/share/applications') ? '/usr/share/applications' : undefined,
    buttonLabel: 'Crear acceso',
    properties: ['openFile'],
    filters: filtros,
  });
  if (r.canceled || !r.filePaths.length) return null;

  const destinoReal = r.filePaths[0];
  const etiqueta = path.basename(destinoReal, path.extname(destinoReal));

  try {
    if (process.platform === 'win32') {
      const ruta = path.join(dirEscritorio(), nombreLibreCarpeta(etiqueta, '.lnk'));
      const ok = shell.writeShortcutLink(ruta, 'create', {
        target: destinoReal,
        cwd: path.dirname(destinoReal),
        description: etiqueta,
      });
      return ok ? { ruta, nombre: path.basename(ruta, '.lnk') } : null;
    }
    // Elegir un lanzador .desktop (p. ej. de /usr/share/applications) lo
    // copia al escritorio, que es como funcionan los accesos en Linux.
    if (ES_LINUX && destinoReal.toLowerCase().endsWith('.desktop')) {
      const ruta = path.join(dirEscritorio(), nombreLibreCarpeta(etiqueta, '.desktop'));
      fs.copyFileSync(destinoReal, ruta);
      fs.chmodSync(ruta, 0o755);
      // GNOME solo los lanza si están marcados como de confianza.
      ejecutar('gio', ['set', ruta, 'metadata::trusted', 'true']);
      return { ruta, nombre: nombreDesktop(ruta) || etiqueta };
    }
    // Fuera de Windows, un enlace simbólico hace el mismo papel.
    const ruta = path.join(dirEscritorio(), nombreLibreCarpeta(etiqueta));
    fs.symlinkSync(destinoReal, ruta);
    return { ruta, nombre: etiqueta };
  } catch (err) {
    console.error('[estanteria] No se pudo crear el acceso directo:', err.message);
    return null;
  }
});

ipcMain.handle('estanteria:crear-documento', () => {
  const ruta = path.join(dirEscritorio(), nombreLibreCarpeta('Nuevo documento de texto', '.txt'));
  try {
    fs.writeFileSync(ruta, '', 'utf8');
    return { ruta, nombre: path.basename(ruta, '.txt') };
  } catch (err) {
    console.error('[estanteria] No se pudo crear el documento:', err.message);
    return null;
  }
});

// --- Papelera de reciclaje ----------------------------------------------

/** Ejecuta PowerShell y devuelve su salida, o null si algo falla. */
function powershell(orden) {
  return new Promise((res) => {
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', orden],
      { windowsHide: true, timeout: 8000 },
      (err, salida) => res(err ? null : String(salida).trim()));
  });
}

/** La papelera de Linux sigue el estándar XDG: respeta XDG_DATA_HOME. */
const dirPapeleraXDG = () => path.join(
  process.env.XDG_DATA_HOME || path.join(app.getPath('home'), '.local', 'share'), 'Trash');

const dirPapelera = () => (process.platform === 'darwin'
  ? path.join(app.getPath('home'), '.Trash')
  : path.join(dirPapeleraXDG(), 'files'));

/** ¿Tiene algo dentro? Sirve para dibujarla llena o vacía. */
async function papeleraLlena() {
  if (process.platform === 'win32') {
    const n = await powershell('(New-Object -ComObject Shell.Application).NameSpace(10).Items().Count');
    return n === null ? false : Number(n) > 0;
  }
  try {
    return fs.readdirSync(dirPapelera()).length > 0;
  } catch (_) {
    return false;
  }
}

async function avisarPapelera() {
  const llena = await papeleraLlena();
  if (win && !win.isDestroyed()) win.webContents.send('estanteria:papelera', llena);
}

ipcMain.handle('estanteria:papelera-estado', () => papeleraLlena());

ipcMain.handle('estanteria:papelera-abrir', () => {
  if (process.platform === 'win32') spawn('explorer.exe', ['shell:RecycleBinFolder'], { detached: true });
  else if (ES_LINUX) {
    // Con el gestor de archivos se ve como papelera (con "Restaurar"), no
    // como una carpeta suelta.
    lanzarPrimero([['gio', 'open', 'trash:///']]).then((ok) => { if (!ok) shell.openPath(dirPapelera()); });
  } else shell.openPath(dirPapelera());
  return true;
});

ipcMain.handle('estanteria:papelera-vaciar', async () => {
  if (process.platform === 'win32') {
    await powershell('Clear-RecycleBin -Force -ErrorAction SilentlyContinue');
  } else if (ES_LINUX && await ejecutar('gio', ['trash', '--empty'])) {
    // gio vacía también las papeleras de otros discos
  } else {
    try {
      // En Linux, junto a cada archivo hay una ficha en info/: se borran ambas.
      const dirs = ES_LINUX ? [dirPapelera(), path.join(dirPapeleraXDG(), 'info')] : [dirPapelera()];
      for (const d of dirs) {
        if (!fs.existsSync(d)) continue;
        for (const f of fs.readdirSync(d)) fs.rmSync(path.join(d, f), { recursive: true, force: true });
      }
    } catch (err) {
      contarError('No se pudo vaciar la papelera', err);
    }
  }
  await avisarPapelera();
  return true;
});

// --- Portapapeles -------------------------------------------------------

/**
 * Portapapeles propio. Windows no deja escribir una lista de archivos en el
 * portapapeles del sistema desde aquí, así que guardamos las rutas nosotros;
 * al pegar, además, miramos si el Explorador ha dejado algo suyo.
 */
let portapapeles = { rutas: [], modo: 'copiar' };

ipcMain.handle('estanteria:copiar', (_e, rutas, modo) => {
  portapapeles = { rutas: (rutas || []).filter((r) => fs.existsSync(r)), modo: modo === 'cortar' ? 'cortar' : 'copiar' };
  return portapapeles.rutas.length;
});

/** Lo que el Explorador haya dejado en el portapapeles del sistema. */
function delSistema() {
  try {
    const t = clipboard.read('FileNameW');
    if (!t) return [];
    const limpio = t.replace(/\u0000/g, '').trim();
    return limpio && fs.existsSync(limpio) ? [limpio] : [];
  } catch (_) {
    return [];
  }
}

ipcMain.handle('estanteria:hay-que-pegar', () => portapapeles.rutas.length > 0 || delSistema().length > 0);

ipcMain.handle('estanteria:pegar', () => {
  const propio = portapapeles.rutas.filter((r) => fs.existsSync(r));
  const rutas = propio.length ? propio : delSistema();
  const cortar = propio.length ? portapapeles.modo === 'cortar' : false;
  const creadas = [];

  const escritorio = path.resolve(dirEscritorio());

  for (const origen of rutas) {
    try {
      const dir = path.resolve(path.dirname(origen));
      const esDir = fs.statSync(origen).isDirectory();
      const ext = esDir ? '' : path.extname(origen);
      let base = path.basename(origen, ext);

      // Cortar y pegar en el mismo escritorio no mueve nada: se deja como está.
      if (cortar && dir === escritorio) { creadas.push(origen); continue; }
      // Una carpeta que contiene el escritorio no puede copiarse dentro de él.
      if (esDir && (escritorio + path.sep).startsWith(path.resolve(origen) + path.sep)) {
        console.warn('[estanteria] No se puede pegar una carpeta dentro de sí misma:', origen);
        continue;
      }

      // Copiar algo que ya está en el escritorio crea una copia, no lo pisa.
      if (dir === escritorio) base += ' - copia';
      const destino = path.join(dirEscritorio(), nombreLibreCarpeta(base, ext));

      if (cortar) {
        try {
          fs.renameSync(origen, destino);
        } catch (_) {
          fs.cpSync(origen, destino, { recursive: true });
          fs.rmSync(origen, { recursive: true, force: true });
        }
      } else {
        fs.cpSync(origen, destino, { recursive: true });
      }
      creadas.push(destino);
    } catch (err) {
      console.error('[estanteria] No se pudo pegar:', err.message);
    }
  }

  if (cortar) portapapeles = { rutas: [], modo: 'copiar' };
  return creadas;
});

// --- Atajos del escritorio de Windows -----------------------------------

ipcMain.handle('estanteria:sistema', (_e, que) => {
  const dir = dirEscritorio();
  if (que === 'pantalla' || que === 'personalizar') {
    if (process.platform === 'win32') {
      return shell.openExternal(que === 'pantalla' ? 'ms-settings:display' : 'ms-settings:personalization')
        .then(() => true, () => false);
    }
    if (ES_LINUX) {
      // Cada escritorio tiene su panel de ajustes: se prueba el que haya.
      return que === 'pantalla'
        ? lanzarPrimero([['gnome-control-center', 'display'], ['kcmshell6', 'kcm_kscreen'],
          ['kcmshell5', 'kcm_kscreen'], ['xfce4-display-settings'], ['cinnamon-settings', 'display'],
          ['mate-display-properties'], ['arandr']])
        : lanzarPrimero([['gnome-control-center', 'background'], ['systemsettings', 'kcm_wallpaper'],
          ['systemsettings5'], ['xfce4-settings-manager'], ['cinnamon-settings', 'backgrounds'],
          ['mate-appearance-properties']]);
    }
    return false;
  }
  if (que === 'terminal') {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', 'wt.exe', '-d', dir], { detached: true, shell: false })
        .on('error', () => spawn('cmd.exe', ['/c', 'start', '', 'cmd.exe'], { cwd: dir, detached: true }));
      return true;
    }
    return lanzarPrimero([['x-terminal-emulator'], ['gnome-terminal'], ['konsole'], ['xfce4-terminal'],
      ['mate-terminal'], ['tilix'], ['kitty'], ['alacritty'], ['xterm']], dir);
  }
  return false;
});

ipcMain.handle('estanteria:tirar-carpeta', async (_e, ruta) => {
  if (!ruta || !fs.existsSync(ruta)) return false;
  try {
    await shell.trashItem(ruta);      // a la papelera, nunca borrado directo
    avisarPapelera();
    return true;
  } catch (err) {
    console.error('[estanteria] No se pudo enviar a la papelera:', err.message);
    return false;
  }
});

ipcMain.handle('estanteria:carpetas', () => leerCarpetas());

/** Aplicaciones instaladas (solo Linux): lo que sale en el menú del sistema. */
ipcMain.handle('estanteria:apps', (_e, refrescar) => (linux ? linux.listarApps(app.getLocale(), Boolean(refrescar)) : []));

/**
 * Archivos soltados sobre la estantería desde el gestor de archivos: pasan al
 * escritorio, como cuando se sueltan sobre el escritorio de siempre. Se
 * mueven si vienen del mismo disco y se copian si no (o si se pide copiar).
 */
ipcMain.handle('estanteria:traer-archivos', (_e, rutas, copiar) => {
  const escritorio = path.resolve(dirEscritorio());
  const hechas = [];
  for (const origen of (Array.isArray(rutas) ? rutas : []).filter((r) => typeof r === 'string')) {
    try {
      const st = fs.lstatSync(origen);
      const dir = path.resolve(path.dirname(origen));
      if (dir === escritorio) { hechas.push(origen); continue; }   // ya estaba
      if (st.isDirectory() && (escritorio + path.sep).startsWith(path.resolve(origen) + path.sep)) continue;
      const ext = st.isDirectory() ? '' : path.extname(origen);
      const destino = path.join(escritorio, nombreLibreCarpeta(path.basename(origen, ext), ext));
      if (copiar) {
        fs.cpSync(origen, destino, { recursive: true, verbatimSymlinks: true });
      } else {
        try {
          fs.renameSync(origen, destino);
        } catch (err) {
          if (err.code !== 'EXDEV') throw err;
          // Otro disco: se copia y se borra el original, como hace el gestor de archivos.
          fs.cpSync(origen, destino, { recursive: true, verbatimSymlinks: true });
          fs.rmSync(origen, { recursive: true, force: true });
        }
      }
      hechas.push(destino);
    } catch (err) {
      console.error('[estanteria] No se pudo traer:', origen, err.message);
    }
  }
  setTimeout(() => avisarCarpetas(true), 60);
  return hechas;
});

ipcMain.handle('estanteria:abrir-carpeta', () => {
  fs.mkdirSync(DIR_PACK, { recursive: true });
  shell.openPath(DIR_PACK);
});

ipcMain.handle('estanteria:salir', () => { app.saliendo = true; app.quit(); });

/**
 * Menú emergente del sistema. En la capa de fondo de pantalla nuestra ventana
 * no recibe clics, así que un menú dibujado dentro de ella no se podría pulsar:
 * este es una ventana de verdad de Windows y funciona siempre.
 */
ipcMain.handle('estanteria:menu-nativo', (_e, opciones, punto) => {
  const construir = (lista) => lista.map((op) => {
    if (op.sep) return { type: 'separator' };
    if (op.sub) return { label: op.txt, submenu: construir(op.sub) };
    return {
      label: op.txt,
      enabled: !op.apagado,
      type: op.marca !== undefined ? 'checkbox' : 'normal',
      checked: Boolean(op.marca),
      click: () => win.webContents.send('estanteria:menu-elegido', op.id),
    };
  });

  Menu.buildFromTemplate(construir(opciones)).popup({
    window: win,
    x: Math.round(punto?.x ?? 0),
    y: Math.round(punto?.y ?? 0),
  });
  return true;
});

// El renderer nos cuenta qué distribuciones hay para poder cambiarlas desde
// la bandeja sin necesidad de desbloquear la estantería.
ipcMain.on('estanteria:escenas', (_e, datos) => {
  escenas = datos && Array.isArray(datos.lista) ? datos : { lista: [], actual: null };
  actualizarMenuBandeja();
});

// --- Bandeja ------------------------------------------------------------

function iconoBandeja() {
  const f = path.join(DIR_ASSETS, 'icono.png');
  // En Linux el panel escala el icono él solo y se ve mejor a 22 o 24 px.
  const lado = ES_LINUX ? 24 : 18;
  if (fs.existsSync(f)) return nativeImage.createFromPath(f).resize({ width: lado, height: lado });
  return nativeImage.createEmpty();
}

function actualizarMenuBandeja() {
  if (!tray) return;

  const capa = (id, label, detalle) => ({
    label,
    sublabel: detalle,
    type: 'radio',
    checked: ajustes.anclaje === id,
    // En Linux 'suelta' es lo mismo que 'encima'; en macOS no hay 'detras'.
    enabled: process.platform === 'win32' || id === 'ventana' || id === 'encima'
      || (ES_LINUX && id === 'detras'),
    click: () => cambiarAnclaje(id),
  });

  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: modo === 'editar' ? 'Bloquear estantería' : 'Ordenar estantería',
      click: () => aplicarModo(modo === 'editar' ? 'fondo' : 'editar'),
    },
    {
      label: 'Nueva botella…',
      click: () => { aplicarModo('editar'); win.webContents.send('estanteria:nueva'); },
    },
    ...(escenas.lista.length > 1 ? [{
      label: 'Distribución',
      submenu: escenas.lista.map((e) => ({
        label: e.nombre,
        type: 'radio',
        checked: e.id === escenas.actual,
        click: () => win.webContents.send('estanteria:escena', e.id),
      })),
    }] : []),
    { type: 'separator' },
    {
      label: 'Dónde va la estantería',
      submenu: [
        capa('detras', 'Detrás de los iconos', 'Fondo de pantalla real'),
        capa('encima', 'Sobre los iconos', 'Ratón normal, puede congelarse'),
        capa('suelta', 'Suelta, sin anclar', 'Si ninguna responde'),
        capa('ventana', 'Como ventana', 'Para probar'),
      ],
    },
    {
      label: ES_LINUX ? 'Sustituir el escritorio' : 'Ocultar los iconos de Windows',
      sublabel: ES_LINUX ? 'Quita los iconos del sistema; tus archivos salen en la estantería' : undefined,
      type: 'checkbox',
      checked: ajustes.ocultarIconos,
      enabled: process.platform === 'win32' || ES_LINUX,
      click: (item) => {
        ajustes.ocultarIconos = item.checked;
        guardarAjustes();
        const r = iconosDelSistema(!item.checked);
        // Con los iconos del sistema quitados, los archivos sueltos del
        // escritorio pasan a la estantería para no perderlos de vista.
        avisarCarpetas(true);
        if (r !== true) {
          dialog.showMessageBox({
            type: 'warning',
            message: 'No se pudieron quitar los iconos del escritorio',
            detail: typeof r === 'string' ? r
              : 'Puede hacerse a mano: clic derecho en el escritorio → Ver → Mostrar iconos del escritorio.',
          });
        }
      },
    },
    {
      label: 'Prioridad',
      submenu: ['alta', 'media', 'normal'].map((n) => ({
        label: { alta: 'Alta', media: 'Por encima de lo normal', normal: 'Normal' }[n],
        type: 'radio',
        checked: ajustes.prioridad === n,
        click: () => { ajustes.prioridad = n; guardarAjustes(); aplicarPrioridad(); },
      })),
    },
    {
      label: 'Abrir al iniciar sesión',
      sublabel: process.platform === 'win32' ? 'Sin retardo, de los primeros' : undefined,
      // En desarrollo apuntaría al Electron de node_modules; en Linux sí se
      // puede siempre que sea el AppImage o un paquete instalado.
      type: 'checkbox',
      checked: ajustes.arranque,
      enabled: app.isPackaged,
      click: async (item) => {
        ajustes.arranque = item.checked;
        guardarAjustes();
        await arranqueAutomatico(item.checked);
        actualizarMenuBandeja();
      },
    },
    { type: 'separator' },
    { label: 'Comprobar el estado…', click: mostrarEstado },
    { label: 'Abrir el escritorio', click: () => (linux ? linux.abrir(dirEscritorio()) : shell.openPath(dirEscritorio())) },
    { label: 'Abrir el pack de botellas', click: () => { fs.mkdirSync(DIR_PACK, { recursive: true }); shell.openPath(DIR_PACK); } },
    { label: 'Recargar', click: () => win.webContents.send('estanteria:recargar') },
    { type: 'separator' },
    { label: 'Salir', click: () => { app.saliendo = true; app.quit(); } },
  ]));
}

/**
 * Diagnóstico. Cuando algo no responde, lo primero que hay que saber es si la
 * ventana llegó a anclarse y si el ratón prestado está disponible; sin esto hay
 * que adivinar.
 */
function mostrarEstado() {
  const api = cargarWinApi();
  const raton = api && typeof api.estadoRaton === 'function' ? api.estadoRaton() : null;
  const esc = api && typeof api.diagnosticoEscritorio === 'function' ? api.diagnosticoEscritorio() : null;
  const si = (v) => (v ? 'sí' : 'NO');

  const lineas = [
    `Capa elegida: ${ajustes.anclaje}`,
    `Anclada al escritorio: ${si(anclada)}`,
    anclada ? null : `  Último fallo: ${ultimoFalloAnclaje || '—'}`,
    anclada ? null : `  Reintentos: ${intentos}`,
    `Ayudante de Windows: ${si(api)}${api ? ` (v${api.VERSION || 0}, se espera v${WIN_API_ESPERADA})` : ''}`,
    esc ? `Progman: ${si(esc.progman)}` : null,
    esc ? `WorkerW encontradas: ${esc.workerw} (con iconos dentro: ${esc.conIconos})` : null,
    esc ? `Iconos colgando de Progman: ${si(esc.iconosEnProgman)}  → ${esc.iconosEnProgman ? 'Windows 11' : 'Windows 10'}` : null,
    esc ? `Capa del fondo localizada: ${si(esc.elegida)}` : null,
    esc && esc.monitor ? `Monitor principal (px reales): ${esc.monitor.right - esc.monitor.left}×${esc.monitor.bottom - esc.monitor.top}` : null,
    esc && esc.caja ? `Tamaño de la estantería: ${esc.caja.w}×${esc.caja.h} en (${esc.caja.x}, ${esc.caja.y})` : null,
    `Pantalla según Electron: ${screen.getPrimaryDisplay().size.width}×${screen.getPrimaryDisplay().size.height} `
      + `a escala ${Math.round(screen.getPrimaryDisplay().scaleFactor * 100)} %`,
    process.platform === 'win32' ? `Windows ${os.release()}${esc && esc.win24H2 ? ' (escritorio de 24H2)' : ''}` : null,
    (() => {
      const r = conWinApi('medidaReal', win);
      return r ? `Ventana real: ${r.w}×${r.h} en (${r.x}, ${r.y})${esc && esc.forzada ? ' · tamaño corregido' : ''}` : null;
    })(),
    ultimaMedida && ultimaMedida.vista ? `Contenido pintado: ${ultimaMedida.vista.w}×${ultimaMedida.vista.h}` : null,
    ES_LINUX ? `Sesión: ${process.env.XDG_SESSION_TYPE || '¿?'} · Escritorio: ${process.env.XDG_CURRENT_DESKTOP || '¿?'}` : null,
    raton ? `Lectura de botones: ${si(raton.botones)}` : null,
    raton ? `Ventana bajo el cursor: ${si(raton.bajoCursor)}` : null,
    raton ? `Ventana en primer plano: ${si(raton.primerPlano)}` : null,
    raton && raton.fallos?.length ? `Fallos: ${raton.fallos.join(' | ')}` : null,
    `${ES_LINUX ? 'Sustituye al escritorio' : 'Iconos de Windows ocultos'}: ${si(ajustes.ocultarIconos)}`,
    `Modo actual: ${modo}`,
  ].filter(Boolean);

  dialog.showMessageBox({
    type: anclada ? 'info' : 'warning',
    message: anclada ? 'La estantería está en su sitio' : 'La estantería no está anclada al escritorio',
    detail: lineas.join('\n'),
    buttons: ['Cerrar', 'Copiar'],
  }).then((r) => {
    if (r.response === 1) clipboard.writeText(lineas.join('\n'));
  });
}

function crearBandeja() {
  tray = new Tray(iconoBandeja());
  tray.setToolTip('Estantería');
  actualizarMenuBandeja();
  tray.on('click', () => aplicarModo(modo === 'editar' ? 'fondo' : 'editar'));
}

// --- Ciclo de vida ------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  console.log('[estanteria] Ya habia una estanteria abierta: se ha desbloqueado esa.\n'
    + '                Si no la ves, busca su icono en la bandeja del sistema, junto al reloj.');
  app.quit();
} else {
  /* Abrir la app a mano cuando ya está en marcha la desbloquea: es la forma de
     encontrarla. Pero al encender el ordenador pueden lanzarse dos copias a la
     vez (la tarea programada y la clave del registro, o una tarea de una
     versión anterior), y la segunda abría el modo edición. Esas se ignoran. */
  app.on('second-instance', (_e, argv) => {
    const automatica = argv.includes(ARG_ARRANQUE) || Date.now() - INICIO < 90000;
    if (automatica || !win || win.isDestroyed()) return;
    aplicarModo('editar');
  });

  app.whenReady().then(() => {
    leerAjustes();
    aplicarPrioridad();
    if (process.platform === 'darwin') app.dock?.hide();
    // Solo tiene sentido registrar el arranque automático si está instalada:
    // en desarrollo apuntaría al electron.exe de node_modules.
    if (app.isPackaged) arranqueAutomatico(ajustes.arranque);

    // Hay distribuciones sin carpeta Escritorio hasta que se crea algo en ella.
    try { fs.mkdirSync(dirEscritorio(), { recursive: true }); } catch (_) { /* nada */ }

    if (linuxEscritorio) {
      linuxEscritorio.configurar({ env: entornoHijos(), dirDatos: app.getPath('userData') });
      // Si la última vez se cerró de golpe, los iconos siguen apagados: se
      // restauran, y si toca sustituir el escritorio se vuelven a apagar.
      linuxEscritorio.restaurarIconos();
      if (ajustes.ocultarIconos) iconosDelSistema(false);
    }

    crearVentana();
    crearBandeja();
    vigilarEscritorio();
    linux?.precalentar();
    avisarPapelera();

    globalShortcut.register('CommandOrControl+Alt+E', () => {
      aplicarModo(modo === 'editar' ? 'fondo' : 'editar');
    });

    // El explorador de Windows recrea el escritorio al cambiar de resolución.
    // Cambiar de resolución o de escala: se vuelve a medir y a colocar. Se
    // espera un poco porque el Explorador recrea el escritorio a la vez.
    let cambioPantalla = null;
    screen.on('display-metrics-changed', () => {
      clearTimeout(cambioPantalla);
      cambioPantalla = setTimeout(() => {
        if (!win || win.isDestroyed()) return;
        if (!anclada) win.setBounds(pantallaPrincipal());
        aplicarModo(modo);
      }, 400);
    });
    screen.on('display-added', () => { if (win && !win.isDestroyed()) aplicarModo(modo); });
    screen.on('display-removed', () => { if (win && !win.isDestroyed()) aplicarModo(modo); });
  });

  app.on('window-all-closed', () => { if (app.saliendo) app.quit(); });
  // Al cerrar sesión o apagar, Linux manda SIGTERM: también se deja todo como estaba.
  for (const senal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(senal, () => { app.saliendo = true; app.quit(); });
  }
  app.on('will-quit', () => {
    clearTimeout(reintento);
    clearTimeout(relojComprobar);
    clearInterval(repaso);
    // Nunca dejamos el escritorio peor de como lo encontramos.
    if (ajustes.ocultarIconos) iconosDelSistema(true);
    clearInterval(relojCapa);
    clearInterval(reloj);
    clearTimeout(avisoPendiente);
    vigilante?.close();
    globalShortcut.unregisterAll();
  });
}
