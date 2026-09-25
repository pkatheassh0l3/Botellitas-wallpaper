'use strict';

/**
 * Anclaje al escritorio en Windows.
 *
 * El explorador dibuja el escritorio dentro de una ventana `Progman`, que
 * contiene el fondo de pantalla y, encima, `SHELLDLL_DefView` con los iconos.
 * Enviando el mensaje no documentado 0x052C a Progman se le fuerza a crear
 * además una `WorkerW` situada DETRÁS de los iconos.
 *
 * De ahí las dos capas:
 *
 *   'detras'  hija de esa WorkerW: literalmente el fondo de pantalla. No hay
 *             ventana, ni barra de tareas, ni Alt+Tab. No recibe ratón, porque
 *             la capa de iconos la tapa entera; para eso están `pulsado` y
 *             `enElEscritorio`, con los que la app se lo presta.
 *
 *   'encima'  hija de Progman y por encima de SHELLDLL_DefView. Recibe ratón
 *             de forma normal, pero en algunos equipos Chromium deja de pintar.
 *
 * Todo depende de detalles internos del explorador, así que cada función lanza
 * si no encuentra lo que espera y main.js se queda en ventana normal.
 */

const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const HWND = 'uintptr_t';

const FindWindowW = user32.func('__stdcall', 'FindWindowW', HWND, ['str16', 'str16']);
const FindWindowExW = user32.func('__stdcall', 'FindWindowExW', HWND, [HWND, HWND, 'str16', 'str16']);
const SetParent = user32.func('__stdcall', 'SetParent', HWND, [HWND, HWND]);
const ShowWindow = user32.func('__stdcall', 'ShowWindow', 'bool', [HWND, 'int']);
const EnableWindow = user32.func('__stdcall', 'EnableWindow', 'bool', [HWND, 'bool']);
const SendMessageTimeoutW = user32.func('__stdcall', 'SendMessageTimeoutW', 'long',
  [HWND, 'uint', 'uintptr_t', 'uintptr_t', 'uint', 'uint', 'void *']);
const SetWindowPos = user32.func('__stdcall', 'SetWindowPos', 'bool',
  [HWND, HWND, 'int', 'int', 'int', 'int', 'uint']);

/* Para el ratón prestado. Cada declaración va suelta: si una no se puede hacer
   en esta versión de koffi, las demás siguen sirviendo. */
let GetAsyncKeyState = null;
let GetForegroundWindow = null;
let WindowFromPoint = null;
const fallos = [];

function declarar(nombre, ret, args) {
  try {
    return user32.func('__stdcall', nombre, ret, args);
  } catch (err) {
    fallos.push(`${nombre}: ${err.message}`);
    return null;
  }
}

GetAsyncKeyState = declarar('GetAsyncKeyState', 'int16_t', ['int']);
if (!GetAsyncKeyState) GetAsyncKeyState = declarar('GetAsyncKeyState', 'short', ['int']);
GetForegroundWindow = declarar('GetForegroundWindow', HWND, []);
// WindowFromPoint devuelve la ventana hija más profunda (p. ej. el lienzo de
// Chromium dentro de la nuestra); con esto subimos hasta su ventana raíz.
const GetAncestor = declarar('GetAncestor', HWND, [HWND, 'uint']);
const GA_PARENT = 1;

// Estructuras de Windows. 'int32_t' y no 'long' para no depender del sistema.
let POINT = null;
let RECT = null;
let MONITORINFO = null;
try {
  POINT = koffi.struct('POINT', { x: 'int32_t', y: 'int32_t' });
  RECT = koffi.struct('RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
  MONITORINFO = koffi.struct('MONITORINFO', {
    cbSize: 'uint32_t', rcMonitor: RECT, rcWork: RECT, dwFlags: 'uint32_t',
  });
} catch (err) {
  fallos.push(`estructuras: ${err.message}`);
}

// WindowFromPoint recibe un POINT por valor; si el struct no se puede definir,
// nos apañamos con la ventana en primer plano.
if (POINT) WindowFromPoint = declarar('WindowFromPoint', HWND, [POINT]);

/* Medidas del monitor en píxeles FÍSICOS, preguntadas a Windows. Electron da
   las medidas en píxeles lógicos y hay que multiplicar por la escala; con
   escalado (125 %, 150 %…, lo normal por encima de 1080p) esa cuenta fallaba y
   el fondo salía en una esquina. Aquí no hay ninguna cuenta que hacer. */
const MonitorFromPoint = POINT ? declarar('MonitorFromPoint', 'uintptr_t', [POINT, 'uint32_t']) : null;
const GetMonitorInfoW = MONITORINFO
  ? declarar('GetMonitorInfoW', 'bool', ['uintptr_t', koffi.inout(koffi.pointer(MONITORINFO))]) : null;
const MapWindowPoints = RECT
  ? declarar('MapWindowPoints', 'int', [HWND, HWND, koffi.inout(koffi.pointer(RECT)), 'uint32_t']) : null;
const MONITOR_DEFAULTTOPRIMARY = 1;

if (fallos.length) console.warn('[estanteria] Raton prestado, funciones no disponibles:', fallos.join(' | '));

// GetWindowLongPtrW solo existe en 64 bits; en 32 se llama GetWindowLongW.
let GetExStyle;
let SetExStyle;
try {
  GetExStyle = user32.func('__stdcall', 'GetWindowLongPtrW', 'intptr_t', [HWND, 'int']);
  SetExStyle = user32.func('__stdcall', 'SetWindowLongPtrW', 'intptr_t', [HWND, 'int', 'intptr_t']);
} catch (_) {
  GetExStyle = user32.func('__stdcall', 'GetWindowLongW', 'long', [HWND, 'int']);
  SetExStyle = user32.func('__stdcall', 'SetWindowLongW', 'long', [HWND, 'int', 'long']);
}

const GWL_EXSTYLE = -20;
const WS_EX_NOACTIVATE = 0x08000000;
const WS_EX_APPWINDOW = 0x00040000;

const HWND_TOP = 0;
const HWND_BOTTOM = 1;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const SWP_SHOWWINDOW = 0x0040;

const SW_HIDE = 0;
const SW_SHOWNOACTIVATE = 4;
const SW_SHOW = 5;

const VK = { izq: 0x01, der: 0x02 };

/** El buffer que devuelve Electron contiene el HWND en crudo. */
function hwndDe(win) {
  const buf = win.getNativeWindowHandle();
  return buf.length === 8 ? Number(buf.readBigUInt64LE()) : buf.readUInt32LE();
}

/** Todas las WorkerW de primer nivel que existan ahora mismo. */
function listaWorkerW() {
  const lista = [];
  let w = 0;
  while ((w = FindWindowExW(0, w, 'WorkerW', null))) lista.push(w);
  return lista;
}

/**
 * Pide a Progman la capa extra y devuelve la WorkerW donde va el fondo.
 *
 * La estructura cambia entre versiones de Windows, y esa fue la razón de que
 * no funcionara en Windows 11:
 *
 *   Windows 10  Progman -> WorkerW(A) -> SHELLDLL_DefView (iconos)
 *                          WorkerW(B)  <- la buena, hermana siguiente de A
 *
 *   Windows 11  Progman -> SHELLDLL_DefView (iconos)
 *                          WorkerW      <- la buena: la que NO tiene iconos
 *
 * Se prueban los dos casos, y también las tres variantes del mensaje 0x052C,
 * porque no todas las compilaciones responden a la misma.
 */
function buscarWorkerW(progman) {
  const antes = listaWorkerW().length;

  for (const [wp, lp] of [[0, 0], [0x0000000d, 0x00000001], [0x0000000d, 0x00000000]]) {
    SendMessageTimeoutW(progman, 0x052c, wp, lp, 0 /* SMTO_NORMAL */, 1000, null);
    if (listaWorkerW().length > antes) break;
  }

  const ws = listaWorkerW();

  // Caso Windows 10: la hermana siguiente a la que contiene los iconos.
  for (const w of ws) {
    if (FindWindowExW(w, 0, 'SHELLDLL_DefView', null)) {
      const siguiente = FindWindowExW(0, w, 'WorkerW', null);
      if (siguiente) return siguiente;
    }
  }

  // Caso Windows 11: los iconos cuelgan de Progman, así que vale cualquier
  // WorkerW que no los lleve dentro.
  for (const w of ws) {
    if (!FindWindowExW(w, 0, 'SHELLDLL_DefView', null)) return w;
  }

  return 0;
}

/** La ventana con los iconos, que cuelga de Progman o de una WorkerW. */
function buscarIconos() {
  const progman = FindWindowW('Progman', null);
  const directo = progman && FindWindowExW(progman, 0, 'SHELLDLL_DefView', null);
  if (directo) return directo;

  let w = 0;
  while ((w = FindWindowExW(0, w, 'WorkerW', null))) {
    const d = FindWindowExW(w, 0, 'SHELLDLL_DefView', null);
    if (d) return d;
  }
  return 0;
}

/** Que la ventana no robe el foco al pulsarla, pero siga recibiendo el ratón. */
function noActivar(win, si) {
  const hwnd = hwndDe(win);
  let estilo = Number(GetExStyle(hwnd, GWL_EXSTYLE));
  estilo = si
    ? (estilo | WS_EX_NOACTIVATE) & ~WS_EX_APPWINDOW
    : estilo & ~WS_EX_NOACTIVATE;
  SetExStyle(hwnd, GWL_EXSTYLE, estilo);
}

/** Rectángulo del monitor principal en píxeles físicos de pantalla. */
function monitorPrincipal() {
  if (!MonitorFromPoint || !GetMonitorInfoW) return null;
  try {
    // El principal es, por definición, el que contiene el punto (0, 0).
    const hmon = MonitorFromPoint({ x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
    if (!hmon) return null;
    const info = {
      cbSize: koffi.sizeof(MONITORINFO),
      rcMonitor: { left: 0, top: 0, right: 0, bottom: 0 },
      rcWork: { left: 0, top: 0, right: 0, bottom: 0 },
      dwFlags: 0,
    };
    if (!GetMonitorInfoW(hmon, info)) return null;
    return { ...info.rcMonitor };
  } catch (_) {
    return null;
  }
}

/**
 * Dónde cae el monitor principal dentro de la ventana padre (la WorkerW o
 * Progman), que cubre todas las pantallas y tiene su propio origen.
 */
function cajaEnPadre(padre) {
  const r = monitorPrincipal();
  if (!r || !MapWindowPoints) return null;
  try {
    const rel = { ...r };
    MapWindowPoints(0, padre, rel, 2);   // un RECT son dos POINT seguidos
    const w = rel.right - rel.left;
    const h = rel.bottom - rel.top;
    return w > 0 && h > 0 ? { x: rel.left, y: rel.top, w, h } : null;
  } catch (_) {
    return null;
  }
}

// Último anclaje, para poder recolocar la ventana sin volver a buscar nada.
let ultimo = null;

/**
 * @param {BrowserWindow} win
 * @param {'encima'|'detras'} capa
 * @param {{x:number,y:number,w:number,h:number}} respaldo  en píxeles físicos,
 *        calculado por Electron; solo se usa si Windows no contesta
 */
function anclar(win, capa, respaldo) {
  const hwnd = hwndDe(win);
  const progman = FindWindowW('Progman', null);
  if (!progman) throw new Error('No se encontró la ventana Progman del escritorio');

  const workerw = buscarWorkerW(progman);

  // Si no hay WorkerW, colgarse de Progman y quedarse abajo del todo deja la
  // ventana igualmente por debajo de los iconos: sirve como plan B.
  const destino = capa === 'detras' ? (workerw || progman) : progman;
  SetParent(hwnd, destino);
  noActivar(win, true);
  EnableWindow(hwnd, true);   // sin esto no llegaría ni un clic

  // Ya somos ventana hija: las coordenadas pasan a ser relativas al padre.
  const caja = cajaEnPadre(destino) || respaldo;
  ultimo = { destino, capa, caja };
  SetWindowPos(
    hwnd,
    capa === 'detras' ? HWND_BOTTOM : HWND_TOP,
    caja.x, caja.y, caja.w, caja.h,
    SWP_NOACTIVATE | SWP_SHOWWINDOW,
  );
  ShowWindow(hwnd, SW_SHOWNOACTIVATE);
  return caja;
}

/**
 * Vuelve a darle el tamaño del monitor. Con `encoger` la deja un píxel más
 * baja: se usa para obligar a Chromium a redibujar (y a enterarse del tamaño
 * nuevo), y enseguida se llama otra vez sin él.
 */
function ajustar(win, encoger = false) {
  if (!ultimo) return false;
  const caja = cajaEnPadre(ultimo.destino) || ultimo.caja;
  ultimo.caja = caja;
  SetWindowPos(
    hwndDe(win),
    ultimo.capa === 'detras' ? HWND_BOTTOM : HWND_TOP,
    caja.x, caja.y, caja.w, caja.h - (encoger ? 1 : 0),
    SWP_NOACTIVATE,
  );
  return true;
}

/** Devuelve la ventana al escritorio normal para poder editarla. */
function soltar(win) {
  ultimo = null;
  const hwnd = hwndDe(win);
  SetParent(hwnd, 0);
  noActivar(win, false);
  SetWindowPos(hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
  return true;
}

/**
 * Deja la ventana al fondo del orden, pero por encima del escritorio: primero
 * la mandamos abajo del todo y luego colocamos Progman por detrás de ella. Es
 * lo que usa la capa 'suelta', que no emparenta con nada.
 */
function bajarAlFondo(win) {
  const hwnd = hwndDe(win);
  const mover = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
  SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, mover);
  const progman = FindWindowW('Progman', null);
  if (progman) SetWindowPos(progman, hwnd, 0, 0, 0, 0, mover);
  return true;
}

/** Vuelve a colocarla en su sitio dentro del escritorio (por si el shell la tapó). */
function reponer(win, capa) {
  const hwnd = hwndDe(win);
  SetWindowPos(
    hwnd,
    capa === 'detras' ? HWND_BOTTOM : HWND_TOP,
    0, 0, 0, 0,
    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
  );
}

/**
 * Los iconos del escritorio viven en una ventana del tamaño de la pantalla que
 * es casi toda transparente. Ocultarla evita que se quede con los clics, y
 * además es lo que se busca: las botellas sustituyen a los iconos.
 */
function iconosVisibles(mostrar) {
  const iconos = buscarIconos();
  if (!iconos) return false;
  ShowWindow(iconos, mostrar ? SW_SHOW : SW_HIDE);
  return true;
}

/* --- Ratón prestado ---------------------------------------------------
   Una ventana que hace de fondo de pantalla no recibe ratón. Preguntar por el
   estado de los botones es una consulta suelta al sistema: no instala ningún
   hook ni pide permisos. */

const hayRaton = () => Boolean(GetAsyncKeyState && (WindowFromPoint || GetForegroundWindow));

function pulsado(boton) {
  if (!GetAsyncKeyState) return false;
  return (GetAsyncKeyState(VK[boton] || 0) & 0x8000) !== 0;
}

/** ¿Es esta ventana parte del escritorio (o la nuestra, que cuelga de él)? */
function esDelEscritorio(hwnd, nuestro) {
  if (!hwnd) return true;                       // nada bajo el cursor: escritorio

  // Con los iconos ocultos, bajo el cursor queda una ventana hija de la
  // nuestra: se sube por los padres hasta dar con la nuestra o el escritorio.
  if (GetAncestor) {
    let w = hwnd;
    for (let i = 0; w && i < 8; i++) {
      if (nuestro && w === nuestro) return true;
      w = GetAncestor(w, GA_PARENT);
    }
  }
  if (nuestro && hwnd === nuestro) return true;
  if (hwnd === FindWindowW('Progman', null)) return true;
  if (hwnd === buscarIconos()) return true;

  let w = 0;
  while ((w = FindWindowExW(0, w, 'WorkerW', null))) {
    if (hwnd === w) return true;
  }
  // Los iconos son una lista dentro de SHELLDLL_DefView.
  const iconos = buscarIconos();
  if (iconos && hwnd === FindWindowExW(iconos, 0, 'SysListView32', null)) return true;
  return false;
}

/**
 * ¿El cursor está sobre el escritorio y no sobre otro programa?
 *
 * Lo fiable es mirar qué ventana hay justo bajo el cursor: si es el escritorio
 * (o la nuestra), el clic es para nosotros. Si `WindowFromPoint` no estuviera
 * disponible, nos conformamos con la ventana en primer plano, que acierta casi
 * siempre pero falla si tienes otra app abierta a pantalla completa detrás.
 */
function enElEscritorio(punto, win) {
  const nuestro = win ? hwndDe(win) : 0;

  if (WindowFromPoint && punto) {
    return esDelEscritorio(WindowFromPoint({ x: Math.round(punto.x), y: Math.round(punto.y) }), nuestro);
  }
  if (GetForegroundWindow) return esDelEscritorio(GetForegroundWindow(), nuestro);
  return false;
}

/** Qué encuentra en el escritorio, para el diagnóstico de la bandeja. */
function diagnosticoEscritorio() {
  const progman = FindWindowW('Progman', null);
  const ws = listaWorkerW();
  return {
    progman: Boolean(progman),
    workerw: ws.length,
    conIconos: ws.filter((w) => FindWindowExW(w, 0, 'SHELLDLL_DefView', null)).length,
    iconosEnProgman: Boolean(progman && FindWindowExW(progman, 0, 'SHELLDLL_DefView', null)),
    elegida: progman ? Boolean(buscarWorkerW(progman)) : false,
    monitor: monitorPrincipal(),
    caja: ultimo ? ultimo.caja : null,
  };
}

/** Resumen para el diagnóstico de la bandeja. */
function estadoRaton() {
  return {
    botones: Boolean(GetAsyncKeyState),
    bajoCursor: Boolean(WindowFromPoint),
    primerPlano: Boolean(GetForegroundWindow),
    fallos,
  };
}

// Sirve para detectar un archivo desactualizado tras una actualización a medias.
const VERSION = 6;

module.exports = {
  VERSION,
  anclar,
  ajustar,
  soltar,
  reponer,
  noActivar,
  iconosVisibles,
  bajarAlFondo,
  pulsado,
  enElEscritorio,
  hayRaton,
  estadoRaton,
  diagnosticoEscritorio,
};
