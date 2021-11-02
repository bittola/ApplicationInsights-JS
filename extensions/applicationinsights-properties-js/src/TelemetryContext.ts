/**
 * TelemetryContext.ts
 * @copyright Microsoft 2018
 */

 import dynamicProto from "@microsoft/dynamicproto-js";
import {
    ITelemetryItem, IProcessTelemetryContext, IAppInsightsCore, isString, objKeys, hasWindow, _InternalLogMessage, setValue, getSetValue, strEndsWith,
    getDocument, getPerformance, ITraceParent, findW3cTraceParent, isArray, strTrim, strStartsWith, createTraceParent, isValidTraceId, isValidSpanId
} from "@microsoft/applicationinsights-core-js";
import { Session, _SessionManager } from "./Context/Session";
import {
    Extensions, IOperatingSystem, ITelemetryTrace, IWeb, CtxTagKeys, PageView, IApplication, IDevice, ILocation, IUserContext, IInternal,
    ISession
} from "@microsoft/applicationinsights-common";
import { Application } from "./Context/Application";
import { Device } from "./Context/Device";
import { Internal } from "./Context/Internal";
import { User } from "./Context/User";
import { Location } from "./Context/Location";
import { ITelemetryConfig } from "./Interfaces/ITelemetryConfig";
import { TelemetryTrace } from "./Context/TelemetryTrace";
import { IPropTelemetryContext } from "./Interfaces/IPropTelemetryContext";

const strExt = "ext";
const strTags = "tags";

function _removeEmpty(target: any, name: string) {
    if (target && target[name] && objKeys(target[name]).length === 0) {
        delete target[name];
    }
}

export class TelemetryContext implements IPropTelemetryContext {

    public application: IApplication; // The object describing a component tracked by this object - legacy
    public device: IDevice; // The object describing a device tracked by this object.
    public location: ILocation; // The object describing a location tracked by this object -legacy
    public telemetryTrace: ITelemetryTrace; // The object describing a operation tracked by this object.
    public user: IUserContext; // The object describing a user tracked by this object.
    public internal: IInternal; // legacy
    public session: ISession; // The object describing a session tracked by this object.
    public sessionManager: _SessionManager; // The session manager that manages session on the base of cookies.
    public os: IOperatingSystem;
    public web: IWeb;
    public appId: () => string;
    public getSessionId: () => string;

    constructor(core: IAppInsightsCore, defaultConfig: ITelemetryConfig) {
        let logger = core.logger
        this.appId = () => null;
        this.getSessionId = () => null;

        dynamicProto(TelemetryContext, this, (_self) => {
            _self.application = new Application();
            _self.internal = new Internal(defaultConfig);
            if (hasWindow()) {
                _self.sessionManager = new _SessionManager(defaultConfig, core);
                _self.device = new Device();
                _self.location = new Location();
                _self.user = new User(defaultConfig, core);
                let parentId = undefined;
                if (!defaultConfig.disableTraceParent()) {
                    let traceParent = findW3cTraceParent();
                    if (!traceParent) {
                        traceParent = _findRequestId();
                    }
                    if (traceParent) {
                        parentId = traceParent.spanId;
                    }
                }
                _self.telemetryTrace = new TelemetryTrace(undefined, parentId, undefined, logger);
                _self.session = new Session();
            }

            _self.getSessionId = () => {
                let session = _self.session;
                let sesId = null;
                
                // If customer set session info, apply their context; otherwise apply context automatically generated
                if (session && isString(session.id)) {
                    sesId = session.id;
                } else {
                    // Gets the automatic session if it exists or an empty object
                    let autoSession = (_self.sessionManager || {} as _SessionManager).automaticSession;
                
                    sesId = autoSession && isString(autoSession.id) ? autoSession.id : null;
                }

                return sesId;
            }
    
            _self.applySessionContext = (evt: ITelemetryItem, itemCtx?: IProcessTelemetryContext) => {
                setValue(getSetValue(evt.ext, Extensions.AppExt), "sesId", _self.getSessionId(), isString);
            }

            _self.applyOperatingSystemContxt = (evt: ITelemetryItem, itemCtx?: IProcessTelemetryContext) => {
                setValue(evt.ext, Extensions.OSExt, _self.os);
            };
        
            _self.applyApplicationContext = (evt: ITelemetryItem, itemCtx?: IProcessTelemetryContext) => {
                let application = _self.application;
                if (application) {
                    // evt.ext.app
                    let tags = getSetValue(evt, strTags);
                    setValue(tags, CtxTagKeys.applicationVersion, application.ver, isString);
                    setValue(tags, CtxTagKeys.applicationBuild, application.build, isString)
                }
            };
        
            _self.applyDeviceContext = (evt: ITelemetryItem, itemCtx?: IProcessTelemetryContext) => {
                let device = _self.device;
                if (device) {
                    // evt.ext.device
                    let extDevice = getSetValue(getSetValue(evt, strExt), Extensions.DeviceExt);
                    setValue(extDevice, "localId", device.id, isString);
                    setValue(extDevice, "ip", device.ip, isString);
                    setValue(extDevice, "model", device.model, isString);
                    setValue(extDevice, "deviceClass", device.deviceClass, isString);
                }
            };
        
            _self.applyInternalContext = (evt: ITelemetryItem, itemCtx?: IProcessTelemetryContext) => {
                let internal = _self.internal;
                if (internal) {
                    let tags = getSetValue(evt, strTags);

                    setValue(tags, CtxTagKeys.internalAgentVersion, internal.agentVersion, isString); // not mapped in CS 4.0
                    setValue(tags, CtxTagKeys.internalSdkVersion, internal.sdkVersion, isString);
            
                    if (evt.baseType === _InternalLogMessage.dataType || evt.baseType === PageView.dataType) {
                        setValue(tags, CtxTagKeys.internalSnippet, internal.snippetVer, isString);
                        setValue(tags, CtxTagKeys.internalSdkSrc, internal.sdkSrc, isString);
                    }
                }
            };
        
            _self.applyLocationContext = (evt: ITelemetryItem, itemCtx?: IProcessTelemetryContext) => {
                let location = this.location;
                if (location) {
                    setValue(getSetValue(evt, strTags, []), CtxTagKeys.locationIp, location.ip, isString);
                }
            };
        
            _self.applyOperationContext = (evt: ITelemetryItem, itemCtx?: IProcessTelemetryContext) => {
                let telemetryTrace = _self.telemetryTrace;
                if (telemetryTrace) {
                    const extTrace = getSetValue(getSetValue(evt, strExt), Extensions.TraceExt, { traceID: undefined, parentID: undefined } as ITelemetryTrace);
                    setValue(extTrace, "traceID", telemetryTrace.traceID, isString);
                    setValue(extTrace, "name", telemetryTrace.name, isString);
                    setValue(extTrace, "parentID", telemetryTrace.parentID, isString);
                }
            };
        
            _self.applyWebContext = (evt: ITelemetryItem, itemCtx?: IProcessTelemetryContext) => {
                let web = this.web;
                if (web) {
                    setValue(getSetValue(evt, strExt), Extensions.WebExt, web);
                }
            }
        
            _self.applyUserContext = (evt: ITelemetryItem, itemCtx?: IProcessTelemetryContext) => {
                let user = _self.user;
                if (user) {
                    let tags = getSetValue(evt, strTags, []);

                    // stays in tags
                    setValue(tags, CtxTagKeys.userAccountId, user.accountId, isString);
            
                    // CS 4.0
                    let extUser = getSetValue(getSetValue(evt, strExt), Extensions.UserExt);
                    setValue(extUser, "id", user.id, isString);
                    setValue(extUser, "authId", user.authenticatedId, isString);
                }
            }
        
            _self.cleanUp = (evt:ITelemetryItem, itemCtx?: IProcessTelemetryContext) => {
                let ext = evt.ext;
                if (ext) {
                    _removeEmpty(ext, Extensions.DeviceExt);
                    _removeEmpty(ext, Extensions.UserExt);
                    _removeEmpty(ext, Extensions.WebExt);
                    _removeEmpty(ext, Extensions.OSExt);
                    _removeEmpty(ext, Extensions.AppExt);
                    _removeEmpty(ext, Extensions.TraceExt);
                }
            }

            function _findRequestId(): ITraceParent {
                let traceParent: ITraceParent;
                let doc = getDocument();
                if (doc) {
                    // Look for a meta-tag called "Request-Id"
                    traceParent = _parseRequestId(_getRequestIdValue(doc.querySelectorAll("meta")).content);
                }

                if (!traceParent) {
                    let perf = getPerformance();
                    if (perf) {
                        // Try looking for a server-timing header
                        let navPerf = perf.getEntriesByType("navigation") || [];
                        traceParent = _parseRequestId(_getRequestIdValue((navPerf.length > 0 ? navPerf[0] : {} as any).serverTiming).description);
                    }
                }

                return traceParent;
            }

            function _getRequestIdValue(values: any) {
                if (values) {
                    for (var i = 0; i < values.length; i++) {
                        var value = values[i] as any;
                        if (value.name) {
                            if(value.name === "Request-Id") {
                                return value;
                            }
                        }
                    }
                }

                return {};
            }

            function _parseRequestId(value: string): ITraceParent {
                if (value) {
                    if (isArray(value)) {
                        value = value[0] || "";
                    }

                    if (value && isString(value)) {
                        value = strTrim(value);
                        if (strStartsWith(value, "|")) {
                            let idx = value.indexOf(".");
                            if (idx != -1) {
                                let traceId = value.substring(1, idx);
                                let spanId = value.substring(idx + 1);
                                if (strEndsWith(spanId, ".")) {
                                    spanId = spanId.substring(0, spanId.length - 1);
                                }
                                if (isValidTraceId(traceId) && isValidSpanId(spanId)) {
                                    return createTraceParent(traceId, spanId);
                                }
                            }
                        }
                    }
                }
                return null;
            }
        });
    }

    public applySessionContext(evt: ITelemetryItem, itemCtx?: IProcessTelemetryContext) {
        // @DynamicProtoStub -- DO NOT add any code as this will be removed during packaging
    }

    public applyOperatingSystemContxt(event: ITelemetryItem, itemCtx?: IProcessTelemetryContext) {
        // @DynamicProtoStub -- DO NOT add any code as this will be removed during packaging
    }

    public applyApplicationContext(event: ITelemetryItem, itemCtx?: IProcessTelemetryContext) {
        // @DynamicProtoStub -- DO NOT add any code as this will be removed during packaging
    }

    public applyDeviceContext(event: ITelemetryItem, itemCtx?: IProcessTelemetryContext) {
        // @DynamicProtoStub -- DO NOT add any code as this will be removed during packaging
    }

    public applyInternalContext(event: ITelemetryItem, itemCtx?: IProcessTelemetryContext) {
        // @DynamicProtoStub -- DO NOT add any code as this will be removed during packaging
    }

    public applyLocationContext(event: ITelemetryItem, itemCtx?: IProcessTelemetryContext) {
        // @DynamicProtoStub -- DO NOT add any code as this will be removed during packaging
    }

    public applyOperationContext(event: ITelemetryItem, itemCtx?: IProcessTelemetryContext) {
        // @DynamicProtoStub -- DO NOT add any code as this will be removed during packaging
    }

    public applyWebContext(event: ITelemetryItem, itemCtx?: IProcessTelemetryContext) {
        // @DynamicProtoStub -- DO NOT add any code as this will be removed during packaging
    }

    public applyUserContext(event: ITelemetryItem, itemCtx?: IProcessTelemetryContext) {
        // @DynamicProtoStub -- DO NOT add any code as this will be removed during packaging
    }

    public cleanUp(event:ITelemetryItem, itemCtx?: IProcessTelemetryContext): void {
        // @DynamicProtoStub -- DO NOT add any code as this will be removed during packaging
    }
}