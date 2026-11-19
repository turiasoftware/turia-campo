# Turia Campo

## Instalar en el iPhone

1. Descomprime el paquete. Publica la carpeta que contiene `index.html` en un alojamiento estático con HTTPS. En Netlify se puede arrastrar esa carpeta al despliegue manual. En GitHub Pages, coloca su contenido en la carpeta publicada del repositorio. Todas las rutas del proyecto son relativas.
2. Abre la dirección HTTPS en Safari. En Compartir, elige **Añadir a la pantalla de inicio** y, si aparece, activa **Abrir como app web**.
3. Abre Turia Campo desde ese icono, con conexión la primera vez. El mapa solicita al IGN las imágenes del encuadre visible. La primera apertura prepara el arranque de la aplicación sin cobertura. Usa esa misma instalación durante la campaña.
4. Pulsa **Activar GPS** y permite la ubicación precisa. Para registrar orientación, pulsa **Herramientas → Habilitar brújula del iPhone**. Si el dispositivo no facilita un rumbo válido y reciente, el campo queda vacío.

## Proyectos y recorridos

Pulsa el nombre bajo **Turia Campo** para crear, renombrar o cambiar de recorrido. La selección filtra el mapa, el inventario y el ZIP. Los puntos de versiones anteriores aparecen en **General**. Cada equipo guarda su propia lista de recorridos. Para trabajar a la vez con dos móviles, escribe el mismo nombre en ambos y exporta un ZIP por móvil. Puedes combinar las capas en QGIS conservando el campo `id_punto` como identificador único. Los códigos de campo pueden repetirse entre dispositivos.

## Tomar un punto

Para registrar una serie sin cámara, desactiva **Herramientas → Tomar foto al fijar punto**. Elige el tipo y pulsa **Fijar punto** sobre cada elemento. Cada toque con una posición válida guarda un punto en el recorrido activo y muestra su código. Puedes alternar ambos modos durante la salida.

Con foto, puedes elegir **Sugerir tipo por foto** antes de guardar. La sugerencia compara color, textura y bordes con hasta seis fotos recientes por tipo ya clasificadas en este dispositivo. Necesita al menos dos fotos de cada uno de dos tipos distintos. Funciona sin cobertura. Si hay una coincidencia clara, puedes aceptarla o elegir otro tipo. La función de una tapa cerrada suele requerir identificación en campo.

### Captura con cámara

Selecciona el tipo y pulsa **Fijar punto + foto**. El gesto fija la posición, la fecha, la precisión y el último rumbo válido, reserva el código de su serie y abre el selector de cámara trasera. Haz la foto, añade notas y pulsa **Guardar punto y foto**. El mapa y el inventario permiten abrir la ficha y guiarse hacia ella. La guía expresa el ángulo en sentido horario desde el norte de cuadrícula UTM. El rumbo guardado en el punto procede de la brújula del dispositivo.

**Herramientas → Promediar posición (15 s)** hace una media ponderada por el inverso del cuadrado de la precisión declarada. Descarta lecturas de más de 25 m y marcas temporales duplicadas.

Para una trampilla, activa Ubicación precisa en el iPhone, sitúalo sobre la vertical del elemento y selecciona **Herramientas → Toma precisa · 30 s**. Mantén el móvil quieto. La interfaz muestra lecturas válidas y dispersión. La toma exige seis lecturas distintas de ±8 m o mejores a lo largo de al menos 20 s, filtra saltos respecto a la mediana y descarta una dispersión superior a 3 m o un desplazamiento entre el comienzo y el final superior a 4 m. Al terminar, pulsa **Fijar punto + foto** mientras aparece la posición promediada. Caduca a los 20 s desde la última muestra usada. Si la toma falla o caduca, repítela o elige **Usar GPS directo**. Se guardan método, número de lecturas, radio GPS típico, descartes y dispersión. La dispersión describe la repetibilidad de la toma. Un sesgo común del teléfono puede desplazar todas las lecturas.

Punto y foto se escriben juntos en IndexedDB. Una captura interrumpida puede dejar un salto de numeración. Los datos pertenecen al sitio y al dispositivo. Exporta la campaña antes de cambiar de dominio, borrar los datos de Safari o retirar la instalación.

Para corregir una toma, abre su ficha desde el marcador o desde **Inventario**, pulsa **Borrar punto** y confirma el código. El punto y su foto se eliminan juntos. Al repetir la toma se asigna un código nuevo. Los ZIP exportados antes del borrado conservan la copia de aquel momento.

## Mapas y medición

El encuadre inicial está en el casco urbano de Perales del Alfambra (40,634155° N, 1,0015568° O), con la ortofoto PNOA visible. En **Capas del mapa** puedes volver a Perales o pulsar **Ver a máxima resolución**. Al activar el GPS, el mapa sigue la posición. Arrastrar el mapa suspende el seguimiento y el botón de localización lo recupera. Catastro y recintos SIGPAC se muestran desde zoom 15. La opacidad inicial de Catastro es del 30 %.

**Consultar centro** usa la cruz central. Las fichas también ofrecen consultas en su punto. Las peticiones de información emplean EPSG:25830 y se abren directamente en el servicio oficial, de modo que la lectura no depende de permisos CORS. Los fondos WMTS y las imágenes WMS se dibujan en la cuadrícula web del mapa.

**Medir** permite elegir una línea o un polígono. Toca el mapa para añadir vértices y **Detalle** para ver cada tramo. Los polígonos cierran automáticamente al tercer vértice. La superficie se expresa en m² y ha. Las medidas son planas en ETRS89 / UTM 30N en toda la península.

## Llevar los datos al estudio

En **Inventario** o **Herramientas**, pulsa **Exportar ZIP** para descargar el recorrido activo. El ZIP identifica el proyecto por nombre y cada punto por un UUID. Un registro sin foto lleva el campo `archivo_foto` vacío.

Los puntos, las notas y las fotos se conservan en IndexedDB en el dispositivo donde los tomaste. Cerrar la app o reiniciar el móvil no borra el inventario. La app no establece caducidad. Safari gestiona el espacio y puede desalojar datos locales. Exporta cada recorrido a Archivos, iCloud Drive o tu carpeta de trabajo al terminar. Cambiar de dispositivo o de dominio da acceso a otro almacenamiento. No hay sincronización entre teléfonos. El enlace de descarga permanece disponible en el panel si Safari requiere otro toque. En Archivos puedes descomprimirlo.

- `puntos_utm30.geojson` lleva geometrías WGS84 en orden longitud, latitud y atributos X_UTM30 e Y_UTM30 en metros.
- `puntos_utm30.csv` utiliza UTF-8 con BOM, separador de campos de punto y coma y coma decimal. En QGIS, selecciona X_UTM30 e Y_UTM30, activa **El separador decimal es la coma** y asigna EPSG:25830. La fecha se guarda en formato ISO 8601 UTC.
- `FOTOS/` conserva los archivos originales. El campo archivo_foto es la ruta relativa exacta dentro del ZIP.

## Preparar una salida sin cobertura

Encuadra el camino o la zona en el mapa y abre **Capas del mapa** o **Herramientas → Zonas sin conexión → Guardar esta zona sin conexión**. El rectángulo corresponde al mapa visible al abrir la ficha. Puedes volver al mapa para ajustarlo. Elige un nombre y el detalle final (17, 18, 19 o 20). Revisa la superficie en km² y el consumo estimado antes de pulsar **Descargar ortofoto**. La estimación usa 15 kB por tesela. La cifra real se actualiza durante la descarga.

Mantén abierta la app hasta ver **Lista sin conexión**. Se pueden guardar varias zonas. Las descargas parciales se pueden pausar y reanudar. **Ver zona** selecciona el PNOA y encuadra la zona. **Retirar zona** libera sus imágenes. Las zonas y los puntos con sus fotos se guardan por separado. Si habías instalado la versión municipal de 417 MB, en este panel puedes liberar su antigua precarga. Con la misma dirección HTTPS y la misma instalación se conserva el inventario anterior.

Con conexión, la ortofoto se carga desde el servicio del IGN. Sin conexión, dentro de una zona descargada puedes ampliar hasta el nivel guardado y seguir inventariando con fotos. Los niveles superiores amplían la imagen guardada. Fuera de la zona puede quedar visible una vista general. Mapa Base IGN, Catastro, SIGPAC y las consultas oficiales utilizan internet.

## Archivos

`index.html`, `campo.css` y `campo.js` contienen la interfaz y la lógica. `manifest.json`, `sw.js` y los iconos PNG permiten instalar la PWA. La carpeta `vendor/` contiene Leaflet 1.9.4, Proj4js 2.12.1 y JSZip 3.10.1 con sus licencias, distribuidas desde jsDelivr. El HTML incluye sus URL de reserva con versión fijada. No hay compilación, claves de API ni backend.

La ortofoto PNOA Máxima Actualidad está cedida por © Instituto Geográfico Nacional de España. Se accede a las imágenes por los servicios WMTS/TMS del IGN. El límite de Perales procede del servicio de unidades administrativas del IGN. La aplicación se distribuye sin imágenes cartográficas incorporadas.

Al modificar los archivos para otro despliegue, incrementa la versión de CACHE en `sw.js`. Cierra todas las ventanas de la aplicación y vuelve a abrir para activar la actualización.
