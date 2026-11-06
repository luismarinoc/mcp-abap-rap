# mcp-abap-rap

Fork de [mario-andreschak/mcp-abap-abap-adt-api](https://github.com/mario-andreschak/mcp-abap-abap-adt-api)
con las tools que faltaban para trabajar RAP de punta a punta.

## Por qué existe

El paquete original apoya su `createObject` en la lista blanca de tipos creables de
`abap-adt-api`. Esa lista nunca incluyó `BDEF/BDO`, y `SRVB/SVB` y `DEVC/K` estaban
incompletos. En la práctica el MCP podía crear tablas y CDS, pero no una Behavior
Definition, ni un Service Binding, ni un paquete — justo los tres objetos que un
servicio RAP necesita.

Las tools nuevas **no parchean la librería**: construyen el XML y llaman a
`adtclient.httpClient` directamente. Por eso sobreviven a cualquier `npm install`.

## Tools añadidas

| Tool | Para qué |
|---|---|
| `adtRequest` | Llamada ADT en crudo sobre la sesión autenticada. Quita el techo de la lista blanca. |
| `objectPathFor` | Resuelve la URL de un objeto desde nombre y tipo, incluidos los includes de clase. |
| `createObjectSafe` | Crea con validación por tipo y verificación posterior en TADIR. |
| `setSourceByName` | Escribe fuente resolviendo la URL, con lock y unlock incluidos. |
| `createAndActivate` | create → source → activate en una llamada. |
| `checkObjectRegistered` | Detecta objetos huérfanos sin entrada en TADIR. |

## Hallazgos que motivaron cada cambio

**1. Éxito reportado sobre objetos rotos.**
Crear una `BDEF/BDO` sin `implementationType` devuelve HTTP 200, pero SAP no escribe
la entrada en TADIR. El objeto queda huérfano: no se puede grabar ni borrar, ni desde
ADT ni desde Eclipse, y el nombre queda quemado. Se repara con `TR_TADIR_INTERFACE`.
→ `createObjectSafe` verifica con `findObjectPath` y falla en vez de mentir.

**2. XML de la Behavior Definition.**
El elemento raíz es `blue:blueSource`, con namespace `http://www.sap.com/wbobj/blue`
— no `adt/blue`. Requiere `blue:implementationType` y `<blue:rootEntity>`.
Se descubrió probando candidatos contra el sistema; el mensaje de SAP
(*"Elemento {...}blueSource previsto"*) es el que lo revela.

**3. URLs de includes de clase.**
El código de la clase va en `/source/main`, pero sus local types en
`includes/implementations` **sin** `/source/main`. Usar la primera forma da 404.

**4. Service Binding OData V4.**
`createBodyBinding` de la librería tiene `srvb:category="0"` y `srvb:version="V2"`
hardcodeados. Sin parametrizar eso, un binding V4 es imposible.

**5. Paquetes.**
`createBodyPackage` de la librería trae un `<adtcore:packageRef adtcore:name="YMU_RAP"/>`
hardcodeado del sistema del autor. Además un paquete de primer nivel no puede ser de
desarrollo: SAP solo permite estructura o principal. Para que admita objetos hay que
darle paquete superior y tipo vacío.

**6. Órdenes de transporte.**
Si el sistema no tiene rutas configuradas, SAP exige una orden **local** y rechaza las
transportables con *"la orden X no es una orden local"*. `transportInfo` sobre el objeto
destino dice de antemano qué órdenes acepta — conviene consultarlo antes de crear.

**7. Bloqueos.**
`activate` falla con *"el usuario ya está tratando el objeto"* si queda un lock abierto.
Tras un error, el lock handle queda inválido en silencio.
→ `setSourceByName` libera siempre en `finally`.

## Mejoras implementadas en fuente

- `classIncludes` consulta la estructura de la clase antes de extraer sus inclusiones; sin ellas devuelve `{}`.
- `packageSearchHelp` usa la ayuda del SDK y valida los cuatro tipos admitidos antes de consultar SAP. Un endpoint válido aún puede devolver 404 según el sistema; no se ha comprobado en SAP real.
- `objectTypes` admite `filter` opcional (subcadena sin distinguir mayúsculas en tipo, nombre o descripción).
- `searchObject` admite `offset` (por defecto 0) y `pageSize` (por defecto 100) para recortar localmente un prefijo de hasta 10000 resultados; no añade timeout configurable, total exacto ni instantánea estable.
- `createFullRapService` usa el RAP Generator existente: valida y previsualiza antes de generar una vez; `dryRun` solo previsualiza. La cantidad de objetos depende del generador; no publica ni revierte cambios.

Ver [inclusiones y ayudas](docs/class-package-tools.md), [descubrimiento](docs/object-discovery-tools.md) y [generador RAP](docs/rap-generator-tool.md). Estas mejoras están en fuente: requieren compilación y reinicio intencionales del servidor MCP para estar activas; no se ha probado la generación contra SAP real.

## Uso

```bash
npm install && npm run build
```

En `claude_desktop_config.json`:

```json
"sap-adt": {
  "command": "node",
  "args": ["/Users/luismarinoc/projects/mcp-abap-rap/dist/index.js"],
  "env": {
    "SAP_URL": "https://…:44300",
    "SAP_CLIENT": "100",
    "SAP_USER": "…",
    "SAP_PASSWORD": "…",
    "SAP_LANGUAGE": "ES"
  }
}
```

`SAP_LANGUAGE` importa: sin ella los objetos se crean con idioma original `EN`.
