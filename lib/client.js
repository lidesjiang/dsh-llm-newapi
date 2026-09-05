window.__ModuleLoader__.load({ id: "dsh-llm-newapi", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/NewApiSection.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
function textOf(model, key) {
  const value = model[key];
  return typeof value === "string" ? value : "";
}
function numberOf(model, key) {
  const value = model[key];
  return typeof value === "number" ? value : void 0;
}
var CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/i;
var CAPACITY_SCALE = { k: 1e3, m: 1e6 };
function parseCapacity(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return void 0;
  const match = CAPACITY_PATTERN.exec(trimmed);
  if (match === null) return Number.NaN;
  const suffix = match[2]?.toLowerCase();
  const scale = suffix === "k" || suffix === "m" ? CAPACITY_SCALE[suffix] : 1;
  const scaled = Number(match[1]) * scale;
  const rounded = Math.round(scaled);
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled;
}
function formatCapacity(value) {
  if (!Number.isInteger(value) || value <= 0) return String(value);
  if (value % CAPACITY_SCALE.m === 0) return `${String(value / CAPACITY_SCALE.m)}M`;
  if (value % CAPACITY_SCALE.k === 0) return `${String(value / CAPACITY_SCALE.k)}K`;
  return String(value);
}
var CAPACITY_HINT = {
  contextWindow: "128K",
  maxTokens: "8K"
};
var EFFORT_RUNG = {
  max: 7,
  xhigh: 6,
  high: 5,
  medium: 4,
  low: 3,
  minimal: 2,
  none: 1,
  default: 0
};
function highestOf(efforts) {
  const ids = efforts.filter((effort) => typeof effort === "string");
  return [...ids].sort((a, b) => (EFFORT_RUNG[b] ?? -1) - (EFFORT_RUNG[a] ?? -1))[0] ?? "";
}
function IconChevron({ open }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "svg",
    {
      width: "14",
      height: "14",
      viewBox: "0 0 16 16",
      fill: "none",
      "aria-hidden": true,
      style: { transform: open ? "rotate(90deg)" : void 0, transition: "transform 120ms ease" },
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M6 3.5L10.5 8L6 12.5", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" })
    }
  );
}
function IconTrash() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", "aria-hidden": true, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "path",
    {
      d: "M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4M6.5 6.8v4.4M9.5 6.8v4.4",
      stroke: "currentColor",
      strokeWidth: "1.3",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }
  ) });
}
function IconPlus() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", "aria-hidden": true, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8 3v10M3 8h10", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" }) });
}
var NS = "llm-newapi";
var DEFAULT_PROXY_URL = "http://127.0.0.1:7890";
function groupRoute(id) {
  return id === "newapi" ? "newapi" : `newapi-${id}`;
}
function groupCredRef(id) {
  const safe = id.replace(/[^A-Za-z0-9_]/g, "_");
  return id === "newapi" ? "newapi" : `newapi_${safe}`;
}
function apiTypeOf(group) {
  return textOf(group, "apiType") === "responses" ? "responses" : "chat";
}
function toGroupDrafts(source) {
  if (Array.isArray(source)) {
    return source.map((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry) ? entry : {});
  }
  return [];
}
function toModelDrafts(source) {
  if (!Array.isArray(source)) return [];
  return source.map((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry) ? entry : {});
}
function bufferKey(index, field) {
  return `${String(index)}:${field}`;
}
function NewApiSection(props) {
  const { api, t } = props;
  const [status, setStatus] = (0, import_react.useState)("loading");
  const [errorText, setErrorText] = (0, import_react.useState)(void 0);
  const [revision, setRevision] = (0, import_react.useState)(0);
  const [writable, setWritable] = (0, import_react.useState)(true);
  const [groups, setGroups] = (0, import_react.useState)([]);
  const [credentials, setCredentials] = (0, import_react.useState)({});
  const [keyDrafts, setKeyDrafts] = (0, import_react.useState)({});
  const [expandedGroups, setExpandedGroups] = (0, import_react.useState)(/* @__PURE__ */ new Set());
  const [expandedModels, setExpandedModels] = (0, import_react.useState)(/* @__PURE__ */ new Map());
  const [editing, setEditing] = (0, import_react.useState)(/* @__PURE__ */ new Map());
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [notice, setNotice] = (0, import_react.useState)(void 0);
  const [candidates, setCandidates] = (0, import_react.useState)(/* @__PURE__ */ new Map());
  const [picked, setPicked] = (0, import_react.useState)(/* @__PURE__ */ new Map());
  const [proxies, setProxies] = (0, import_react.useState)(/* @__PURE__ */ new Map());
  const [params, setParams] = (0, import_react.useState)(/* @__PURE__ */ new Map());
  const [paramChoices, setParamChoices] = (0, import_react.useState)(/* @__PURE__ */ new Map());
  const [paramsBusy, setParamsBusy] = (0, import_react.useState)(false);
  const paramsRef = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    paramsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [params]);
  const modelsOf = (group) => toModelDrafts(group.models);
  const load = async () => {
    setStatus("loading");
    setErrorText(void 0);
    try {
      const described = await api.settings.describe();
      if (!described.ok) {
        setErrorText(described.error.message);
        setStatus("error");
        return;
      }
      setWritable(described.value.writable);
      const section = described.value.namespaces.find((entry) => entry.ns === NS);
      if (section === void 0) {
        setErrorText(t("nsNotRegistered"));
        setStatus("error");
        return;
      }
      const value = section.value ?? {};
      setRevision(section.revision);
      const storedGroups = Array.isArray(value.groups) && value.groups.length > 0 ? value.groups : [{ id: "newapi", ...typeof value.baseURL === "string" ? { baseURL: value.baseURL } : {}, ...Array.isArray(value.models) ? { models: value.models } : {} }];
      const drafts = toGroupDrafts(storedGroups);
      setGroups(drafts);
      const refs = drafts.map((group) => groupCredRef(textOf(group, "id") || "newapi"));
      const credential = await api.credentials.describe(refs);
      if (credential.ok) {
        const byRef = {};
        for (const ref of refs) {
          const view = credential.value[ref];
          byRef[ref] = {
            configured: view?.configured === true,
            locked: view?.writable === false
          };
        }
        setCredentials(byRef);
      }
      setExpandedGroups(/* @__PURE__ */ new Set());
      setExpandedModels(/* @__PURE__ */ new Map());
      setEditing(/* @__PURE__ */ new Map());
      setKeyDrafts({});
      setStatus("ready");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
      setStatus("error");
    }
  };
  (0, import_react.useEffect)(() => {
    void load();
  }, []);
  const saved = (text) => {
    setNotice(text);
    void load();
  };
  const catalogProblem = () => {
    const seenGroups = /* @__PURE__ */ new Set();
    for (const [gIndex, group] of groups.entries()) {
      const gid = textOf(group, "id").trim();
      if (gid.length === 0) return `${t("groupIdRequired")} (${t("groups")} ${String(gIndex + 1)})`;
      if (seenGroups.has(gid)) return `${t("groupIdDuplicate")} (${gid})`;
      seenGroups.add(gid);
      const seen = /* @__PURE__ */ new Set();
      for (const [index, model] of modelsOf(group).entries()) {
        const id = textOf(model, "id").trim();
        if (id.length === 0) return `${t("modelIdRequired")} (${t("models")} ${String(index + 1)})`;
        if (seen.has(id)) return `${t("modelIdDuplicate")} (${id})`;
        seen.add(id);
        for (const field of ["contextWindow", "maxTokens"]) {
          const groupEditing = editing.get(gid) ?? /* @__PURE__ */ new Map();
          const buffer = groupEditing.get(bufferKey(index, field));
          if (buffer !== void 0 && Number.isNaN(parseCapacity(buffer) ?? 0)) {
            return `${t("capacityInvalid")} (${id} \xB7 ${t(field)})`;
          }
        }
      }
    }
    return void 0;
  };
  const save = async () => {
    const problem = catalogProblem();
    if (problem !== void 0) {
      setErrorText(problem);
      return;
    }
    setBusy(true);
    setNotice(void 0);
    setErrorText(void 0);
    try {
      const ops = [];
      const serializedGroups = groups.map((group) => {
        const id = textOf(group, "id").trim();
        const name = textOf(group, "name").trim();
        const baseURL = textOf(group, "baseURL").trim();
        const proxy = proxies.get(id);
        const models = modelsOf(group).map((model) => {
          const mid = textOf(model, "id").trim();
          const mname = textOf(model, "name").trim();
          const contextWindow = numberOf(model, "contextWindow");
          const maxTokens = numberOf(model, "maxTokens");
          const efforts = Array.isArray(model.reasoningEfforts) ? model.reasoningEfforts.filter((effort) => typeof effort === "string" && effort.length > 0) : [];
          const preset = typeof model.defaultReasoningEffort === "string" && efforts.includes(model.defaultReasoningEffort) ? model.defaultReasoningEffort : void 0;
          return {
            id: mid,
            ...mname.length > 0 ? { name: mname } : {},
            ...contextWindow !== void 0 ? { contextWindow } : {},
            ...maxTokens !== void 0 ? { maxTokens } : {},
            ...efforts.length > 0 ? { reasoningEfforts: efforts } : {},
            ...preset !== void 0 ? { defaultReasoningEffort: preset } : {},
            ...model.vision === true ? { vision: true } : {}
          };
        });
        return {
          id,
          ...name.length > 0 ? { name } : {},
          ...baseURL.length > 0 ? { baseURL } : {},
          ...apiTypeOf(group) === "responses" ? { apiType: "responses" } : {},
          models,
          ...proxy !== void 0 ? {
            proxy: {
              enabled: proxy.enabled,
              url: proxy.url.trim().length > 0 ? proxy.url.trim() : DEFAULT_PROXY_URL
            }
          } : {}
        };
      });
      ops.push({ op: "set", path: ["groups"], value: serializedGroups });
      ops.push({ op: "unset", path: ["baseURL"] });
      ops.push({ op: "unset", path: ["models"] });
      const mutated = await api.settings.mutate(NS, ops, revision);
      if (!mutated.ok) {
        setErrorText(mutated.error.message);
        return;
      }
      setRevision(mutated.value.revision);
      for (const [ref, draft] of Object.entries(keyDrafts)) {
        const key = draft.trim();
        if (key.length === 0) continue;
        const stored = await api.credentials.set(ref, key);
        if (!stored.ok) {
          setErrorText(stored.error.message);
          return;
        }
      }
      setKeyDrafts({});
      saved(t("saved"));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const patchGroup = (index, next) => {
    setGroups((current) => current.map((group, at) => at === index ? { ...group, ...next } : group));
  };
  const addGroup = () => {
    const id = `gw${String(groups.length + 1)}`;
    setGroups((current) => [...current, { id, name: "", baseURL: "" }]);
    setExpandedGroups((current) => new Set(current).add(id));
  };
  const removeGroup = (index) => {
    const id = textOf(groups[index] ?? {}, "id");
    setGroups((current) => current.filter((_g, at) => at !== index));
    if (id.length > 0) {
      const nextExpanded = new Set(expandedGroups);
      nextExpanded.delete(id);
      setExpandedGroups(nextExpanded);
    }
  };
  const toggleGroupExpanded = (id) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };
  const remapGroupId = (oldId, newId) => {
    if (oldId === newId) return;
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(oldId)) {
        next.delete(oldId);
        next.add(newId);
      }
      return next;
    });
    const remapMap = (current) => {
      if (!current.has(oldId)) return current;
      const next = new Map(current);
      const value = next.get(oldId);
      if (value !== void 0) next.set(newId, value);
      next.delete(oldId);
      return next;
    };
    setExpandedModels((current) => remapMap(current));
    setEditing((current) => remapMap(current));
    setCandidates((current) => remapMap(current));
    setPicked((current) => remapMap(current));
    setProxies((current) => remapMap(current));
    setParams((current) => remapMap(current));
    setParamChoices((current) => remapMap(current));
  };
  const patchModel = (gid, index, next) => {
    setGroups((current) => current.map((group) => {
      if (textOf(group, "id") !== gid) return group;
      const models = modelsOf(group).map((model, at) => {
        if (at !== index) return model;
        const cleared = new Set(
          Object.entries(next).filter(([, value]) => value === void 0 || value === "").map(([key]) => key)
        );
        return Object.fromEntries(
          Object.entries({ ...model, ...next }).filter(([key]) => !cleared.has(key))
        );
      });
      return { ...group, models };
    }));
  };
  const toggleModelExpanded = (gid, index) => {
    setExpandedModels((current) => {
      const rows = new Set(current.get(gid) ?? /* @__PURE__ */ new Set());
      if (!rows.delete(index)) rows.add(index);
      return new Map(current).set(gid, rows);
    });
  };
  const capacityText = (gid, model, index, field) => (editing.get(gid) ?? /* @__PURE__ */ new Map()).get(bufferKey(index, field)) ?? (numberOf(model, field) === void 0 ? "" : formatCapacity(numberOf(model, field)));
  const editCapacity = (gid, index, field, text) => {
    setEditing((current) => {
      const groupEditing = new Map(current.get(gid) ?? /* @__PURE__ */ new Map());
      groupEditing.set(bufferKey(index, field), text);
      return new Map(current).set(gid, groupEditing);
    });
    patchModel(gid, index, { [field]: parseCapacity(text) });
  };
  const reindexOnRemove = (current, gid, index) => {
    const groupEditing = current.get(gid);
    if (groupEditing === void 0) return current;
    const next = /* @__PURE__ */ new Map();
    for (const [key, value] of groupEditing) {
      const at = Number(key.slice(0, key.indexOf(":")));
      if (at === index) continue;
      next.set(at > index ? key.replace(/^\d+/, String(at - 1)) : key, value);
    }
    return new Map(current).set(gid, next);
  };
  const removeModel = (gid, index) => {
    setGroups((current) => current.map((group) => {
      if (textOf(group, "id") !== gid) return group;
      return { ...group, models: modelsOf(group).filter((_m, at) => at !== index) };
    }));
    setExpandedModels((current) => {
      const rows = current.get(gid);
      if (rows === void 0) return current;
      const next = /* @__PURE__ */ new Set();
      for (const at of rows) {
        if (at < index) next.add(at);
        else if (at > index) next.add(at - 1);
      }
      return new Map(current).set(gid, next);
    });
    setEditing((current) => reindexOnRemove(current, gid, index));
  };
  const addModel = (gid) => {
    setGroups((current) => current.map((group) => {
      if (textOf(group, "id") !== gid) return group;
      return { ...group, models: [...modelsOf(group), { id: "" }] };
    }));
  };
  const clearModels = (gid) => {
    setGroups((current) => current.map((group) => {
      if (textOf(group, "id") !== gid) return group;
      return { ...group, models: [] };
    }));
    setExpandedModels((current) => new Map(current).set(gid, /* @__PURE__ */ new Set()));
    setEditing((current) => new Map(current).set(gid, /* @__PURE__ */ new Map()));
    setParams((current) => new Map(current).set(gid, void 0));
    setParamChoices((current) => new Map(current).set(gid, /* @__PURE__ */ new Map()));
  };
  const fetchModels = async (gid) => {
    setBusy(true);
    setErrorText(void 0);
    setCandidates((current) => new Map(current).set(gid, void 0));
    try {
      const group = groups.find((g) => textOf(g, "id") === gid);
      const baseURL = textOf(group ?? {}, "baseURL").trim();
      const key = (keyDrafts[groupCredRef(gid)] ?? "").trim();
      const response = await api.llm.discoverModels(NS, {
        ...baseURL.length > 0 ? { provider: groupRoute(gid), baseURL } : { provider: groupRoute(gid) },
        ...key.length > 0 ? { apiKey: key } : {}
      });
      if (!response.ok) {
        setErrorText(response.error.message);
        return;
      }
      const found = response.value;
      found.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      if (found.length === 0) {
        setErrorText(t("fetchEmpty"));
        return;
      }
      const groupModels = toModelDrafts(group?.models);
      const known = new Set(groupModels.map((model) => textOf(model, "id")));
      setCandidates((current) => new Map(current).set(gid, found));
      setPicked((current) => new Map(current).set(gid, new Set(found.filter((model) => !known.has(model.id)).map((model) => model.id))));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const adopt = (gid) => {
    const found = candidates.get(gid);
    if (found === void 0) return;
    const group = groups.find((g) => textOf(g, "id") === gid);
    const existing = new Map(modelsOf(group ?? {}).map((model) => [textOf(model, "id"), model]));
    const selected = picked.get(gid) ?? /* @__PURE__ */ new Set();
    for (const candidate of found) {
      if (!selected.has(candidate.id)) continue;
      if (existing.has(candidate.id)) continue;
      existing.set(candidate.id, {
        id: candidate.id,
        ...candidate.name === void 0 ? {} : { name: candidate.name },
        ...candidate.contextWindow === void 0 ? {} : { contextWindow: candidate.contextWindow },
        ...candidate.maxTokens === void 0 ? {} : { maxTokens: candidate.maxTokens }
      });
    }
    const merged = [...existing.values()].sort((a, b) => {
      const ai = textOf(a, "id").trim();
      const bi = textOf(b, "id").trim();
      if (ai.length === 0) return bi.length === 0 ? 0 : 1;
      if (bi.length === 0) return -1;
      return ai < bi ? -1 : ai > bi ? 1 : 0;
    });
    patchGroup(groups.findIndex((g) => textOf(g, "id") === gid), { models: merged });
    setCandidates((current) => new Map(current).set(gid, void 0));
    setPicked((current) => new Map(current).set(gid, /* @__PURE__ */ new Set()));
  };
  const toggle = (gid, id) => {
    setPicked((current) => {
      const next = new Set(current.get(gid) ?? /* @__PURE__ */ new Set());
      if (!next.delete(id)) next.add(id);
      return new Map(current).set(gid, next);
    });
  };
  const updateParams = async (gid) => {
    const group = groups.find((g) => textOf(g, "id") === gid);
    const ids = modelsOf(group ?? {}).map((model) => textOf(model, "id").trim()).filter((id) => id.length > 0);
    if (ids.length === 0) {
      setErrorText(t("paramsNoModels"));
      return;
    }
    const proxy = proxies.get(gid);
    setParamsBusy(true);
    setErrorText(void 0);
    setParams((current) => new Map(current).set(gid, void 0));
    try {
      const response = await props.fetchModelParams({
        provider: groupRoute(gid),
        modelIds: ids,
        ...proxy !== void 0 && proxy.enabled && proxy.url.trim().length > 0 ? { proxyUrl: proxy.url.trim() } : {}
      });
      if (!response.ok) {
        setErrorText(response.error.message);
        return;
      }
      setParams((current) => new Map(current).set(gid, response.value));
      setParamChoices((current) => new Map(current).set(gid, /* @__PURE__ */ new Map()));
      const matched = response.value.models.filter((entry) => entry.matches.length > 0).length;
      setNotice(
        t("paramsSummary").replace("{matched}", String(matched)).replace("{unmatched}", String(response.value.models.length - matched))
      );
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setParamsBusy(false);
    }
  };
  const chosenMatch = (gid, entry) => entry.matches[(paramChoices.get(gid) ?? /* @__PURE__ */ new Map()).get(entry.id) ?? 0] ?? entry.matches[0];
  const applyParams = (gid, overwrite) => {
    const groupParams = params.get(gid);
    if (groupParams === void 0) return;
    const byId = new Map(groupParams.models.map((entry) => [entry.id, entry]));
    let touched = 0;
    const group = groups.find((g) => textOf(g, "id") === gid);
    const next = modelsOf(group ?? {}).map((model) => {
      const id = textOf(model, "id").trim();
      const entry = byId.get(id);
      const match = entry === void 0 || entry.matches.length === 0 ? void 0 : chosenMatch(gid, entry);
      if (match === void 0) return model;
      const nextContext = match.contextWindow;
      const nextMax = match.maxTokens;
      const nextEfforts = match.reasoningEfforts;
      const currentContext = numberOf(model, "contextWindow");
      const currentMax = numberOf(model, "maxTokens");
      const hasEfforts = Array.isArray(model.reasoningEfforts);
      const takeContext = nextContext !== void 0 && (overwrite || currentContext === void 0);
      const takeMax = nextMax !== void 0 && (overwrite || currentMax === void 0);
      const takeEfforts = nextEfforts !== void 0 && nextEfforts.length > 0 && (overwrite || !hasEfforts);
      const takeVision = match.vision === true && (overwrite || model.vision !== true);
      if (!takeContext && !takeMax && !takeEfforts && !takeVision) return model;
      touched += 1;
      return {
        ...model,
        ...takeContext && nextContext !== void 0 ? { contextWindow: nextContext } : {},
        ...takeMax && nextMax !== void 0 ? { maxTokens: nextMax } : {},
        ...takeEfforts && nextEfforts !== void 0 ? { reasoningEfforts: nextEfforts } : {},
        ...takeVision ? { vision: true } : {}
      };
    });
    patchGroup(groups.findIndex((g) => textOf(g, "id") === gid), { models: next });
    setParams((current) => new Map(current).set(gid, void 0));
    setParamChoices((current) => new Map(current).set(gid, /* @__PURE__ */ new Map()));
    setNotice(`${t("paramsApplied")} (${String(touched)})`);
  };
  if (status === "loading") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", { "aria-label": t("nav"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u2026" }) });
  if (status === "error") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { "aria-label": t("nav"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "newapi-error", children: `${t("loadFailed")}: ${errorText ?? ""}` }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "newapi-button", onClick: () => {
        void load();
      }, children: t("retry") })
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { "aria-label": t("nav"), children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "newapi-intro", children: t("intro") }),
    notice === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", children: notice }),
    !writable ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("readOnly") }) : null,
    errorText === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "newapi-error", children: errorText }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-groups", children: [
      groups.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "newapi-empty", children: t("noGroups") }) : null,
      groups.map((group, index) => {
        const gid = textOf(group, "id").trim();
        const ref = groupCredRef(gid.length > 0 ? gid : "newapi");
        const cred = credentials[ref];
        const expanded = expandedGroups.has(gid);
        const groupModels = modelsOf(group);
        const groupProxy = proxies.get(gid) ?? { enabled: false, url: DEFAULT_PROXY_URL };
        const groupParams = params.get(gid);
        const groupCandidates = candidates.get(gid);
        const keyDraft = keyDrafts[ref] ?? "";
        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-group", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-group-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                className: "newapi-group-toggle",
                "aria-label": expanded ? t("groupCollapsed") : t("groupExpanded"),
                "aria-expanded": expanded,
                onClick: () => {
                  toggleGroupExpanded(gid);
                },
                children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconChevron, { open: expanded })
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                className: "newapi-input newapi-group-name",
                type: "text",
                placeholder: t("groupNamePlaceholder"),
                value: textOf(group, "name"),
                "aria-label": `${t("groupName")} ${String(index + 1)}`,
                onChange: (event) => {
                  patchGroup(index, { name: event.target.value });
                }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-badge", title: t("groupRoute"), children: groupRoute(gid) }),
            apiTypeOf(group) === "responses" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-badge", title: t("apiTypeResponsesHint"), children: t("apiTypeResponses") }) : null,
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "span",
              {
                className: `newapi-statusdot ${cred?.configured === true ? "newapi-statusdot--ok" : "newapi-statusdot--warn"}`,
                title: cred?.configured === true ? t("keyStored") : t("keyMissing")
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-count", children: `${String(groupModels.length)} ${t("models")}` }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                className: "newapi-iconbutton newapi-iconbutton--danger",
                "aria-label": `${t("removeGroup")} ${String(index + 1)}`,
                title: t("removeGroup"),
                onClick: () => {
                  removeGroup(index);
                },
                children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconTrash, {})
              }
            )
          ] }),
          expanded ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-group-body", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-field", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: `newapi-id-${index}`, children: t("groupId") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "input",
                {
                  id: `newapi-id-${index}`,
                  type: "text",
                  className: "newapi-input",
                  placeholder: t("groupIdPlaceholder"),
                  value: textOf(group, "id"),
                  "aria-label": `${t("groupId")} ${String(index + 1)}`,
                  onChange: (event) => {
                    const oldId = textOf(group, "id");
                    patchGroup(index, { id: event.target.value });
                    remapGroupId(oldId, event.target.value);
                  }
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-field", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: `newapi-key-${index}`, children: t("keyInput") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "input",
                {
                  id: `newapi-key-${index}`,
                  type: "password",
                  autoComplete: "off",
                  className: "newapi-input",
                  disabled: cred?.locked === true,
                  "aria-label": `${t("keyInput")} ${String(index + 1)}`,
                  placeholder: cred?.locked === true ? t("keyEnvLocked") : cred?.configured === true ? t("keyStored") : t("keyMissing"),
                  value: keyDraft,
                  onChange: (event) => {
                    setKeyDrafts((current) => ({ ...current, [ref]: event.target.value }));
                  }
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-field", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: `newapi-base-${index}`, children: t("baseUrl") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "input",
                {
                  id: `newapi-base-${index}`,
                  type: "text",
                  className: "newapi-input",
                  placeholder: t("baseUrlPlaceholder"),
                  value: textOf(group, "baseURL"),
                  "aria-label": `${t("baseUrl")} ${String(index + 1)}`,
                  onChange: (event) => {
                    patchGroup(index, { baseURL: event.target.value });
                  }
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-field", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: `newapi-type-${index}`, children: t("apiType") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                "select",
                {
                  id: `newapi-type-${index}`,
                  className: "newapi-select",
                  "aria-label": `${t("apiType")} ${String(index + 1)}`,
                  value: apiTypeOf(group),
                  onChange: (event) => {
                    patchGroup(index, { apiType: event.target.value });
                  },
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "chat", children: t("apiTypeChat") }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "responses", children: t("apiTypeResponses") })
                  ]
                }
              ),
              apiTypeOf(group) === "responses" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-hint", children: t("apiTypeResponsesHint") }) : null
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-proxyrow", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "input",
                  {
                    type: "checkbox",
                    checked: groupProxy.enabled,
                    "aria-label": `${t("proxyToggle")} ${String(index + 1)}`,
                    onChange: (event) => {
                      setProxies((current) => new Map(current).set(gid, { ...groupProxy, enabled: event.target.checked }));
                    }
                  }
                ),
                t("proxyToggle")
              ] }),
              groupProxy.enabled ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "input",
                {
                  className: "newapi-input",
                  type: "text",
                  style: { maxWidth: 220 },
                  "aria-label": `${t("proxyUrl")} ${String(index + 1)}`,
                  placeholder: DEFAULT_PROXY_URL,
                  value: groupProxy.url,
                  onChange: (event) => {
                    setProxies((current) => new Map(current).set(gid, { ...groupProxy, url: event.target.value }));
                  }
                }
              ) : null
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "newapi-catalog", "aria-label": `${t("models")} ${String(index + 1)}`, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-catalog-head", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-catalog-title", children: t("models") }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-catalog-actions", style: { display: "flex", gap: 4 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "newapi-linkbutton", disabled: busy, onClick: () => {
                    void fetchModels(gid);
                  }, children: busy ? t("fetching") : t("fetchModels") }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "newapi-linkbutton", disabled: paramsBusy, onClick: () => {
                    void updateParams(gid);
                  }, children: paramsBusy ? t("paramsFetching") : t("updateParams") }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "newapi-linkbutton", disabled: busy || groupModels.length === 0, onClick: () => {
                    clearModels(gid);
                  }, children: t("clearModels") })
                ] })
              ] }),
              groupModels.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "newapi-empty", children: t("modelsEmpty") }) : null,
              groupModels.map((model, mIndex) => {
                const rowExpanded = (expandedModels.get(gid) ?? /* @__PURE__ */ new Set()).has(mIndex);
                return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-entry", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-modelrow", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                      "input",
                      {
                        className: "newapi-input",
                        type: "text",
                        value: textOf(model, "id"),
                        placeholder: t("modelId"),
                        "aria-label": `${t("modelId")} ${String(mIndex + 1)}`,
                        onChange: (event) => {
                          patchModel(gid, mIndex, { id: event.target.value });
                        }
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                      "input",
                      {
                        className: "newapi-input",
                        type: "text",
                        value: textOf(model, "name"),
                        placeholder: t("modelName"),
                        "aria-label": `${t("modelName")} ${String(mIndex + 1)}`,
                        onChange: (event) => {
                          patchModel(gid, mIndex, { name: event.target.value === "" ? void 0 : event.target.value });
                        }
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "newapi-vision", title: t("visionHint"), children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                        "input",
                        {
                          type: "checkbox",
                          checked: model.vision === true,
                          "aria-label": `${t("vision")} ${String(mIndex + 1)}`,
                          onChange: (event) => {
                            patchModel(gid, mIndex, { vision: event.target.checked });
                          }
                        }
                      ),
                      t("vision")
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                      "button",
                      {
                        type: "button",
                        className: "newapi-iconbutton",
                        "aria-label": `${t("modelAdvanced")} ${String(mIndex + 1)}`,
                        "aria-expanded": rowExpanded,
                        title: t("modelAdvanced"),
                        onClick: () => {
                          toggleModelExpanded(gid, mIndex);
                        },
                        children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconChevron, { open: rowExpanded })
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                      "button",
                      {
                        type: "button",
                        className: "newapi-iconbutton newapi-iconbutton--danger",
                        "aria-label": `${t("removeModel")} ${String(mIndex + 1)}`,
                        title: t("removeModel"),
                        onClick: () => {
                          removeModel(gid, mIndex);
                        },
                        children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconTrash, {})
                      }
                    )
                  ] }),
                  rowExpanded ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-modeladvanced", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "newapi-modelfield", children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-modelfield-label", children: t("contextWindow") }),
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                        "input",
                        {
                          className: "newapi-input",
                          type: "text",
                          inputMode: "numeric",
                          value: capacityText(gid, model, mIndex, "contextWindow"),
                          placeholder: CAPACITY_HINT.contextWindow,
                          "aria-label": `${t("contextWindow")} ${String(mIndex + 1)}`,
                          onChange: (event) => {
                            editCapacity(gid, mIndex, "contextWindow", event.target.value);
                          }
                        }
                      )
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "newapi-modelfield", children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-modelfield-label", children: t("maxTokens") }),
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                        "input",
                        {
                          className: "newapi-input",
                          type: "text",
                          inputMode: "numeric",
                          value: capacityText(gid, model, mIndex, "maxTokens"),
                          placeholder: CAPACITY_HINT.maxTokens,
                          "aria-label": `${t("maxTokens")} ${String(mIndex + 1)}`,
                          onChange: (event) => {
                            editCapacity(gid, mIndex, "maxTokens", event.target.value);
                          }
                        }
                      )
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "newapi-modelfield", children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-modelfield-label", children: t("reasoningEfforts") }),
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                        "input",
                        {
                          className: "newapi-input",
                          type: "text",
                          placeholder: t("reasoningEffortsPlaceholder"),
                          "aria-label": `${t("reasoningEfforts")} ${String(mIndex + 1)}`,
                          value: Array.isArray(model.reasoningEfforts) ? model.reasoningEfforts.filter((e) => typeof e === "string").join(", ") : "",
                          onChange: (event) => {
                            const efforts = event.target.value.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
                            patchModel(gid, mIndex, { reasoningEfforts: efforts.length > 0 ? efforts : void 0 });
                          }
                        }
                      )
                    ] }),
                    Array.isArray(model.reasoningEfforts) && model.reasoningEfforts.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "newapi-modelfield", children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-modelfield-label", children: t("defaultEffort") }),
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                        "select",
                        {
                          className: "newapi-select",
                          "aria-label": `${t("defaultEffort")} ${String(mIndex + 1)}`,
                          value: typeof model.defaultReasoningEffort === "string" && model.reasoningEfforts.includes(model.defaultReasoningEffort) ? model.defaultReasoningEffort : highestOf(model.reasoningEfforts),
                          onChange: (event) => {
                            patchModel(gid, mIndex, { defaultReasoningEffort: event.target.value });
                          },
                          children: model.reasoningEfforts.map((effort) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: effort, children: effort }, effort))
                        }
                      )
                    ] }) : null
                  ] }) : null
                ] }, mIndex);
              }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                "button",
                {
                  type: "button",
                  className: "newapi-addmodel",
                  disabled: busy,
                  onClick: () => {
                    addModel(gid);
                  },
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconPlus, {}),
                    " ",
                    t("addModel")
                  ]
                }
              )
            ] }),
            groupCandidates === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-candidates", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: t("fetchTitle") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { children: groupCandidates.map((model) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "input",
                  {
                    type: "checkbox",
                    checked: (picked.get(gid) ?? /* @__PURE__ */ new Set()).has(model.id),
                    onChange: () => {
                      toggle(gid, model.id);
                    }
                  }
                ),
                " ",
                model.id,
                model.name === void 0 || model.name === model.id ? "" : ` (${model.name})`
              ] }) }, model.id)) }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "newapi-button newapi-button--primary", disabled: (picked.get(gid) ?? /* @__PURE__ */ new Set()).size === 0, onClick: () => {
                adopt(gid);
              }, children: t("fetchAdopt") }),
              " ",
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "newapi-button", onClick: () => {
                setCandidates((current) => new Map(current).set(gid, void 0));
                setPicked((current) => new Map(current).set(gid, /* @__PURE__ */ new Set()));
              }, children: t("fetchCancel") })
            ] }),
            groupParams === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-params", ref: paramsRef, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: t("paramsTitle") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "newapi-params-summary", children: t("paramsSummary").replace("{matched}", String(groupParams.models.filter((entry) => entry.matches.length > 0).length)).replace("{unmatched}", String(groupParams.models.filter((entry) => entry.matches.length === 0).length)) }),
              groupParams.models.map((entry) => {
                if (entry.matches.length === 0) {
                  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-params-row", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-params-id", children: entry.id }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-params-unmatched", children: t("paramsUnmatched") }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {})
                  ] }, entry.id);
                }
                if (entry.matches.length === 1) {
                  const match2 = entry.matches[0];
                  if (match2 === void 0) return null;
                  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-params-row", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-params-id", children: entry.id }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-params-values", children: `${match2.official === true ? `${t("officialMark")} \xB7 ` : ""}${match2.provider} \xB7 ${t("contextWindow")} ${match2.contextWindow ?? "\u2014"} / ${t("maxTokens")} ${match2.maxTokens ?? "\u2014"}${match2.vision === true ? ` \xB7 ${t("vision")}` : ""}${match2.reasoningEfforts !== void 0 && match2.reasoningEfforts.length > 0 ? ` \xB7 ${t("modelReasoning")}: ${match2.reasoningEfforts.join("/")}` : ""}` }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {})
                  ] }, entry.id);
                }
                const chosen = (paramChoices.get(gid) ?? /* @__PURE__ */ new Map()).get(entry.id) ?? 0;
                const match = entry.matches[chosen] ?? entry.matches[0];
                if (match === void 0) return null;
                return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-params-row", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-params-id", children: entry.id }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "select",
                    {
                      className: "newapi-select",
                      "aria-label": `${t("paramsProvider")} ${entry.id}`,
                      value: String(chosen),
                      onChange: (event) => {
                        setParamChoices((current) => {
                          const groupChoices = new Map(current.get(gid) ?? /* @__PURE__ */ new Map());
                          groupChoices.set(entry.id, Number(event.target.value));
                          return new Map(current).set(gid, groupChoices);
                        });
                      },
                      children: entry.matches.map((candidate, at) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: String(at), children: `${candidate.official === true ? `${t("officialMark")} \xB7 ` : ""}${candidate.provider}: ${t("contextWindow")} ${candidate.contextWindow ?? "\u2014"} / ${t("maxTokens")} ${candidate.maxTokens ?? "\u2014"}${candidate.vision === true ? ` \xB7 ${t("vision")}` : ""}${candidate.reasoningEfforts !== void 0 && candidate.reasoningEfforts.length > 0 ? ` \xB7 ${t("modelReasoning")}: ${candidate.reasoningEfforts.join("/")}` : ""}` }, candidate.provider))
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-params-values", children: match.provider })
                ] }, entry.id);
              }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, marginTop: 10 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "newapi-button newapi-button--primary", onClick: () => {
                  applyParams(gid, true);
                }, children: t("paramsOverwrite") }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "newapi-button", onClick: () => {
                  applyParams(gid, false);
                }, children: t("paramsFillBlank") }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "newapi-button", onClick: () => {
                  setParams((current) => new Map(current).set(gid, void 0));
                  setParamChoices((current) => new Map(current).set(gid, /* @__PURE__ */ new Map()));
                }, children: t("fetchCancel") })
              ] })
            ] })
          ] }) : null
        ] }, index);
      })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "newapi-addgroup", disabled: busy || !writable, onClick: addGroup, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconPlus, {}),
      " ",
      t("addGroup")
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "newapi-hint", children: t("modelHint") }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "newapi-button newapi-button--primary", disabled: busy || !writable, onClick: () => {
      void save();
    }, children: busy ? t("applying") : t("apply") })
  ] });
}

// src/client/locale.ts
var zh = {
  nav: "NewAPI",
  intro: "\u914D\u7F6E\u4E00\u4E2A\u6216\u591A\u4E2A NewAPI \u7F51\u5173\uFF1A\u6BCF\u4E2A\u7F51\u5173\uFF08\u7EC4\uFF09\u6709\u81EA\u5DF1\u7684\u5BC6\u94A5\u3001\u5730\u5740\u4E0E\u6A21\u578B\u5217\u8868\u3002\u6A21\u578B\u53D1\u73B0\u53EA\u5217\u51FA\u652F\u6301 chat \u63A5\u53E3\u7684\u6A21\u578B\u3002",
  groups: "\u7F51\u5173",
  addGroup: "\u6DFB\u52A0\u7F51\u5173",
  removeGroup: "\u5220\u9664\u8BE5\u7F51\u5173",
  groupName: "\u7F51\u5173\u540D\u79F0",
  groupNamePlaceholder: "\u4F8B\u5982\uFF1AGinka",
  groupId: "\u6807\u8BC6 id",
  groupIdPlaceholder: "\u552F\u4E00 id\uFF0C\u7528\u4E8E\u751F\u6210\u8DEF\u7531\uFF08newapi-<id>\uFF09",
  groupRoute: "\u8DEF\u7531",
  groupIdRequired: "\u7F51\u5173 id \u4E0D\u80FD\u4E3A\u7A7A",
  groupIdDuplicate: "\u7F51\u5173 id \u91CD\u590D",
  groupCollapsed: "\u6536\u8D77\u8BE5\u7F51\u5173",
  groupExpanded: "\u5C55\u5F00\u8BE5\u7F51\u5173",
  noGroups: "\u6682\u65E0\u7F51\u5173\uFF1A\u70B9\u300C\u6DFB\u52A0\u7F51\u5173\u300D\u914D\u7F6E\u4E00\u4E2A\u7B2C\u4E09\u65B9\u4E2D\u8F6C\u7AD9\u3002",
  apiType: "\u63A5\u53E3\u7C7B\u578B",
  apiTypeChat: "Chat Completions\uFF08\u9ED8\u8BA4\uFF09",
  apiTypeResponses: "Responses API",
  apiTypeResponsesHint: "\u9002\u5408 Agent\u3001\u591A\u6B65\u8F93\u51FA\u4E0E\u5DE5\u5177\u8C03\u7528\uFF1B\u8BF7\u6C42\u8D70 POST {baseURL}/responses\u3002",
  keyInput: "API \u5BC6\u94A5",
  keyPlaceholder: "\u7C98\u8D34\u4EE4\u724C\uFF1B\u7559\u7A7A\u4FDD\u6301\u5DF2\u5B58\u5BC6\u94A5\u4E0D\u53D8",
  keyStored: "\u5DF2\u914D\u7F6E",
  keyMissing: "\u672A\u914D\u7F6E",
  keyEnvLocked: "\u7531\u542F\u52A8\u73AF\u5883\u63D0\u4F9B\uFF08\u53EA\u8BFB\uFF09",
  baseUrl: "\u7F51\u5173\u5730\u5740\uFF08\u542B /v1 \u524D\u7F00\uFF09",
  baseUrlPlaceholder: "http://gw.local:3000/v1",
  models: "\u6A21\u578B",
  modelsEmpty: "\u6682\u65E0\u6A21\u578B\uFF1A\u70B9\u300C\u6DFB\u52A0\u6A21\u578B\u300D\u624B\u52A8\u65B0\u589E\uFF0C\u6216\u300C\u83B7\u53D6\u6A21\u578B\u300D\u4ECE\u7F51\u5173\u62C9\u53D6\u3002",
  clearModels: "\u6E05\u7A7A",
  addModel: "\u6DFB\u52A0\u6A21\u578B",
  removeModel: "\u5220\u9664\u8BE5\u6A21\u578B",
  modelAdvanced: "\u9AD8\u7EA7\u8BBE\u7F6E\uFF08\u4E0A\u4E0B\u6587 / \u8F93\u51FA\u4E0A\u9650 / \u601D\u8003\u7B49\u7EA7\uFF09",
  modelId: "\u6A21\u578B ID",
  modelName: "\u663E\u793A\u540D\u79F0",
  contextWindow: "\u4E0A\u4E0B\u6587\u7A97\u53E3",
  maxTokens: "\u8F93\u51FA\u4E0A\u9650",
  modelReasoning: "\u601D\u8003\u7B49\u7EA7",
  defaultEffort: "\u9884\u8BBE\u601D\u8003\u7B49\u7EA7\uFF08\u5207\u6362\u6A21\u5F0F\u65F6\u81EA\u52A8\u9009\u62E9\uFF09",
  vision: "\u652F\u6301\u56FE\u7247\uFF08vision\uFF09",
  visionHint: "\u52FE\u9009\u540E\u8BE5\u6A21\u578B\u58F0\u660E\u63A5\u6536\u56FE\u50CF\u8F93\u5165\uFF0C\u8BF7\u6C42\u4E2D\u7684\u56FE\u7247\u4F1A\u4EE5 OpenAI content \u65B9\u5F0F\u53D1\u9001\u3002",
  reasoningEfforts: "\u601D\u8003\u7B49\u7EA7\u5217\u8868",
  reasoningEffortsPlaceholder: "\u7528\u9017\u53F7\u5206\u9694\uFF0C\u5982 low, medium, high",
  modelIdRequired: "\u6A21\u578B ID \u4E0D\u80FD\u4E3A\u7A7A",
  modelIdDuplicate: "\u6A21\u578B ID \u91CD\u590D",
  capacityInvalid: "\u5BB9\u91CF\u9700\u4E3A\u6B63\u6570\uFF0C\u53EF\u7528 K/M \u7F29\u5199\uFF08\u5982 128K\u30011M\uFF09",
  fetchModels: "\u83B7\u53D6\u6A21\u578B",
  fetching: "\u6B63\u5728\u8BE2\u95EE\u7F51\u5173\u2026",
  fetchEmpty: "\u7F51\u5173\u6CA1\u6709\u5217\u51FA\u53EF\u7528\u7684 chat \u6A21\u578B\uFF08embedding / rerank / ranker \u5DF2\u8FC7\u6EE4\uFF09\u3002",
  fetchTitle: "\u9009\u62E9\u8981\u6DFB\u52A0\u7684\u6A21\u578B",
  fetchAdopt: "\u6DFB\u52A0\u6240\u9009",
  fetchCancel: "\u53D6\u6D88",
  updateParams: "\u4ECEmodels.dev\u83B7\u53D6\u6A21\u578B\u4FE1\u606F",
  paramsFetching: "\u6B63\u5728\u67E5\u8BE2 models.dev\u2026",
  paramsTitle: "\u6A21\u578B\u53C2\u6570\uFF08\u6765\u81EA models.dev\uFF09",
  paramsSummary: "\u5339\u914D {matched} \u4E2A \xB7 \u672A\u5339\u914D {unmatched} \u4E2A",
  paramsUnmatched: "\u672A\u5339\u914D\uFF08\u4FDD\u6301\u539F\u503C\uFF09",
  paramsProvider: "\u9009\u62E9\u6570\u636E\u6765\u6E90\u4F9B\u5E94\u5546",
  officialMark: "\u5B98\u65B9",
  paramsOverwrite: "\u5E94\u7528\uFF08\u8986\u76D6\u73B0\u6709\u503C\uFF09",
  paramsFillBlank: "\u4EC5\u586B\u7A7A\u767D\u5B57\u6BB5",
  paramsApplied: "\u5DF2\u66F4\u65B0\u6A21\u578B\u4FE1\u606F",
  paramsNoModels: "\u6CA1\u6709\u53EF\u67E5\u8BE2\u7684\u6A21\u578B\uFF1A\u5148\u6DFB\u52A0\u6A21\u578B\u6216\u4ECE\u7F51\u5173\u83B7\u53D6\u3002",
  proxyToggle: "\u4EE3\u7406",
  proxyUrl: "\u4EE3\u7406\u5730\u5740",
  apply: "\u4FDD\u5B58",
  applying: "\u6B63\u5728\u4FDD\u5B58\u2026",
  saved: "\u5DF2\u4FDD\u5B58\u3002",
  loadFailed: "\u52A0\u8F7D\u5931\u8D25",
  nsNotRegistered: "llm-newapi: \u8BBE\u7F6E\u547D\u540D\u7A7A\u95F4\u672A\u6CE8\u518C\uFF08\u63D2\u4EF6\u884C\u662F\u5426\u5DF2\u52A0\u8F7D\uFF1F\uFF09",
  retry: "\u91CD\u8BD5",
  readOnly: "\u5F53\u524D\u8BBE\u7F6E\u6E90\u53EA\u8BFB\uFF0C\u65E0\u6CD5\u4FDD\u5B58\u3002",
  modelHint: "\u9ED8\u8BA4\u53EA\u5217\u51FA /chat/completions \u63A5\u53E3\u652F\u6301\u7684\u6A21\u578B\uFF1B\u4E0D\u652F\u6301\u8BE5\u63A5\u53E3\u7684\u6A21\u578B\u8BF7\u624B\u52A8\u6DFB\u52A0\u3002\u6BCF\u4E2A\u7F51\u5173\u7684\u6A21\u578B\u5217\u8868\u72EC\u7ACB\u3002\u8BE5\u914D\u7F6E\u53EF\u5728 settings.yaml \u7684 llm-newapi: \u6BB5\u7528 modelExcludePatterns \u8C03\u6574\u3002"
};
var en = {
  nav: "NewAPI",
  intro: "Configure one or more NewAPI gateways: each gateway (group) has its own key, base URL, and model list. Discovery lists chat-capable models only.",
  groups: "Gateways",
  addGroup: "Add gateway",
  removeGroup: "Remove this gateway",
  groupName: "Gateway name",
  groupNamePlaceholder: "e.g. Ginka",
  groupId: "Identifier id",
  groupIdPlaceholder: "Unique id; derives the route (newapi-<id>)",
  groupRoute: "Route",
  groupIdRequired: "Gateway id is required",
  groupIdDuplicate: "Duplicate gateway id",
  groupCollapsed: "Collapse this gateway",
  groupExpanded: "Expand this gateway",
  noGroups: "No gateways yet: add one to configure a third-party relay.",
  apiType: "API type",
  apiTypeChat: "Chat Completions (default)",
  apiTypeResponses: "Responses API",
  apiTypeResponsesHint: "for agents, multi-step output, and tool calling; requests go to POST {baseURL}/responses.",
  keyInput: "API key",
  keyPlaceholder: "Paste the token; leave blank to keep the stored key",
  keyStored: "Configured",
  keyMissing: "Not configured",
  keyEnvLocked: "Provided by the launch environment (read-only)",
  baseUrl: "Gateway base URL (including /v1)",
  baseUrlPlaceholder: "http://gw.local:3000/v1",
  models: "Models",
  modelsEmpty: "No models yet: add one by hand, or fetch the list from the gateway.",
  clearModels: "Clear",
  addModel: "Add model",
  removeModel: "Remove this model",
  modelAdvanced: "Advanced (context window / max output / reasoning)",
  modelId: "Model ID",
  modelName: "Display name",
  contextWindow: "Context window",
  maxTokens: "Max output tokens",
  modelReasoning: "Reasoning efforts",
  defaultEffort: "Default reasoning effort (auto-selected on mode switch)",
  vision: "Accepts images (vision)",
  visionHint: "Declares the model accepts image input; request images ride as OpenAI content parts.",
  reasoningEfforts: "Reasoning effort list",
  reasoningEffortsPlaceholder: "Comma-separated, e.g. low, medium, high",
  modelIdRequired: "Model id is required",
  modelIdDuplicate: "Duplicate model id",
  capacityInvalid: "Capacity must be a positive number; K/M suffix allowed (e.g. 128K, 1M)",
  fetchModels: "Fetch models",
  fetching: "Asking the gateway\u2026",
  fetchEmpty: "The gateway listed no chat-capable models (embedding / rerank / ranker filtered out).",
  fetchTitle: "Choose models to add",
  fetchAdopt: "Add selected",
  fetchCancel: "Cancel",
  updateParams: "Fetch model info from models.dev",
  paramsFetching: "Querying models.dev\u2026",
  paramsTitle: "Model parameters (from models.dev)",
  paramsSummary: "{matched} matched \xB7 {unmatched} unmatched",
  paramsUnmatched: "No match (values kept)",
  paramsProvider: "Choose the data provider",
  officialMark: "Official",
  paramsOverwrite: "Apply (overwrite existing)",
  paramsFillBlank: "Fill blank fields only",
  paramsApplied: "Model info updated",
  paramsNoModels: "No models to look up: add one or fetch from the gateway first.",
  proxyToggle: "Proxy",
  proxyUrl: "Proxy URL",
  apply: "Save",
  applying: "Saving\u2026",
  saved: "Saved.",
  loadFailed: "Load failed",
  nsNotRegistered: "llm-newapi: the settings namespace is not registered (is the plugin row loaded?)",
  retry: "Retry",
  readOnly: "The active settings source is read-only; nothing can be saved.",
  modelHint: "By default only models supported by the /chat/completions endpoint are listed; models without that support must be added manually. Each gateway has its own model list. Tune modelExcludePatterns in the llm-newapi: settings section."
};

// src/client/apply.ts
var NS2 = "settings.newapi";
var SECTION_CSS = `
.newapi-intro { color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; margin: 0 0 12px; }
.newapi-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.newapi-input {
  box-sizing: border-box; padding: 6px 10px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px;
}
.newapi-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.newapi-input::placeholder { color: var(--dsw-alias-label-dimmed); }
.newapi-input:disabled { opacity: 0.6; cursor: default; }
.newapi-button {
  padding: 6px 12px; border-radius: 6px; font: inherit; font-size: 13px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent; color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.newapi-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.newapi-button:disabled { opacity: 0.4; cursor: default; }
.newapi-button--primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.newapi-button--primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.newapi-error { color: var(--dsw-alias-state-error-primary); }
.newapi-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary); }

/* Gateway group cards: one bordered card per group, a header row with
   name/route badge/status/count, and an expanding body. */
.newapi-groups { display: flex; flex-direction: column; gap: 12px; margin-bottom: 12px; }
.newapi-group {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  padding: 10px 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.newapi-group-head {
  display: flex; align-items: center; gap: 8px;
  min-width: 0;
}
.newapi-group-toggle {
  box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; flex: none;
  border: none; border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.newapi-group-toggle:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.newapi-group-name { flex: 1 1 auto; min-width: 0; font-weight: 600; }
.newapi-badge {
  flex: none; display: inline-flex; align-items: center;
  padding: 2px 8px; border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 11px; line-height: 18px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.newapi-statusdot { width: 8px; height: 8px; flex: none; border-radius: 50%; }
.newapi-statusdot--ok { background: var(--dsw-alias-state-success-primary, #22c55e); }
.newapi-statusdot--warn { background: var(--dsw-alias-state-warning-primary, #eab308); }
.newapi-count { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 12px; white-space: nowrap; }
.newapi-group-body { padding-top: 12px; }

/* Model catalog, mirroring ui-settings-models: one bordered entry per
   model, id and display name on the row, capacities behind the row's own
   disclosure. */
.newapi-catalog {
  display: flex; flex-direction: column; gap: 10px;
  padding-top: 12px; margin-bottom: 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.newapi-catalog-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.newapi-catalog-title {
  font-size: 12px; line-height: 18px; font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}
.newapi-linkbutton {
  box-sizing: border-box; display: inline-flex; align-items: center;
  height: 28px; padding: 0 10px; border: none; border-radius: 14px;
  background: transparent; color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 12px; cursor: pointer;
}
.newapi-linkbutton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.newapi-linkbutton:disabled { opacity: 0.4; cursor: default; }
.newapi-empty { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.newapi-entry {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 6px;
}
.newapi-modelrow {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: 6px;
}
.newapi-vision {
  display: inline-flex; align-items: center; gap: 4px;
  color: var(--dsw-alias-label-tertiary); font-size: 12px;
  white-space: nowrap;
}
/* Square, label-free affordances: the row's own inputs carry the meaning, so
   the actions stay glyphs and announce themselves through aria-label. */
.newapi-iconbutton {
  box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border: none; border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.newapi-iconbutton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.newapi-iconbutton:disabled { opacity: 0.4; cursor: default; }
.newapi-iconbutton--danger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
}
.newapi-modeladvanced {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 8px;
  padding: 8px 4px 2px;
}
.newapi-modelfield { display: flex; flex-direction: column; gap: 4px; }
.newapi-modelfield-label { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.newapi-addmodel, .newapi-addgroup {
  box-sizing: border-box; align-self: flex-start; display: inline-flex; align-items: center;
  gap: 4px; height: 28px; padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px;
  background: transparent; color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 12px; cursor: pointer;
}
.newapi-addmodel:hover:not(:disabled), .newapi-addgroup:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.newapi-addmodel:disabled, .newapi-addgroup:disabled { opacity: 0.4; cursor: default; }
.newapi-candidates { border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 12px; margin-bottom: 12px; }
.newapi-candidates ul { list-style: none; padding: 0; margin: 8px 0; }
/* Proxy control + models.dev params panel. */
.newapi-proxyrow {
  display: flex; flex-direction: row; align-items: center; flex-wrap: wrap;
  gap: 8px; margin-bottom: 12px;
}
.newapi-proxyrow label { display: inline-flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-primary); }
.newapi-select {
  box-sizing: border-box; padding: 6px 10px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px; max-width: 220px;
}
.newapi-params {
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  padding: 12px; margin-bottom: 12px;
}
.newapi-params-summary { margin: 6px 0 10px; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.newapi-params-row {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center; gap: 8px; padding: 4px 0;
}
/* The id rides a fixed-width text box so rows align; content wider than
   the box stays hidden until hover, when it scrolls horizontally. */
.newapi-params-id {
  box-sizing: border-box; width: 30ch; max-width: 30ch;
  padding: 4px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 12px; line-height: 18px;
  text-align: left; white-space: nowrap; overflow: hidden;
  scrollbar-width: thin;
}
.newapi-params-id:hover { overflow-x: auto; }
.newapi-params-values {
  color: var(--dsw-alias-label-tertiary); font-size: 12px;
  font-variant-numeric: tabular-nums; text-align: left;
}
.newapi-params-unmatched { color: var(--dsw-alias-label-dimmed); font-size: 12px; padding: 4px 0; }
`;
var inject = ["slots", "locale", "connection", "remote"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS2, { zh, en }), "llm-newapi: copy dictionaries");
  if (typeof document !== "undefined") {
    ctx.effect(() => {
      const element = document.createElement("style");
      element.textContent = SECTION_CSS;
      document.head.append(element);
      return () => {
        element.remove();
      };
    }, "llm-newapi: section styles");
  }
  const connection = ctx.get("connection");
  const t = ctx.locale.bind(NS2);
  const fetchModelParams = (request) => connection.rpc.call("/llm-newapi", "models-dev-params", request);
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "newapi",
    order: 15,
    label: () => t("nav"),
    inject: () => ({
      // The connection.api face was removed in 0.1.2 (DSH-0.1.2-A1-30); the
      // section reads and writes through the typed Remote projection instead.
      api: {
        settings: ctx.remote.settings,
        credentials: ctx.remote.credentials,
        llm: ctx.remote.llm
      },
      t,
      fetchModelParams
    })
  }, NewApiSection));
}
return module.exports; } });
//# sourceMappingURL=client.js.map
