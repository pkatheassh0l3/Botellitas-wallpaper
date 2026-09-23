'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('estanteria', {
  cargar: () => ipcRenderer.invoke('estanteria:cargar'),
  guardar: (estado) => ipcRenderer.invoke('estanteria:guardar', estado),
  cambiarModo: (modo) => ipcRenderer.invoke('estanteria:modo', modo),
  abrirCarpeta: () => ipcRenderer.invoke('estanteria:abrir-carpeta'),
  salir: () => ipcRenderer.invoke('estanteria:salir'),

  elegirCarpeta: () => ipcRenderer.invoke('estanteria:elegir-carpeta'),
  importarImagenes: () => ipcRenderer.invoke('estanteria:importar-imagenes'),
  guardarImagen: (nombre, datos) => ipcRenderer.invoke('estanteria:guardar-imagen', nombre, datos),
  abrirRuta: (ruta) => ipcRenderer.invoke('estanteria:abrir-ruta', ruta),
  carpetas: () => ipcRenderer.invoke('estanteria:carpetas'),
  imagen: (ruta) => ipcRenderer.invoke('estanteria:imagen', ruta),
  crearCarpeta: (nombre) => ipcRenderer.invoke('estanteria:crear-carpeta', nombre),
  renombrarCarpeta: (ruta, nombre) => ipcRenderer.invoke('estanteria:renombrar-carpeta', ruta, nombre),
  tirarCarpeta: (ruta) => ipcRenderer.invoke('estanteria:tirar-carpeta', ruta),
  crearAcceso: () => ipcRenderer.invoke('estanteria:crear-acceso'),
  crearDocumento: () => ipcRenderer.invoke('estanteria:crear-documento'),

  copiar: (rutas, modo) => ipcRenderer.invoke('estanteria:copiar', rutas, modo),
  hayQuePegar: () => ipcRenderer.invoke('estanteria:hay-que-pegar'),
  pegar: () => ipcRenderer.invoke('estanteria:pegar'),
  sistema: (que) => ipcRenderer.invoke('estanteria:sistema', que),
  menuNativo: (opciones, punto) => ipcRenderer.invoke('estanteria:menu-nativo', opciones, punto),

  papeleraEstado: () => ipcRenderer.invoke('estanteria:papelera-estado'),
  abrirPapelera: () => ipcRenderer.invoke('estanteria:papelera-abrir'),
  vaciarPapelera: () => ipcRenderer.invoke('estanteria:papelera-vaciar'),

  alCambiarModo: (cb) => ipcRenderer.on('estanteria:modo', (_e, modo) => cb(modo)),
  alRecargar: (cb) => ipcRenderer.on('estanteria:recargar', () => cb()),
  alNueva: (cb) => ipcRenderer.on('estanteria:nueva', () => cb()),
  alMoverCursor: (cb) => ipcRenderer.on('estanteria:cursor', (_e, p) => cb(p)),
  alCambiarEscena: (cb) => ipcRenderer.on('estanteria:escena', (_e, id) => cb(id)),
  alCambiarCarpetas: (cb) => ipcRenderer.on('estanteria:carpetas', (_e, l) => cb(l)),
  alCambiarPapelera: (cb) => ipcRenderer.on('estanteria:papelera', (_e, llena) => cb(llena)),
  alHacerClic: (cb) => ipcRenderer.on('estanteria:clic', (_e, c) => cb(c)),
  alElegirMenu: (cb) => ipcRenderer.on('estanteria:menu-elegido', (_e, id) => cb(id)),

  avisarEscenas: (datos) => ipcRenderer.send('estanteria:escenas', datos),
});
