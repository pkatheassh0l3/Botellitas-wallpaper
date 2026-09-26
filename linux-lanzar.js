'use strict';

/**
 * Abrir cosas en Linux, deprisa.
 *
 * Lo lento no era abrir: era CÓMO. Electron cambia el entorno del proceso al
 * arrancar (XDG_CURRENT_DESKTOP pasa a ser "Unity", GDK_BACKEND se fuerza a
 * x11, NO_AT_BRIDGE, CHROME_DESKTOP…) y todo lo que lanzábamos lo heredaba:
 *
 *   · xdg-open no reconocía tu escritorio y caía a su modo genérico, que va
 *     probando programas uno detrás de otro;
 *   · las apps GTK se abrían por XWayland en vez de Wayland, que tarda más en
 *     arrancar y en GNOME a veces sale detrás con un aviso de «está lista».
 *
 * Aquí se restaura el entorno original y se ejecuta directamente la orden
 * del lanzador (.desktop), sin pasar por xdg-open ni gio salvo como respaldo.
 * Qué programa abre las carpetas se averigua una vez y se recuerda.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

// --- Entorno limpio -------------------------------------------------------

let entorno = null;

/** El entorno de tu sesión, sin lo que añaden Electron y el AppImage. */
function entornoLimpio() {
  if (entorno) return entorno;
  const e = { ...process.env };

  if (e.ORIGINAL_XDG_CURRENT_DESKTOP) e.XDG_CURRENT_DESKTOP = e.ORIGINAL_XDG_CURRENT_DESKTOP;
  delete e.ORIGINAL_XDG_CURRENT_DESKTOP;

  // Electron fuerza X11 para sí mismo; tus apps deben usar lo que use la sesión.
  if (e.XDG_SESSION_TYPE === 'wayland' || e.WAYLAND_DISPLAY) delete e.GDK_BACKEND;
  for (const v of ['NO_AT_BRIDGE', 'CHROME_DESKTOP', 'GIO_LAUNCHED_DESKTOP_FILE',
    'GIO_LAUNCHED_DESKTOP_FILE_PID', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE',
    'GOOGLE_API_KEY', 'DESKTOP_STARTUP_ID', 'XDG_ACTIVATION_TOKEN']) delete e[v];

  // Lo que mete el AppImage: sus bibliotecas no deben colarse en otras apps.
  const dirApp = e.APPDIR;
  for (const v of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD']) delete e[v];
  if (dirApp) {
    for (const v of ['LD_LIBRARY_PATH', 'PATH', 'XDG_DATA_DIRS', 'GSETTINGS_SCHEMA_DIR', 'PYTHONPATH', 'PERLLIB', 'QT_PLUGIN_PATH']) {
      if (!e[v]) continue;
      const limpio = e[v].split(':').filter((p) => p && !p.startsWith(dirApp)).join(':');
      if (limpio) e[v] = limpio; else delete e[v];
    }
  }
  entorno = e;
  return e;
}

// --- Lanzadores .desktop ---------------------------------------------------

/** Carpetas donde el sistema guarda los lanzadores, por orden de preferencia. */
function dirsAplicaciones() {
  const e = entornoLimpio();
  const casa = e.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  const sistema = (e.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':');
  return [casa, ...sistema, '/var/lib/flatpak/exports/share',
    path.join(os.homedir(), '.local/share/flatpak/exports/share'), '/var/lib/snapd/desktop']
    .filter(Boolean)
    .map((d) => path.join(d, 'applications'));
}

/** Encuentra "org.gnome.Nautilus.desktop" en las carpetas del sistema. */
function buscarDesktop(id) {
  for (const d of dirsAplicaciones()) {
    const f = path.join(d, id);
    if (fs.existsSync(f)) return f;
    // Los id con guion pueden vivir en subcarpetas: kde-dolphin.desktop -> kde/dolphin.desktop
    const sub = path.join(d, id.replace(/-/g, '/'));
    if (sub !== f && fs.existsSync(sub)) return sub;
  }
  return null;
}

/** Lee la sección [Desktop Entry] de un .desktop. */
function leerDesktop(fichero) {
  const texto = fs.readFileSync(fichero, 'utf8');
  const datos = {};
  let dentro = false;
  for (const linea of texto.split(/\r?\n/)) {
    if (/^\s*\[/.test(linea)) { dentro = linea.trim() === '[Desktop Entry]'; continue; }
    if (!dentro || /^\s*#/.test(linea)) continue;
    const i = linea.indexOf('=');
    if (i > 0) datos[linea.slice(0, i).trim()] = linea.slice(i + 1).trim();
  }
  return datos;
}

/**
 * Parte la línea Exec en programa y argumentos según la especificación:
 * comillas dobles, escapes y códigos de campo (%f, %U…).
 */
function partirExec(exec, archivos, fichero, datos) {
  const trozos = [];
  let actual = '';
  let comillas = false;
  let hay = false;
  const s = exec.replace(/\\\\/g, '\\');   // el nivel de escape "de string" del .desktop
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (comillas) {
      if (c === '\\' && i + 1 < s.length && '"`$\\'.includes(s[i + 1])) { actual += s[++i]; continue; }
      if (c === '"') { comillas = false; continue; }
      actual += c;
    } else if (c === '"') { comillas = true; hay = true; }
    else if (/\s/.test(c)) { if (hay || actual) trozos.push(actual); actual = ''; hay = false; }
    else { actual += c; }
  }
  if (hay || actual) trozos.push(actual);

  const salida = [];
  for (const t of trozos) {
    if (t === '%f' || t === '%u') { if (archivos[0]) salida.push(archivos[0]); continue; }
    if (t === '%F' || t === '%U') { salida.push(...archivos); continue; }
    if (t === '%i') { if (datos.Icon) salida.push('--icon', datos.Icon); continue; }
    if (t === '%c') { salida.push(datos.Name || ''); continue; }
    if (t === '%k') { salida.push(fichero); continue; }
    salida.push(t.replace(/%[fFuUdDnNickvm]/g, '').replace(/%%/g, '%'));
  }
  return salida.filter((x, i) => i === 0 || x !== '');
}

/** ¿Existe este programa en el PATH (o como ruta)? */
function existePrograma(cmd) {
  if (!cmd) return false;
  if (cmd.includes('/')) return fs.existsSync(cmd);
  return (entornoLimpio().PATH || '').split(':').some((d) => d && fs.existsSync(path.join(d, cmd)));
}

/** Arranca un programa suelto: no espera por él ni muere si cierras la estantería. */
function soltarProceso(cmd, args, cwd) {
  return new Promise((res) => {
    let hijo;
    try {
      hijo = spawn(cmd, args, {
        cwd: cwd && fs.existsSync(cwd) ? cwd : os.homedir(),
        env: entornoLimpio(),
        detached: true,           // sesión propia (setsid)
        stdio: 'ignore',
      });
    } catch (_) { res(false); return; }
    hijo.once('error', () => res(false));
    hijo.once('spawn', () => { hijo.unref(); res(true); });
  });
}

/** Ejecuta un lanzador .desktop, opcionalmente con archivos. */
async function lanzarDesktop(fichero, archivos = []) {
  let datos;
  try { datos = leerDesktop(fichero); } catch (_) { return false; }

  if (datos.Type === 'Link' && datos.URL) return abrirConSistema(datos.URL);
  if (!datos.Exec) return false;
  if (datos.TryExec && !existePrograma(datos.TryExec)) return false;

  const partes = partirExec(datos.Exec, archivos, fichero, datos);
  if (!partes.length || !existePrograma(partes[0])) return false;

  // Programas de terminal: dentro del terminal que haya.
  if (/^true$/i.test(datos.Terminal || '')) {
    for (const t of [['x-terminal-emulator', '-e'], ['gnome-terminal', '--'], ['konsole', '-e'],
      ['xfce4-terminal', '-x'], ['kgx', '--'], ['xterm', '-e']]) {
      if (existePrograma(t[0])) return soltarProceso(t[0], [...t.slice(1), ...partes], datos.Path);
    }
    return false;
  }
  return soltarProceso(partes[0], partes.slice(1), datos.Path);
}

// --- Aplicación por defecto ----------------------------------------------

const porDefecto = new Map();   // tipo MIME -> ruta del .desktop (o null)

/** Qué .desktop abre este tipo de archivo (se pregunta una vez y se recuerda). */
function appPorDefecto(mime) {
  if (porDefecto.has(mime)) return Promise.resolve(porDefecto.get(mime));
  return new Promise((res) => {
    execFile('xdg-mime', ['query', 'default', mime], { env: entornoLimpio(), timeout: 4000 }, (err, salida) => {
      const id = !err && String(salida).trim().split(/\s+/)[0];
      const f = id ? buscarDesktop(id) : null;
      porDefecto.set(mime, f);
      res(f);
    });
  });
}

/** Tipo MIME de un archivo, por su extensión o preguntando al sistema. */
function tipoMime(ruta) {
  return new Promise((res) => {
    execFile('xdg-mime', ['query', 'filetype', ruta], { env: entornoLimpio(), timeout: 4000 },
      (err, salida) => res(err ? null : String(salida).trim().split(';')[0] || null));
  });
}

/** Respaldo: gio o xdg-open, pero con el entorno de tu sesión. */
async function abrirConSistema(objetivo) {
  if (existePrograma('gio') && await soltarProceso('gio', ['open', objetivo])) return true;
  return soltarProceso('xdg-open', [objetivo]);
}

/**
 * Abre lo que haya detrás de una botella: una carpeta con tu gestor de
 * archivos, un lanzador ejecutándolo, un archivo con su aplicación.
 */
async function abrir(ruta) {
  let real = ruta;
  try { real = fs.realpathSync(ruta); } catch (_) { /* enlace roto: que lo intente el sistema */ }

  if (ruta.toLowerCase().endsWith('.desktop')) {
    if (await lanzarDesktop(ruta)) return true;
    return abrirConSistema(ruta);
  }

  let esDir = false;
  try { esDir = fs.statSync(real).isDirectory(); } catch (_) { /* nada */ }

  const mime = esDir ? 'inode/directory' : await tipoMime(real);
  const app = mime ? await appPorDefecto(mime) : null;
  if (app && await lanzarDesktop(app, [real])) return true;
  return abrirConSistema(real);
}

/** Averigua ya el gestor de archivos, para que la primera carpeta no espere. */
function precalentar() {
  appPorDefecto('inode/directory').catch?.(() => {});
}

// --- Aplicaciones instaladas -----------------------------------------------

/** Nombre en el idioma del sistema: Name[es_ES], Name[es] o Name. */
function traducido(datos, clave, idioma) {
  const largo = (idioma || 'es').replace('-', '_');
  const corto = largo.split('_')[0];
  return datos[`${clave}[${largo}]`] || datos[`${clave}[${corto}]`] || datos[clave] || '';
}

/** ¿Se debe mostrar en este escritorio? (OnlyShowIn / NotShowIn) */
function visibleAqui(datos) {
  const actuales = String(entornoLimpio().XDG_CURRENT_DESKTOP || '').toLowerCase().split(':').filter(Boolean);
  const lista = (v) => String(v || '').toLowerCase().split(';').filter(Boolean);
  const solo = lista(datos.OnlyShowIn);
  if (solo.length && !solo.some((d) => actuales.includes(d))) return false;
  if (lista(datos.NotShowIn).some((d) => actuales.includes(d))) return false;
  return true;
}

let cacheApps = null;

/**
 * Las aplicaciones del menú del sistema (incluidas Flatpak y Snap): lo mismo
 * que ves en el lanzador de apps de tu escritorio. Si un id aparece en varias
 * carpetas, manda el primero (el del usuario pisa al del sistema, como en XDG).
 */
function listarApps(idioma, refrescar = false) {
  if (cacheApps && !refrescar) return cacheApps;
  const vistos = new Map();
  for (const base of dirsAplicaciones()) {
    const recorrer = (dir, prefijo) => {
      let entradas = [];
      try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const e of entradas) {
        if (e.isDirectory()) { recorrer(path.join(dir, e.name), `${prefijo}${e.name}-`); continue; }
        if (!e.name.endsWith('.desktop')) continue;
        const id = prefijo + e.name;
        if (vistos.has(id)) continue;
        const fichero = path.join(dir, e.name);
        let datos;
        try { datos = leerDesktop(fichero); } catch (_) { continue; }
        // Aunque esté oculta, se apunta: un id oculto del usuario tapa al del sistema.
        const valida = (datos.Type || 'Application') === 'Application' && datos.Exec
          && !/^true$/i.test(datos.NoDisplay || '') && !/^true$/i.test(datos.Hidden || '')
          && visibleAqui(datos) && (!datos.TryExec || existePrograma(datos.TryExec));
        vistos.set(id, valida ? {
          id,
          fichero,
          nombre: traducido(datos, 'Name', idioma) || id.replace(/\.desktop$/, ''),
          descripcion: traducido(datos, 'Comment', idioma) || traducido(datos, 'GenericName', idioma),
          categorias: String(datos.Categories || '').split(';').filter(Boolean),
          claves: traducido(datos, 'Keywords', idioma),
        } : null);
      }
    };
    recorrer(base, '');
  }
  cacheApps = [...vistos.values()].filter(Boolean).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return cacheApps;
}

module.exports = { abrir, listarApps, lanzarDesktop, soltarProceso, entornoLimpio, buscarDesktop, leerDesktop, dirsAplicaciones, precalentar };
