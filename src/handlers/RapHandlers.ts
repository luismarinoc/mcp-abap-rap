import { McpError, ErrorCode } from "../lib/errors.js";
import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";
import type { RapGeneratorContent, RapGeneratorId, RapGeneratorValidationResult, RapGeneratorPreviewObject } from 'abap-adt-api';

const esc = (s: any): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Rutas ADT por tipo de objeto. Evita adivinar entre /source/main e includes/. */
const PATHS: Record<string, { base: string; source?: string }> = {
  'CLAS/OC':  { base: '/sap/bc/adt/oo/classes/%s',            source: '/source/main' },
  'INTF/OI':  { base: '/sap/bc/adt/oo/interfaces/%s',         source: '/source/main' },
  'DDLS/DF':  { base: '/sap/bc/adt/ddic/ddl/sources/%s',      source: '/source/main' },
  'DDLX/EX':  { base: '/sap/bc/adt/ddic/ddlx/sources/%s',     source: '/source/main' },
  'SRVD/SRV': { base: '/sap/bc/adt/ddic/srvd/sources/%s',     source: '/source/main' },
  'BDEF/BDO': { base: '/sap/bc/adt/bo/behaviordefinitions/%s', source: '/source/main' },
  'TABL/DT':  { base: '/sap/bc/adt/ddic/tables/%s',           source: '/source/main' },
  'PROG/P':   { base: '/sap/bc/adt/programs/programs/%s',     source: '/source/main' },
  'SRVB/SVB': { base: '/sap/bc/adt/businessservices/bindings/%s' },
  'DEVC/K':   { base: '/sap/bc/adt/packages/%s' }
};

/** Includes de clase: la fuente NO lleva /source/main (causa 404). */
const CLASS_PARTS: Record<string, string> = {
  main: '/source/main',
  definitions: '/includes/definitions',
  implementations: '/includes/implementations',
  macros: '/includes/macros',
  testclasses: '/includes/testclasses'
};

/** Parametros obligatorios por tipo. Falla rapido, antes de tocar la red. */
const REQUIRED: Record<string, string[]> = {
  'BDEF/BDO': ['implementationType'],
  'SRVB/SVB': ['service', 'bindingtype'],
  'DEVC/K':   ['swcomp']
};

export class RapHandlers extends BaseHandler {

  getTools(): ToolDefinition[] {
    return [
      {
        name: 'adtRequest',
        description: 'Raw ADT call reusing the authenticated session. Use for anything the typed tools do not cover.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'ADT path, e.g. /sap/bc/adt/bo/behaviordefinitions' },
            method: { type: 'string', description: 'GET | POST | PUT | DELETE. Default GET', optional: true },
            body: { type: 'string', optional: true },
            contentType: { type: 'string', optional: true },
            accept: { type: 'string', optional: true },
            qs: { type: 'string', description: 'JSON object of query string params', optional: true }
          },
          required: ['url']
        }
      },
      {
        name: 'objectPathFor',
        description: 'Resolve the ADT URL of an object from its name and type, including class include parts.',
        inputSchema: {
          type: 'object',
          properties: {
            objtype: { type: 'string' },
            name: { type: 'string' },
            part: { type: 'string', description: 'Class only: main | definitions | implementations | macros | testclasses', optional: true }
          },
          required: ['objtype', 'name']
        }
      },
      {
        name: 'createObjectSafe',
        description: 'Create an ABAP object with per-type validation and post-creation verification. Supports BDEF, SRVB and DEVC natively. Fails instead of reporting success on a half-created object.',
        inputSchema: {
          type: 'object',
          properties: {
            objtype: { type: 'string' },
            name: { type: 'string' },
            parentName: { type: 'string', description: 'Package. For DEVC/K: the superpackage' },
            description: { type: 'string' },
            transport: { type: 'string', optional: true },
            responsible: { type: 'string', optional: true },
            implementationType: { type: 'string', description: 'BDEF: managed | unmanaged | abstract | projection | interface', optional: true },
            rootEntity: { type: 'string', description: 'BDEF: root CDS entity. Defaults to name', optional: true },
            service: { type: 'string', description: 'SRVB: service definition name', optional: true },
            bindingtype: { type: 'string', description: 'SRVB: ODATA', optional: true },
            category: { type: 'string', description: 'SRVB: 0 = Web API, 1 = UI. Default 0', optional: true },
            bindingVersion: { type: 'string', description: 'SRVB: V2 | V4. Default V4', optional: true },
            swcomp: { type: 'string', description: 'DEVC: software component, e.g. HOME', optional: true },
            packagetype: { type: 'string', description: 'DEVC: empty = development, S = structure, X = main', optional: true },
            transportLayer: { type: 'string', description: 'DEVC: e.g. ZDS4', optional: true }
          },
          required: ['objtype', 'name', 'parentName', 'description']
        }
      },
      {
        name: 'setSourceByName',
        description: 'Write source by object name and type. Resolves the URL, locks, writes and unlocks in one call. Reports unlock failures; a failed write remains the primary failure if cleanup also fails.',
        inputSchema: {
          type: 'object',
          properties: {
            objtype: { type: 'string' },
            name: { type: 'string' },
            source: { type: 'string' },
            part: { type: 'string', description: 'Class only: main | definitions | implementations | macros | testclasses', optional: true },
            transport: { type: 'string', optional: true }
          },
          required: ['objtype', 'name', 'source']
        }
      },
      {
        name: 'createAndActivate',
        description: 'Full pipeline: create, write source, activate. Replaces the create/lock/setSource/unLock/activate sequence. An unsuccessful activation returns isError with failure status and diagnostic messages; no mutation is retried.',
        inputSchema: {
          type: 'object',
          properties: {
            objtype: { type: 'string' },
            name: { type: 'string' },
            parentName: { type: 'string' },
            description: { type: 'string' },
            source: { type: 'string', optional: true },
            transport: { type: 'string', optional: true },
            language: { type: 'string', description: 'ADT object language, e.g. ES', optional: true },
            masterLanguage: { type: 'string', description: 'ADT master language, e.g. ES', optional: true },
            implementationType: { type: 'string', optional: true },
            rootEntity: { type: 'string', optional: true },
            service: { type: 'string', optional: true },
            bindingtype: { type: 'string', optional: true },
            category: { type: 'string', optional: true },
            bindingVersion: { type: 'string', optional: true },
            swcomp: { type: 'string', optional: true },
            packagetype: { type: 'string', optional: true },
            transportLayer: { type: 'string', optional: true },
            skipIfExists: { type: 'boolean', description: 'Do not fail if the object already exists; just write and activate', optional: true }
          },
          required: ['objtype', 'name', 'parentName', 'description']
        }
      },
      {
        name: 'createFullRapService',
        description: 'Validate and preview RAP Generator output before generating once. Preview is not proof of creation; dryRun only previews. Does not publish, retry or roll back.',
        inputSchema: {
          type: 'object',
          properties: {
            generatorId: { type: 'string', description: 'uiservice (default) | webapiservice', optional: true },
            refObjectUri: { type: 'string', description: 'Local /sap/bc/adt/... reference object URI' },
            packageName: { type: 'string', description: 'Destination package, e.g. ZPKG or $TMP' },
            content: { type: 'object', description: 'Optional SDK RapGeneratorContent; if omitted use validated server defaults', optional: true },
            transport: { type: 'string', description: 'Required nonblank for non-$TMP generation; $TMP sends empty corrNr', optional: true },
            dryRun: { type: 'boolean', description: 'Validate and preview only (default false)', optional: true }
          },
          required: ['refObjectUri', 'packageName']
        }
      },
      {
        name: 'checkObjectRegistered',
        description: 'Check whether an object has a TADIR entry (is registered in a package). Detects orphan objects.',
        inputSchema: {
          type: 'object',
          properties: {
            objtype: { type: 'string' },
            name: { type: 'string' }
          },
          required: ['objtype', 'name']
        }
      }
    ];
  }

  async handle(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'adtRequest':            return this.ok(await this.rawRequest(args));
      case 'objectPathFor':         return this.ok(this.resolve(args.objtype, args.name, args.part));
      case 'createObjectSafe':      return this.ok(await this.createSafe(args));
      case 'setSourceByName':       return this.ok(await this.setSource(args));
      case 'createAndActivate': {
        const result = await this.createAndActivate(args);
        return this.ok(result, !result.activated);
      }
      case 'createFullRapService': {
        const result = await this.createFullRapService(args);
        return this.ok(result.payload, result.failed);
      }
      case 'checkObjectRegistered': return this.ok(await this.checkRegistered(args.objtype, args.name));
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown RAP tool: ${toolName}`);
    }
  }

  private ok(payload: any, isError = false) {
    return {
      ...(isError ? { isError: true } : {}),
      content: [{ type: 'text', text: JSON.stringify({ status: isError ? 'failure' : 'success', ...payload }) }]
    };
  }

  private fail(msg: string): never {
    throw new McpError(ErrorCode.InternalError, msg);
  }

  private get http(): any {
    return (this.adtclient as any).httpClient;
  }

  private resolve(objtype: string, name: string, part?: string) {
    const def = PATHS[objtype];
    if (!def) this.fail(`Unknown object type "${objtype}". Known: ${Object.keys(PATHS).join(', ')}`);
    const objectUrl = def.base.replace('%s', encodeURIComponent(name.toLowerCase()));
    let sourceUrl: string | undefined;
    if (objtype === 'CLAS/OC') {
      const suffix = CLASS_PARTS[part || 'main'];
      if (!suffix) this.fail(`Unknown class part "${part}". Use: ${Object.keys(CLASS_PARTS).join(', ')}`);
      sourceUrl = objectUrl + suffix;
    } else if (def.source) {
      sourceUrl = objectUrl + def.source;
    }
    return { objectUrl, sourceUrl, hasSource: !!sourceUrl };
  }

  private async rawRequest(args: any) {
    const method = (args.method || 'GET').toUpperCase();
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) this.fail('method must be GET, POST, PUT or DELETE');
    const cfg: any = { method, headers: {} };
    if (args.body !== undefined) cfg.body = args.body;
    if (args.contentType) cfg.headers['Content-Type'] = args.contentType;
    if (args.accept) cfg.headers['Accept'] = args.accept;
    if (args.qs) {
      try { cfg.qs = JSON.parse(args.qs); } catch { this.fail('qs must be a JSON object'); }
      if (!cfg.qs || Array.isArray(cfg.qs) || typeof cfg.qs !== 'object') this.fail('qs must be a JSON object');
    }
    const res = await this.http.request(args.url, cfg);
    return { httpStatus: res?.status, body: typeof res?.body === 'string' ? res.body.slice(0, 200000) : res?.body };
  }

  private xmlFor(a: any): string {
    const lang = a.language || this.adtclient.language || 'EN';
    const resp = (a.responsible || (this.adtclient as any).username || '').toUpperCase();
    const head = `adtcore:description="${esc(a.description)}" adtcore:name="${esc(a.name)}" ` +
      `adtcore:type="${a.objtype}" adtcore:language="${lang}" adtcore:masterLanguage="${lang}" ` +
      `adtcore:responsible="${esc(resp)}"`;

    if (a.objtype === 'BDEF/BDO') {
      return `<?xml version="1.0" encoding="UTF-8"?>
<blue:blueSource xmlns:blue="http://www.sap.com/wbobj/blue" xmlns:adtcore="http://www.sap.com/adt/core"
 ${head} blue:implementationType="${esc(a.implementationType)}">
<adtcore:packageRef adtcore:name="${esc(a.parentName)}"/>
<blue:rootEntity adtcore:name="${esc(a.rootEntity || a.name)}"/>
</blue:blueSource>`;
    }

    if (a.objtype === 'SRVB/SVB') {
      return `<?xml version="1.0" encoding="UTF-8"?>
<srvb:serviceBinding xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings" xmlns:adtcore="http://www.sap.com/adt/core"
 ${head}>
<adtcore:packageRef adtcore:name="${esc(a.parentName)}"/>
<srvb:services srvb:name="${esc(a.name)}">
<srvb:content srvb:version="0001">
<srvb:serviceDefinition adtcore:name="${esc(a.service)}"/>
</srvb:content>
</srvb:services>
<srvb:binding srvb:category="${esc(a.category || '0')}" srvb:type="${esc(a.bindingtype)}" srvb:version="${esc(a.bindingVersion || 'V4')}">
<srvb:implementation adtcore:name=""/>
</srvb:binding>
</srvb:serviceBinding>`;
    }

    if (a.objtype === 'DEVC/K') {
      return `<?xml version="1.0" encoding="UTF-8"?>
<pak:package xmlns:pak="http://www.sap.com/adt/packages" xmlns:adtcore="http://www.sap.com/adt/core"
 ${head} adtcore:version="active">
<adtcore:packageRef adtcore:name="${esc(a.parentName)}"/>
<pak:attributes pak:packageType="${esc(a.packagetype || '')}"/>
<pak:superPackage adtcore:name="${esc(a.parentName)}"/>
<pak:applicationComponent/>
<pak:transport>
<pak:softwareComponent pak:name="${esc(a.swcomp)}"/>
${a.transportLayer ? `<pak:transportLayer pak:name="${esc(a.transportLayer)}"/>` : '<pak:transportLayer/>'}
</pak:transport>
<pak:translation/>
<pak:useAccesses/>
<pak:packageInterfaces/>
<pak:subPackages/>
</pak:package>`;
    }

    return '';
  }

  private collectionFor(objtype: string): string {
    const map: Record<string, string> = {
      'BDEF/BDO': '/sap/bc/adt/bo/behaviordefinitions',
      'SRVB/SVB': '/sap/bc/adt/businessservices/bindings',
      'DEVC/K':   '/sap/bc/adt/packages'
    };
    return map[objtype];
  }

  private async checkRegistered(objtype: string, name: string) {
    const { objectUrl } = this.resolve(objtype, name);
    try {
      const path = await (this.adtclient as any).findObjectPath(objectUrl);
      const registered = Array.isArray(path) && path.length > 0;
      const pkg = registered ? path[path.length - 2]?.['adtcore:name'] : undefined;
      return { registered, package: pkg, objectUrl };
    } catch (e: any) {
      return { registered: false, objectUrl, error: e?.message };
    }
  }

  private async createSafe(a: any) {
    const missing = (REQUIRED[a.objtype] || []).filter(k => !a[k]);
    if (missing.length) {
      this.fail(`${a.objtype} requires: ${missing.join(', ')}. Not sent — nothing was created.`);
    }
    if (a.objtype === 'BDEF/BDO') {
      const valid = ['managed', 'unmanaged', 'abstract', 'projection', 'interface'];
      if (!valid.includes(a.implementationType)) {
        this.fail(`implementationType "${a.implementationType}" is not valid. Use: ${valid.join(' | ')}`);
      }
    }

    const custom = this.collectionFor(a.objtype);
    if (custom) {
      const qs: any = {};
      if (a.transport) qs.corrNr = a.transport;
      await this.http.request(custom, {
        method: 'POST',
        body: this.xmlFor(a),
        headers: { 'Content-Type': 'application/*' },
        qs
      });
    } else {
      await (this.adtclient as any).createObject({
        objtype: a.objtype, name: a.name, parentName: a.parentName,
        description: a.description, parentPath: a.parentPath || `/sap/bc/adt/packages/${a.parentName.toLowerCase()}`,
        responsible: a.responsible || '', transport: a.transport || '',
        language: a.language || process.env.SAP_LANGUAGE || 'EN',
        masterLanguage: a.masterLanguage || a.language || process.env.SAP_LANGUAGE || 'EN'
      });
    }

    const check = await this.checkRegistered(a.objtype, a.name);
    if (!check.registered) {
      this.fail(
        `Object ${a.objtype} ${a.name} was created WITHOUT a TADIR entry (orphan). ` +
        `It cannot be saved or deleted through ADT. Repair with TR_TADIR_INTERFACE ` +
        `(PGMID R3TR, OBJECT ${a.objtype.split('/')[0]}, OBJ_NAME ${a.name.toUpperCase()}, DEVCLASS ${a.parentName}).`
      );
    }
    return { created: a.name, objtype: a.objtype, package: check.package, objectUrl: check.objectUrl };
  }

  private async setSource(a: any) {
    const { objectUrl, sourceUrl } = this.resolve(a.objtype, a.name, a.part);
    if (!sourceUrl) this.fail(`${a.objtype} has no editable source`);
    const lock = await (this.adtclient as any).lock(objectUrl, 'MODIFY');
    const handle = lock?.LOCK_HANDLE || lock?.lockHandle || lock;
    let writeError: unknown;
    let unlockError: unknown;
    try {
      await (this.adtclient as any).setObjectSource(sourceUrl, a.source, handle, a.transport);
    } catch (error) {
      writeError = error;
    } finally {
      try {
        await (this.adtclient as any).unLock(objectUrl, handle);
      } catch (error) {
        unlockError = error;
      }
    }
    // Do not echo ADT exception text: it can contain connection or request details.
    if (writeError && unlockError) this.fail('Source write failed; unlock also failed. Check the object lock before retrying.');
    if (writeError) throw writeError;
    if (unlockError) this.fail('Source unlock failed after write. Check the object lock before retrying.');
    return { written: sourceUrl, bytes: a.source.length };
  }

  private async createFullRapService(args: any): Promise<{ payload: object; failed: boolean }> {
    const failure = (diagnostic: string, extra: object = {}) => ({
      failed: true, payload: { generated: false, diagnostic, ...extra }
    });
    const record = (value: any): value is Record<string, any> =>
      value !== null && typeof value === 'object' && !Array.isArray(value);
    const nonblank = (value: any): value is string => typeof value === 'string' && value.trim().length > 0;
    const contentValid = (value: any): value is RapGeneratorContent =>
      record(value) && (!('metadata' in value) || (record(value.metadata) && nonblank(value.metadata.package) &&
        (value.metadata.masterLanguage === undefined || nonblank(value.metadata.masterLanguage)))) &&
      record(value.general) && nonblank(value.general.description) &&
      (value.general.referenceObjectName === undefined || nonblank(value.general.referenceObjectName)) &&
      record(value.businessObject) && record(value.businessObject.dataModelEntity) &&
      nonblank(value.businessObject.dataModelEntity.cdsName) &&
      (value.businessObject.dataModelEntity.entityName === undefined || nonblank(value.businessObject.dataModelEntity.entityName)) &&
      record(value.businessObject.behavior) && nonblank(value.businessObject.behavior.implementationType) &&
      nonblank(value.businessObject.behavior.implementationClass) && nonblank(value.businessObject.behavior.draftTable) &&
      record(value.serviceProjection) && nonblank(value.serviceProjection.name) &&
      record(value.businessService) && record(value.businessService.serviceDefinition) &&
      nonblank(value.businessService.serviceDefinition.name) &&
      record(value.businessService.serviceBinding) && nonblank(value.businessService.serviceBinding.name) &&
      nonblank(value.businessService.serviceBinding.bindingType);
    const validationFailed = (v: RapGeneratorValidationResult): boolean =>
      !v || !['ok', 'warning', 'info'].includes(v.severity);
    const diagnostic = (phase: string, v: RapGeneratorValidationResult) =>
      `${phase} validation failed (${v && typeof v.severity === 'string' && /^(ok|warning|info|error)$/.test(v.severity) ? v.severity : 'unknown severity'})`;
    const refsValid = (value: any): value is RapGeneratorPreviewObject[] =>
      Array.isArray(value) && value.every(item => record(item) &&
        nonblank(item.uri) && nonblank(item.type) && nonblank(item.name) && typeof item.description === 'string');

    if (!record(args)) return failure('Invalid input object');
    const genId: RapGeneratorId = args.generatorId === undefined ? 'uiservice' : args.generatorId;
    if (genId !== 'uiservice' && genId !== 'webapiservice') return failure('Invalid generatorId');
    if (!nonblank(args.refObjectUri) || !/^\/sap\/bc\/adt\/[a-zA-Z0-9/_~.%-]+$/.test(args.refObjectUri) ||
      args.refObjectUri.includes('..')) return failure('Invalid local refObjectUri');
    if (!nonblank(args.packageName)) return failure('Invalid packageName');
    if (args.dryRun !== undefined && typeof args.dryRun !== 'boolean') return failure('Invalid dryRun');
    if (args.transport !== undefined && (typeof args.transport !== 'string' ||
      (args.transport.trim() === '' && args.packageName !== '$TMP'))) return failure('Invalid transport');
    if (!args.dryRun && args.packageName !== '$TMP' && !nonblank(args.transport)) return failure('transport required for non-$TMP generation');
    if (args.content !== undefined && !contentValid(args.content)) return failure('Invalid content shape');
    if (args.content?.metadata?.package && args.content.metadata.package !== args.packageName)
      return failure('content metadata package does not match packageName');

    const client = this.adtclient;
    let initial: RapGeneratorValidationResult;
    try { initial = await client.rapGenValidateInitial(genId, args.refObjectUri, args.packageName); }
    catch { return failure('Initial validation unavailable; no generation attempted'); }
    if (validationFailed(initial)) return failure(diagnostic('Initial', initial));

    let content: RapGeneratorContent;
    if (args.content !== undefined) {
      content = { ...args.content, metadata: { ...args.content.metadata, package: args.packageName } };
    } else {
      let defaults: unknown;
      try { defaults = await client.rapGenGetContent(genId, args.refObjectUri, args.packageName); }
      catch { return failure('Generator defaults unavailable; no generation attempted'); }
      if (!contentValid(defaults)) return failure('Invalid default content shape');
      if (defaults.metadata && defaults.metadata.package !== args.packageName)
        return failure('Default content metadata package does not match packageName');
      content = { ...defaults, metadata: { ...defaults.metadata, package: args.packageName } };
    }

    let final: RapGeneratorValidationResult;
    try { final = await client.rapGenValidateContent(genId, args.refObjectUri, content); }
    catch { return failure('Content validation unavailable; no generation attempted'); }
    if (validationFailed(final)) return failure(diagnostic('Content', final));

    let preview: RapGeneratorPreviewObject[];
    try { preview = await client.rapGenPreview(genId, args.refObjectUri, content); }
    catch { return failure('Preview unavailable; no generation attempted'); }
    if (!refsValid(preview)) return failure('Malformed preview; no generation attempted');
    if (args.dryRun) return { failed: false, payload: { generated: false, preview } };

    let objects: RapGeneratorPreviewObject[];
    try { objects = await client.rapGenGenerate(genId, args.refObjectUri, args.transport || '', content); }
    catch { return failure('Generation outcome uncertain; inspect SAP before any retry', { uncertain: true, preview }); }
    if (!refsValid(objects) || objects.length === 0)
      return failure('Generation response empty or malformed; outcome uncertain; inspect SAP before any retry', { uncertain: true, preview });
    return { failed: false, payload: { generated: true, preview, objects } };
  }

  private async createAndActivate(a: any) {
    const steps: string[] = [];
    let existed = false;
    try {
      await this.createSafe(a);
      steps.push('created');
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (a.skipIfExists && /already exist/i.test(msg)) { existed = true; steps.push('already existed'); }
      else throw e;
    }

    if (a.source) {
      await this.setSource({ objtype: a.objtype, name: a.name, source: a.source, part: a.part, transport: a.transport });
      steps.push('source written');
    }

    const { objectUrl } = this.resolve(a.objtype, a.name);
    const act = await (this.adtclient as any).activate(a.name, objectUrl);
    steps.push(act?.success ? 'activated' : 'ACTIVATION FAILED');

    return {
      object: a.name, objtype: a.objtype, existed, steps,
      activated: !!act?.success,
      messages: (act?.messages || []).map((m: any) => `${m.type}: ${m.shortText}`)
    };
  }
}
